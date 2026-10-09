import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags, Mesh, InstancedMesh, Node, Matrix, Ray } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';
import { SpatialRelevanceHubService } from '../../../spatial/spatial-relevance-hub.service';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';
import { ContainmentSource, LightSpatialState, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';

export interface ModelContainmentResult {
  inside: boolean;
  preEntry: boolean;
  preExit: boolean;
  spatialState: LightSpatialState;
  distanceToBoundary: number;
  boundaryPoint?: Vector3;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: ContainmentSource;
}

interface ContainerGeometryCache {
  containerUid: string;
  matrixHash: string;
  source: ContainmentSource;
  entryPoints: Vector3[];
  allRenderableMeshes: AbstractMesh[];
  minWorld: Vector3;
  maxWorld: Vector3;
  minLocal: Vector3;
  maxLocal: Vector3;
  centerWorld: Vector3;
  invWorldMatrix: Matrix;
  boundingDiagonal: number;
  corridorApproxWidth: number;
  lastAnalyzedTime: number;
}

@Injectable({ providedIn: 'root' })
export class LightContainmentService {
  private entityManager = inject(EntityManagerService);
  private injector = inject(Injector);

  private _spatialHub: SpatialRelevanceHubService | null = null;
  private get spatialHub(): SpatialRelevanceHubService {
    if (!this._spatialHub) this._spatialHub = this.injector.get(SpatialRelevanceHubService);
    return this._spatialHub;
  }

  private _spatialGroups: SpatialStreamingGroupService | null = null;
  private get spatialGroups(): SpatialStreamingGroupService {
    if (!this._spatialGroups) this._spatialGroups = this.injector.get(SpatialStreamingGroupService);
    return this._spatialGroups;
  }

  private containerRenderablesCache = new Map<string, AbstractMesh[]>();
  private strictInteriorReceiversCache = new Map<string, AbstractMesh[]>();
  private containerGeometryCache = new Map<string, ContainerGeometryCache>();

  private _tempLocalActorPos = Vector3.Zero();

  public metrics = {
    containmentRebuilds: 0,
    cacheHits: 0,
    cacheMisses: 0,
    preciseEvaluations: 0
  };

  public markDirty(containerOrLightUid?: string): void {
    if (containerOrLightUid) {
      for (const key of this.strictInteriorReceiversCache.keys()) {
        if (key.includes(containerOrLightUid)) {
          this.strictInteriorReceiversCache.delete(key);
        }
      }
      this.containerRenderablesCache.delete(containerOrLightUid);
      this.containerGeometryCache.delete(containerOrLightUid);
    } else {
      this.clearAllCache();
    }
  }

  public clearAllCache(): void {
    this.containerRenderablesCache.clear();
    this.strictInteriorReceiversCache.clear();
    this.containerGeometryCache.clear();
    this.metrics.containmentRebuilds = 0;
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
    this.metrics.preciseEvaluations = 0;
  }

  public resolveContainerEntity(lightEntity: GameEntity, scene: Scene): GameEntity | null {
    const lightComp = lightEntity.light;
    if (!lightComp) return null;

    if (lightComp.containerEntityUid) {
      const explicit = this.entityManager.getEntityByUid(lightComp.containerEntityUid);
      if (explicit && explicit.view && !explicit.view.isDisposed()) return explicit;
    }

    if (lightEntity.parentId) {
      const parentEnt = this.entityManager.getEntityByUid(lightEntity.parentId);
      if (parentEnt && parentEnt.view && !parentEnt.view.isDisposed()) {
        return parentEnt;
      }
    }

    if (lightEntity.view && lightEntity.view.parent) {
      let currentParent: Node | null = lightEntity.view.parent;
      while (currentParent) {
        const ent = this.entityManager.getEntityByMesh(currentParent as AbstractMesh);
        if (ent && ent.uid !== lightEntity.uid && (ent.type === 'model' || ent.type === 'cube')) {
          return ent;
        }
        currentParent = currentParent.parent;
      }
    }

    const lightPos = lightEntity.view
      ? lightEntity.view.getAbsolutePosition()
      : new Vector3(lightEntity.transform.position.x, lightEntity.transform.position.y, lightEntity.transform.position.z);

    const candidates = this.entityManager.getAllEntities().filter(
      e => e.uid !== lightEntity.uid && (e.type === 'model' || e.type === 'cube') && e.view && !e.view.isDisposed() && !e.type.startsWith('light_') && e.rol !== 'light'
    );

    let closestContainer: GameEntity | null = null;
    let smallestDist = Number.MAX_VALUE;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand.view) continue;

      const rec = this.spatialHub.getRecord(cand.uid);
      if (!rec) continue;

      const dist = Vector3.Distance(rec.centerWorld, lightPos);
      if (
        lightPos.x >= rec.minWorld.x - 0.5 && lightPos.x <= rec.maxWorld.x + 0.5 &&
        lightPos.y >= rec.minWorld.y - 0.5 && lightPos.y <= rec.maxWorld.y + 0.5 &&
        lightPos.z >= rec.minWorld.z - 0.5 && lightPos.z <= rec.maxWorld.z + 0.5
      ) {
        return cand;
      }

      if (dist < smallestDist) {
        smallestDist = dist;
        closestContainer = cand;
      }
    }

    return closestContainer;
  }

  public analyzeContainerGeometry(container: GameEntity, scene: Scene): ContainerGeometryCache {
    const rootMesh = container.view;
    if (!rootMesh || rootMesh.isDisposed()) {
      return {
        containerUid: container.uid,
        matrixHash: '',
        source: 'AABB_FALLBACK',
        entryPoints: [Vector3.Zero()],
        allRenderableMeshes: [],
        minWorld: Vector3.Zero(),
        maxWorld: Vector3.Zero(),
        minLocal: Vector3.Zero(),
        maxLocal: Vector3.Zero(),
        centerWorld: Vector3.Zero(),
        invWorldMatrix: Matrix.Identity(),
        boundingDiagonal: 10.0,
        corridorApproxWidth: 4.0,
        lastAnalyzedTime: performance.now()
      };
    }

    rootMesh.computeWorldMatrix(true);
    const wm = rootMesh.getWorldMatrix();
    const matrixHash = `${wm.m[12].toFixed(2)}_${wm.m[13].toFixed(2)}_${wm.m[14].toFixed(2)}_${rootMesh.scaling.x.toFixed(2)}`;

    const cached = this.containerGeometryCache.get(container.uid);
    if (cached && cached.matrixHash === matrixHash) {
      this.metrics.cacheHits++;
      return cached;
    }

    this.metrics.cacheMisses++;
    this.metrics.containmentRebuilds++;

    const invWorldMatrix = Matrix.Invert(wm);
    const { renderables } = this.getAllRenderableMeshesFromModel(rootMesh);
    const entryPoints: Vector3[] = [];

    const group = this.spatialGroups.getGroupForEntity(container.uid);
    if (group && group.portals.length > 0) {
      for (let p = 0; p < group.portals.length; p++) {
        entryPoints.push(group.portals[p].position.clone());
      }
    }

    let minWorld = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let maxWorld = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
    let minLocal = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let maxLocal = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    for (let i = 0; i < renderables.length; i++) {
      const m = renderables[i];
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      minWorld = Vector3.Minimize(minWorld, b.minimumWorld);
      maxWorld = Vector3.Maximize(maxWorld, b.maximumWorld);

      const vectorsWorld = b.vectorsWorld;
      for (let v = 0; v < vectorsWorld.length; v++) {
        const vLoc = Vector3.TransformCoordinates(vectorsWorld[v], invWorldMatrix);
        minLocal = Vector3.Minimize(minLocal, vLoc);
        maxLocal = Vector3.Maximize(maxLocal, vLoc);
      }
    }

    if (renderables.length === 0) {
      const b = rootMesh.getBoundingInfo().boundingBox;
      minWorld = b.minimumWorld.clone();
      maxWorld = b.maximumWorld.clone();
      for (let v = 0; v < b.vectorsWorld.length; v++) {
        const vLoc = Vector3.TransformCoordinates(b.vectorsWorld[v], invWorldMatrix);
        minLocal = Vector3.Minimize(minLocal, vLoc);
        maxLocal = Vector3.Maximize(maxLocal, vLoc);
      }
    }

    const centerWorld = minWorld.add(maxWorld).scale(0.5);
    const sizeWorld = maxWorld.subtract(minWorld);
    const boundingDiagonal = sizeWorld.length();
    const corridorApproxWidth = Math.max(3.0, Math.min(sizeWorld.x, sizeWorld.z));

    if (entryPoints.length === 0) {
      const extremityClusters: Vector3[] = [];
      const thresholdMargin = Math.max(2.5, corridorApproxWidth * 0.8);

      for (let i = 0; i < renderables.length; i++) {
        const m = renderables[i];
        const c = m.getBoundingInfo().boundingBox.centerWorld;

        const isAtEdgeX = (Math.abs(c.x - maxWorld.x) <= thresholdMargin) || (Math.abs(c.x - minWorld.x) <= thresholdMargin);
        const isAtEdgeZ = (Math.abs(c.z - maxWorld.z) <= thresholdMargin) || (Math.abs(c.z - minWorld.z) <= thresholdMargin);

        if (isAtEdgeX || isAtEdgeZ) {
          const pt = new Vector3(c.x, minWorld.y + 1.2, c.z);
          let existsClose = false;
          for (let k = 0; k < extremityClusters.length; k++) {
            if (Vector3.DistanceSquared(pt, extremityClusters[k]) < 16.0) {
              existsClose = true;
              break;
            }
          }
          if (!existsClose) {
            extremityClusters.push(pt);
          }
        }
      }

      if (extremityClusters.length > 0) {
        entryPoints.push(...extremityClusters);
      } else {
        const isLongitudinalZ = sizeWorld.z >= sizeWorld.x;
        if (isLongitudinalZ) {
          entryPoints.push(new Vector3(centerWorld.x, minWorld.y + 1.2, minWorld.z));
          entryPoints.push(new Vector3(centerWorld.x, minWorld.y + 1.2, maxWorld.z));
        } else {
          entryPoints.push(new Vector3(minWorld.x, minWorld.y + 1.2, centerWorld.z));
          entryPoints.push(new Vector3(maxWorld.x, minWorld.y + 1.2, centerWorld.z));
        }
      }
    }

    const result: ContainerGeometryCache = {
      containerUid: container.uid,
      matrixHash,
      source: 'GEOMETRY',
      entryPoints,
      allRenderableMeshes: renderables.length > 0 ? renderables : [rootMesh],
      minWorld,
      maxWorld,
      minLocal,
      maxLocal,
      centerWorld,
      invWorldMatrix,
      boundingDiagonal,
      corridorApproxWidth,
      lastAnalyzedTime: performance.now()
    };

    this.containerGeometryCache.set(container.uid, result);
    return result;
  }

  public evaluateModelContainment(
    actorWorldPos: Vector3,
    container: GameEntity | null,
    preEntryDistance: number = 16.0,
    wasInRange: boolean = false,
    actorVelocity: Vector3 = Vector3.Zero()
  ): ModelContainmentResult {
    if (!container || !container.view || container.view.isDisposed()) {
      return {
        inside: false,
        preEntry: false,
        preExit: false,
        spatialState: 'OUTSIDE',
        distanceToBoundary: Number.MAX_VALUE,
        confidence: 'LOW',
        source: 'AABB_FALLBACK'
      };
    }

    const scene = container.view.getScene();
    const geoData = this.analyzeContainerGeometry(container, scene);

    const min = geoData.minWorld;
    const max = geoData.maxWorld;

    const speed = actorVelocity.length();
    const lookAheadBonus = Math.min(10.0, speed * 1.0);
    const effectivePreEntryDistance = preEntryDistance + lookAheadBonus;

    const maxKeepAliveExitDistance = Math.max(effectivePreEntryDistance + 4.0, LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_MAX_DISTANCE);
    const broadMargin = wasInRange ? maxKeepAliveExitDistance + 2.0 : effectivePreEntryDistance + 2.0;

    const dxBroad = Math.max(0, (min.x - broadMargin) - actorWorldPos.x, actorWorldPos.x - (max.x + broadMargin));
    const dyBroad = Math.max(0, (min.y - 3.0) - actorWorldPos.y, actorWorldPos.y - (max.y + 3.0));
    const dzBroad = Math.max(0, (min.z - broadMargin) - actorWorldPos.z, actorWorldPos.z - (max.z + broadMargin));

    if (dxBroad > 0 || dyBroad > 0 || dzBroad > 0) {
      const distToBox = Math.sqrt(dxBroad * dxBroad + dyBroad * dyBroad + dzBroad * dzBroad);
      return {
        inside: false,
        preEntry: false,
        preExit: false,
        spatialState: 'OUTSIDE',
        distanceToBoundary: distToBox,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    this.metrics.preciseEvaluations++;

    const isWithinVerticalBounds = (
      actorWorldPos.y >= (min.y - 1.5) && actorWorldPos.y <= (max.y + 2.5)
    );

    Vector3.TransformCoordinatesToRef(actorWorldPos, geoData.invWorldMatrix, this._tempLocalActorPos);
    const locPos = this._tempLocalActorPos;
    const locMin = geoData.minLocal;
    const locMax = geoData.maxLocal;

    const tolXZ = wasInRange ? 1.0 : 0.4;
    const isInsideLocalAABB =
      locPos.x >= locMin.x - tolXZ && locPos.x <= locMax.x + tolXZ &&
      locPos.z >= locMin.z - tolXZ && locPos.z <= locMax.z + tolXZ;

    let isUnderRoof = false;
    if (isWithinVerticalBounds && isInsideLocalAABB && geoData.allRenderableMeshes.length > 0) {
      const rayOrigin = new Vector3(actorWorldPos.x, actorWorldPos.y + 0.5, actorWorldPos.z);
      const upRay = new Ray(rayOrigin, Vector3.Up(), 12.0);
      const hitUp = scene.pickWithRay(upRay, (m) => {
        return geoData.allRenderableMeshes.includes(m as AbstractMesh);
      });
      if (hitUp && hitUp.hit && hitUp.pickedMesh) {
        isUnderRoof = true;
      }
    }

    let minDistanceToEntry = Number.MAX_VALUE;
    let closestEntryPoint = geoData.entryPoints[0];

    for (let i = 0; i < geoData.entryPoints.length; i++) {
      const ep = geoData.entryPoints[i];
      const d = Vector3.Distance(actorWorldPos, ep);
      if (d < minDistanceToEntry) {
        minDistanceToEntry = d;
        closestEntryPoint = ep;
      }
    }

    const isDeepInBox = isWithinVerticalBounds && isInsideLocalAABB && (minDistanceToEntry > 2.0);
    const isInsideGeometry = isWithinVerticalBounds && isInsideLocalAABB && (isUnderRoof || isDeepInBox);

    // 1. DENTRO DEL PASILLO
    if (isInsideGeometry) {
      return {
        inside: true,
        preEntry: false,
        preExit: false,
        spatialState: 'INSIDE',
        distanceToBoundary: 0,
        boundaryPoint: closestEntryPoint,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // 2. SALIDA PROGRESIVA CONTROLADA (PRE-EXIT)
    if (wasInRange && minDistanceToEntry <= maxKeepAliveExitDistance) {
      return {
        inside: false,
        preEntry: false,
        preExit: true,
        spatialState: 'PRE_EXIT',
        distanceToBoundary: minDistanceToEntry,
        boundaryPoint: closestEntryPoint,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // 3. APROXIMACIÓN ANTICIPADA HACIA LA ENTRADA (PRE-ENTRY)
    if (minDistanceToEntry <= effectivePreEntryDistance) {
      return {
        inside: false,
        preEntry: true,
        preExit: false,
        spatialState: 'PRE_ENTRY',
        distanceToBoundary: minDistanceToEntry,
        boundaryPoint: closestEntryPoint,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // 4. EXTERIOR
    return {
      inside: false,
      preEntry: false,
      preExit: false,
      spatialState: 'OUTSIDE',
      distanceToBoundary: minDistanceToEntry,
      boundaryPoint: closestEntryPoint,
      confidence: 'HIGH',
      source: geoData.source
    };
  }

  public getAllRenderableMeshesFromModel(rootNode: Node): {
    renderables: AbstractMesh[];
    totalDescendantsCount: number;
    rejected: Array<{ meshName: string; reason: string }>;
  } {
    const renderables: AbstractMesh[] = [];
    const rejected: Array<{ meshName: string; reason: string }> = [];
    let totalDescendantsCount = 0;
    const visitedNodes = new Set<Node>();

    const traverse = (node: Node) => {
      if (!node || visitedNodes.has(node)) return;
      visitedNodes.add(node);
      totalDescendantsCount++;

      if (node.isDisposed()) {
        return;
      }

      if (
        Tags.MatchesQuery(
          node,
          'editor_only || fog_element || debug_element || proxy_collider || invisible_floor || light_visual || ignore_raycast'
        )
      ) {
        return;
      }

      if (node instanceof AbstractMesh) {
        const className = node.getClassName();
        if (className === 'InstancedMesh') {
          const instanced = node as InstancedMesh;
          if (instanced.sourceMesh && !instanced.sourceMesh.isDisposed()) {
            renderables.push(instanced);
          }
        } else if (className === 'Mesh') {
          const mesh = node as Mesh;
          if (mesh.getTotalVertices() > 0) {
            renderables.push(mesh);
          }
        }
      }

      const children = node.getChildren(undefined, false);
      for (let i = 0; i < children.length; i++) {
        traverse(children[i]);
      }
    };

    traverse(rootNode);
    return { renderables, totalDescendantsCount, rejected };
  }

  /**
   * Aplica contención física de iluminación:
   * Para luces interiores, asegura que la luz ilumine al contenedor del pasillo y al jugador,
   * impidiendo que la luz afecte habitaciones lejanas o traspase el suelo sin restricción.
   */
  public applyContainment(light: PointLight | SpotLight, entity: GameEntity, scene: Scene): void {
    const mode: LightContainmentMode = entity.light?.containmentMode || 'GLOBAL';
    const affectDescendantsOnly = entity.light?.affectDescendantsOnly ?? false;

    if (mode === 'INTERIOR') {
      const container = this.resolveContainerEntity(entity, scene);
      if (container && container.view) {
        const { renderables } = this.getAllRenderableMeshesFromModel(container.view);

        if (affectDescendantsOnly) {
          light.includedOnlyMeshes = [...renderables];
          light.excludedMeshes = [];
          return;
        }

        // Si la luz sale por las puertas: iluminamos el pasillo y únicamente al actor/jugador
        // Bloqueamos que la luz se aplique a suelos exteriores lejanos sin sombra.
        const validReceivers = new Set<AbstractMesh>(renderables);

        // Añadir únicamente las mallas del jugador activo
        const playerEnt = this.entityManager.getAllEntities().find(e => e.rol === 'player' || !!e.characterConfig);
        if (playerEnt && playerEnt.view) {
          validReceivers.add(playerEnt.view as AbstractMesh);
          playerEnt.view.getChildMeshes(false).forEach(m => validReceivers.add(m));
        }

        light.includedOnlyMeshes = Array.from(validReceivers);
        light.excludedMeshes = [];
        return;
      }
    }

    // Modo GLOBAL: iluminación abierta estándar
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }

  public clearContainment(light: PointLight | SpotLight): void {
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }
}