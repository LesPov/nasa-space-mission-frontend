// file: src/app/core/engine/runtime/systems/lighting/light-containment.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags, Mesh, InstancedMesh, Node, Matrix, Ray } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';
import { SpatialRelevanceHubService } from '../../../spatial/spatial-relevance-hub.service';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';
import { ContainmentSource, LightSpatialState } from './lighting-types';

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

export interface PortalOpening {
  position: Vector3;
  outwardNormal: Vector3;
  width: number;
  height: number;
}

interface ContainerGeometryCache {
  containerUid: string;
  matrixHash: string;
  source: ContainmentSource;
  openings: PortalOpening[];
  allRenderableMeshes: AbstractMesh[];
  minWorld: Vector3;
  maxWorld: Vector3;
  minLocal: Vector3;
  maxLocal: Vector3;
  centerWorld: Vector3;
  invWorldMatrix: Matrix;
  worldMatrix: Matrix;
  corridorApproxWidth: number;
  corridorApproxHeight: number;
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
  private containerGeometryCache = new Map<string, ContainerGeometryCache>();

  private _tempRay = new Ray(Vector3.Zero(), Vector3.Up(), 20);

  public metrics = {
    containmentRebuilds: 0,
    cacheHits: 0,
    cacheMisses: 0,
    preciseEvaluations: 0
  };

  public markDirty(containerOrLightUid?: string): void {
    if (containerOrLightUid) {
      this.containerRenderablesCache.delete(containerOrLightUid);
      this.containerGeometryCache.delete(containerOrLightUid);
    } else {
      this.clearAllCache();
    }
  }

  public clearAllCache(): void {
    this.containerRenderablesCache.clear();
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

    // Si la vista en Babylon tiene padre, buscar la entidad correspondiente
    if (lightEntity.view && lightEntity.view.parent) {
      let p: any = lightEntity.view.parent;
      while (p) {
        const ent = this.entityManager.getEntityByMesh(p);
        if (ent && ent.view && !ent.view.isDisposed()) {
          return ent;
        }
        p = p.parent;
      }
    }

    return null;
  }

  public analyzeContainerGeometry(container: GameEntity, scene: Scene): ContainerGeometryCache {
    const rootMesh = container.view;
    if (!rootMesh || rootMesh.isDisposed()) {
      return {
        containerUid: container.uid,
        matrixHash: '',
        source: 'AABB_FALLBACK',
        openings: [],
        allRenderableMeshes: [],
        minWorld: Vector3.Zero(),
        maxWorld: Vector3.Zero(),
        minLocal: Vector3.Zero(),
        maxLocal: Vector3.Zero(),
        centerWorld: Vector3.Zero(),
        invWorldMatrix: Matrix.Identity(),
        worldMatrix: Matrix.Identity(),
        corridorApproxWidth: 4.0,
        corridorApproxHeight: 4.0,
        lastAnalyzedTime: performance.now()
      };
    }

    rootMesh.computeWorldMatrix(true);
    const wm = rootMesh.getWorldMatrix();
    const matrixHash = `${wm.m[12].toFixed(2)}_${wm.m[13].toFixed(2)}_${wm.m[14].toFixed(2)}_${rootMesh.scaling.x.toFixed(2)}_${rootMesh.scaling.z.toFixed(2)}`;

    const cached = this.containerGeometryCache.get(container.uid);
    if (cached && cached.matrixHash === matrixHash) {
      this.metrics.cacheHits++;
      return cached;
    }

    this.metrics.cacheMisses++;
    this.metrics.containmentRebuilds++;

    const invWorldMatrix = Matrix.Invert(wm);
    const { renderables } = this.getAllRenderableMeshesFromModel(rootMesh);

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
    const sizeLocal = maxLocal.subtract(minLocal);
    const corridorApproxHeight = Math.max(3.0, sizeWorld.y);
    const corridorApproxWidth = Math.max(3.0, Math.min(sizeWorld.x, sizeWorld.z));

    const openings: PortalOpening[] = [];

    const group = this.spatialGroups.getGroupForEntity(container.uid);
    if (group && group.portals.length > 0) {
      for (let p = 0; p < group.portals.length; p++) {
        openings.push({
          position: group.portals[p].position.clone(),
          outwardNormal: group.portals[p].normal.clone(),
          width: group.portals[p].width || corridorApproxWidth,
          height: corridorApproxHeight
        });
      }
    }

    if (openings.length === 0) {
      const floorYWorld = minWorld.y + 1.2;

      // Boca 1: Extremo de la abertura Z
      const p1World = new Vector3(centerWorld.x, floorYWorld, minWorld.z);
      const n1World = new Vector3(0, 0, -1);
      openings.push({ position: p1World, outwardNormal: n1World, width: corridorApproxWidth, height: corridorApproxHeight });

      // Boca 2: Extremo de la abertura X
      const p2World = new Vector3(maxWorld.x, floorYWorld, centerWorld.z);
      const n2World = new Vector3(1, 0, 0);
      openings.push({ position: p2World, outwardNormal: n2World, width: corridorApproxWidth, height: corridorApproxHeight });
    }

    const result: ContainerGeometryCache = {
      containerUid: container.uid,
      matrixHash,
      source: 'GEOMETRY',
      openings,
      allRenderableMeshes: renderables.length > 0 ? renderables : [rootMesh],
      minWorld,
      maxWorld,
      minLocal,
      maxLocal,
      centerWorld,
      invWorldMatrix,
      worldMatrix: wm.clone(),
      corridorApproxWidth,
      corridorApproxHeight,
      lastAnalyzedTime: performance.now()
    };

    this.containerGeometryCache.set(container.uid, result);
    return result;
  }

  public evaluateModelContainment(
    actorWorldPos: Vector3,
    container: GameEntity | null,
    preEntryDistance: number = 8.0,
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

    const minW = geoData.minWorld;
    const maxW = geoData.maxWorld;

    // Descarte preliminar fuera de la envolvente extendida
    const margin = Math.max(preEntryDistance + 6.0, 15.0);
    if (
      actorWorldPos.x < (minW.x - margin) || actorWorldPos.x > (maxW.x + margin) ||
      actorWorldPos.z < (minW.z - margin) || actorWorldPos.z > (maxW.z + margin) ||
      actorWorldPos.y < (minW.y - 4.0) || actorWorldPos.y > (maxW.y + 6.0)
    ) {
      return {
        inside: false,
        preEntry: false,
        preExit: false,
        spatialState: 'OUTSIDE',
        distanceToBoundary: Number.MAX_VALUE,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    this.metrics.preciseEvaluations++;

    // 1. Distancia a las bocas de entrada reales
    let bestPortalDist = Number.MAX_VALUE;
    let isFacingPortalEntrance = false;

    for (let i = 0; i < geoData.openings.length; i++) {
      const portal = geoData.openings[i];
      const toActor = actorWorldPos.subtract(portal.position);
      const dist = toActor.length();

      if (dist < bestPortalDist) {
        bestPortalDist = dist;
      }

      if (dist <= preEntryDistance) {
        const dotOutward = Vector3.Dot(toActor.normalize(), portal.outwardNormal);
        if (dotOutward >= -0.3) {
          isFacingPortalEntrance = true;
        }
      }
    }

    // 2. Detección de Interior Transitable:
    // El actor está dentro del bounding horizontal con margen de pared y bajo el techo del pasillo
    const isWithinHorizontalSpan = (
      actorWorldPos.x >= (minW.x + 0.5) && actorWorldPos.x <= (maxW.x - 0.5) &&
      actorWorldPos.z >= (minW.z + 0.5) && actorWorldPos.z <= (maxW.z - 0.5)
    );
    const isWithinVerticalSpan = (
      actorWorldPos.y >= (minW.y - 1.0) && actorWorldPos.y <= (maxW.y + 1.0)
    );

    // Verificación vertical con raycast amplio
    const testOrigin = new Vector3(actorWorldPos.x, actorWorldPos.y + 0.5, actorWorldPos.z);
    this._tempRay.origin.copyFrom(testOrigin);
    this._tempRay.direction.set(0, 1, 0);
    this._tempRay.length = Math.max(15.0, geoData.corridorApproxHeight + 6.0);

    const hitUp = scene.pickWithRay(this._tempRay, (m) => geoData.allRenderableMeshes.includes(m as AbstractMesh));
    const hasRoofAbove = hitUp && hitUp.hit;

    // Raycast hacia el piso del pasillo
    this._tempRay.direction.set(0, -1, 0);
    this._tempRay.length = 4.0;
    const hitDown = scene.pickWithRay(this._tempRay, (m) => geoData.allRenderableMeshes.includes(m as AbstractMesh));
    const hasFloorBelow = hitDown && hitDown.hit;

    const isInsideCorridor = (isWithinHorizontalSpan && isWithinVerticalSpan && (hasRoofAbove || hasFloorBelow));

    if (isInsideCorridor) {
      return {
        inside: true,
        preEntry: false,
        preExit: false,
        spatialState: 'INSIDE',
        distanceToBoundary: 0,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // 3. Pre-Entrada frente a la abertura de acceso
    if (isFacingPortalEntrance && bestPortalDist <= preEntryDistance) {
      return {
        inside: false,
        preEntry: true,
        preExit: false,
        spatialState: 'PRE_ENTRY',
        distanceToBoundary: bestPortalDist,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // 4. Pre-Salida suave al abandonar el pasillo
    if (wasInRange && bestPortalDist <= (preEntryDistance + 4.0)) {
      return {
        inside: false,
        preEntry: false,
        preExit: true,
        spatialState: 'PRE_EXIT',
        distanceToBoundary: bestPortalDist,
        confidence: 'MEDIUM',
        source: geoData.source
      };
    }

    return {
      inside: false,
      preEntry: false,
      preExit: false,
      spatialState: 'OUTSIDE',
      distanceToBoundary: bestPortalDist,
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

      if (node.isDisposed()) return;

      if (
        Tags.MatchesQuery(
          node,
          'editor_only || fog_element || debug_element || invisible_floor || light_visual || ignore_raycast'
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

  public applyContainment(light: PointLight | SpotLight, entity: GameEntity, scene: Scene): void {
    const mode: LightContainmentMode = entity.light?.containmentMode || 'GLOBAL';
    const affectDescendantsOnly = entity.light?.affectDescendantsOnly ?? false;

    if (mode === 'INTERIOR') {
      const container = this.resolveContainerEntity(entity, scene);
      if (container && container.view) {
        const { renderables } = this.getAllRenderableMeshesFromModel(container.view);

        // Si se pide explícitamente restringir solo a mallas del modelo:
        if (affectDescendantsOnly && renderables.length > 0) {
          const validReceivers = new Set<AbstractMesh>(renderables);
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
    }

    // Por defecto: la luz ilumina libremente el interior y las sombras se encargan de ocluir hacia el exterior
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }

  public clearContainment(light: PointLight | SpotLight): void {
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }
}