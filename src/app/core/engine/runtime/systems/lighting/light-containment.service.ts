// file: src/app/core/engine/runtime/systems/lighting/light-containment.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags, Mesh, InstancedMesh, Node, MultiMaterial, Matrix } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';
import { SpatialRelevanceHubService } from '../../../spatial/spatial-relevance-hub.service';
import { ContainmentSource, LightSpatialState } from './lighting-types';

export interface LightContainmentAuditReport {
  lightUid: string;
  containerUid: string;
  containerFound: boolean;
  containerName: string;
  runtimeRootName: string;
  totalDescendants: number;
  totalRenderableMeshes: number;
  totalReceivers: number;
  rejectedCount: number;
  rejectedDetails: Array<{ meshName: string; reason: string }>;
  materialsSummary: Array<{ meshName: string; materialType: string; isMulti: boolean; subMaterialsCount: number; maxLights: number }>;
}

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

export interface ContainerVolumeEvaluationResult {
  inside: boolean;
  inPreEntry: boolean;
  distToBox: number;
}

interface ContainerGeometryCache {
  containerUid: string;
  matrixHash: string;
  source: ContainmentSource;
  entryPoints: Vector3[];
  floorMeshes: AbstractMesh[];
  ceilingMeshes: AbstractMesh[];
  allRenderableMeshes: AbstractMesh[];
  minWorld: Vector3;
  maxWorld: Vector3;
  minLocal: Vector3;
  maxLocal: Vector3;
  centerWorld: Vector3;
  invWorldMatrix: Matrix;
  lastAnalyzedTime: number;
}

@Injectable({ providedIn: 'root' })
export class LightContainmentService {
  private entityManager = inject(EntityManagerService);
  private injector = inject(Injector);

  private _spatialHub: SpatialRelevanceHubService | null = null;
  private get spatialHub(): SpatialRelevanceHubService {
    if (!this._spatialHub) {
      this._spatialHub = this.injector.get(SpatialRelevanceHubService);
    }
    return this._spatialHub;
  }

  private containerRenderablesCache = new Map<string, AbstractMesh[]>();
  private strictInteriorReceiversCache = new Map<string, AbstractMesh[]>();
  private containerGeometryCache = new Map<string, ContainerGeometryCache>();
  private lastAuditReport: LightContainmentAuditReport | null = null;

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
    this.lastAuditReport = null;
    this.metrics.containmentRebuilds = 0;
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
    this.metrics.preciseEvaluations = 0;
  }

  public getLastAuditReport(): LightContainmentAuditReport | null {
    return this.lastAuditReport;
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
      : new Vector3(
          lightEntity.transform.position.x,
          lightEntity.transform.position.y,
          lightEntity.transform.position.z
        );

    const candidates = this.entityManager
      .getAllEntities()
      .filter(
        e =>
          e.uid !== lightEntity.uid &&
          (e.type === 'model' || e.type === 'cube') &&
          e.view &&
          !e.view.isDisposed()
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

  private analyzeContainerGeometry(container: GameEntity, scene: Scene): ContainerGeometryCache {
    const rootMesh = container.view;
    if (!rootMesh || rootMesh.isDisposed()) {
      return {
        containerUid: container.uid,
        matrixHash: '',
        source: 'AABB_FALLBACK',
        entryPoints: [Vector3.Zero()],
        floorMeshes: [],
        ceilingMeshes: [],
        allRenderableMeshes: [],
        minWorld: Vector3.Zero(),
        maxWorld: Vector3.Zero(),
        minLocal: Vector3.Zero(),
        maxLocal: Vector3.Zero(),
        centerWorld: Vector3.Zero(),
        invWorldMatrix: Matrix.Identity(),
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
    const floorMeshes: AbstractMesh[] = [];
    const ceilingMeshes: AbstractMesh[] = [];
    const entryPoints: Vector3[] = [];

    let source: ContainmentSource = container.collider?.type === 'mesh' ? 'COLLISION_MESH' : 'GEOMETRY';

    const descendants = rootMesh.getDescendants(false);
    for (let i = 0; i < descendants.length; i++) {
      const d = descendants[i];
      const nameL = d.name.toLowerCase();
      if (
        nameL.includes('door') ||
        nameL.includes('entry') ||
        nameL.includes('entrance') ||
        nameL.includes('portal') ||
        nameL.includes('opening') ||
        nameL.includes('entrada') ||
        nameL.includes('puerta') ||
        nameL.includes('salida')
      ) {
        if (d instanceof AbstractMesh || d instanceof Node) {
          entryPoints.push(d.getWorldMatrix().getTranslation().clone());
          source = 'EXPLICIT_MESH';
        }
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

      const nL = m.name.toLowerCase();
      if (nL.includes('floor') || nL.includes('piso') || nL.includes('suelo') || nL.includes('ground') || nL.includes('bottom')) {
        floorMeshes.push(m);
      } else if (nL.includes('roof') || nL.includes('techo') || nL.includes('ceiling') || nL.includes('top')) {
        ceilingMeshes.push(m);
      } else {
        floorMeshes.push(m);
        ceilingMeshes.push(m);
      }
    }

    if (renderables.length === 0) {
      const b = rootMesh.getBoundingInfo().boundingBox;
      minWorld = b.minimumWorld.clone();
      maxWorld = b.maximumWorld.clone();
      const vectorsWorld = b.vectorsWorld;
      for (let v = 0; v < vectorsWorld.length; v++) {
        const vLoc = Vector3.TransformCoordinates(vectorsWorld[v], invWorldMatrix);
        minLocal = Vector3.Minimize(minLocal, vLoc);
        maxLocal = Vector3.Maximize(maxLocal, vLoc);
      }
    }

    const centerWorld = minWorld.add(maxWorld).scale(0.5);
    const sizeWorld = maxWorld.subtract(minWorld);

    if (entryPoints.length === 0) {
      if (sizeWorld.x > sizeWorld.z) {
        entryPoints.push(new Vector3(minWorld.x, centerWorld.y, centerWorld.z));
        entryPoints.push(new Vector3(maxWorld.x, centerWorld.y, centerWorld.z));
      } else {
        entryPoints.push(new Vector3(centerWorld.x, centerWorld.y, minWorld.z));
        entryPoints.push(new Vector3(centerWorld.x, centerWorld.y, maxWorld.z));
      }
      source = 'GEOMETRY';
    }

    const result: ContainerGeometryCache = {
      containerUid: container.uid,
      matrixHash,
      source,
      entryPoints,
      floorMeshes,
      ceilingMeshes,
      allRenderableMeshes: renderables.length > 0 ? renderables : [rootMesh],
      minWorld,
      maxWorld,
      minLocal,
      maxLocal,
      centerWorld,
      invWorldMatrix,
      lastAnalyzedTime: performance.now()
    };

    this.containerGeometryCache.set(container.uid, result);
    return result;
  }

  public evaluateModelContainment(
    actorWorldPos: Vector3,
    container: GameEntity | null,
    preEntryDistance: number = 8.0,
    wasInRange: boolean = false
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
    const exitHysteresis = wasInRange ? 2.0 : 0.0;
    const broadMargin = preEntryDistance + exitHysteresis + 2.0;

    const dxBroad = Math.max(0, (min.x - broadMargin) - actorWorldPos.x, actorWorldPos.x - (max.x + broadMargin));
    const dyBroad = Math.max(0, (min.y - 2.0 - broadMargin) - actorWorldPos.y, actorWorldPos.y - (max.y + 2.0 + broadMargin));
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

    Vector3.TransformCoordinatesToRef(actorWorldPos, geoData.invWorldMatrix, this._tempLocalActorPos);
    const locPos = this._tempLocalActorPos;
    const locMin = geoData.minLocal;
    const locMax = geoData.maxLocal;

    const tolY = 1.8;
    const tolXZ = wasInRange ? 0.8 : 0.2;

    const isInsideLocalVolume =
      locPos.x >= locMin.x - tolXZ && locPos.x <= locMax.x + tolXZ &&
      locPos.y >= locMin.y - tolY && locPos.y <= locMax.y + tolY &&
      locPos.z >= locMin.z - tolXZ && locPos.z <= locMax.z + tolXZ;

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

    const dxLoc = Math.max(0, locMin.x - locPos.x, locPos.x - locMax.x);
    const dyLoc = Math.max(0, locMin.y - locPos.y, locPos.y - locMax.y);
    const dzLoc = Math.max(0, locMin.z - locPos.z, locPos.z - locMax.z);
    const distToLocalBox = Math.sqrt(dxLoc * dxLoc + dyLoc * dyLoc + dzLoc * dzLoc);

    if (isInsideLocalVolume) {
      const isNearExitOpening = minDistanceToEntry <= (wasInRange ? 3.0 : 2.0);
      return {
        inside: true,
        preEntry: false,
        preExit: isNearExitOpening,
        spatialState: isNearExitOpening ? 'PRE_EXIT' : 'INSIDE',
        distanceToBoundary: minDistanceToEntry,
        boundaryPoint: closestEntryPoint,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    const exitThreshold = preEntryDistance + exitHysteresis;
    if (wasInRange && (minDistanceToEntry <= exitThreshold || distToLocalBox <= 2.0)) {
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

    if (minDistanceToEntry <= preEntryDistance) {
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

    return {
      inside: false,
      preEntry: false,
      preExit: false,
      spatialState: 'OUTSIDE',
      distanceToBoundary: Math.min(minDistanceToEntry, distToLocalBox),
      boundaryPoint: closestEntryPoint,
      confidence: 'HIGH',
      source: geoData.source
    };
  }

  public evaluateActorInsideContainer(
    actorWorldPos: Vector3,
    container: GameEntity,
    preEntryDistance: number = 8.0,
    wasInRange: boolean = false
  ): ContainerVolumeEvaluationResult {
    const res = this.evaluateModelContainment(actorWorldPos, container, preEntryDistance, wasInRange);
    return {
      inside: res.inside,
      inPreEntry: res.preEntry,
      distToBox: res.distanceToBoundary
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
        rejected.push({ meshName: node.name, reason: 'Nodo descartado' });
        return;
      }

      if (
        Tags.MatchesQuery(
          node,
          'editor_only || fog_element || debug_element || proxy_collider || invisible_floor || light_visual || ignore_raycast'
        )
      ) {
        rejected.push({ meshName: node.name, reason: 'Etiqueta de sistema/colisionador' });
        return;
      }

      if (node instanceof AbstractMesh) {
        const className = node.getClassName();

        if (className === 'InstancedMesh') {
          const instanced = node as InstancedMesh;
          if (instanced.sourceMesh && !instanced.sourceMesh.isDisposed()) {
            renderables.push(instanced);
          } else {
            rejected.push({ meshName: node.name, reason: 'InstancedMesh sin sourceMesh válido' });
          }
        } else if (className === 'Mesh') {
          const mesh = node as Mesh;
          if (mesh.getTotalVertices() > 0) {
            renderables.push(mesh);
          } else {
            rejected.push({ meshName: node.name, reason: 'Mesh sin vértices' });
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

  public getInteriorMeshesStrict(lightEntity: GameEntity, scene: Scene): AbstractMesh[] {
    const cacheKey = `${lightEntity.uid}_${lightEntity.light?.containerEntityUid || 'auto'}`;

    if (this.strictInteriorReceiversCache.has(cacheKey)) {
      const cached = this.strictInteriorReceiversCache.get(cacheKey)!;
      const allValid = cached.every(m => m && !m.isDisposed() && m.getScene() === scene);

      if (allValid) {
        this.metrics.cacheHits++;
        return cached;
      } else {
        this.strictInteriorReceiversCache.delete(cacheKey);
      }
    }

    this.metrics.cacheMisses++;
    this.metrics.containmentRebuilds++;

    const container = this.resolveContainerEntity(lightEntity, scene);
    if (!container || !container.view) {
      this.strictInteriorReceiversCache.set(cacheKey, []);
      return [];
    }

    const { renderables, totalDescendantsCount, rejected } = this.getAllRenderableMeshesFromModel(container.view);
    const materialsSummary: LightContainmentAuditReport['materialsSummary'] = [];
    const finalReceiversSet = new Set<AbstractMesh>();

    for (let i = 0; i < renderables.length; i++) {
      const mesh = renderables[i];
      finalReceiversSet.add(mesh);

      const mat = mesh.material;
      if (mat) {
        if (mat.getClassName() === 'MultiMaterial') {
          const multi = mat as MultiMaterial;
          const subMats = multi.subMaterials || [];
          materialsSummary.push({
            meshName: mesh.name,
            materialType: 'MultiMaterial',
            isMulti: true,
            subMaterialsCount: subMats.length,
            maxLights: 10
          });
        } else {
          materialsSummary.push({
            meshName: mesh.name,
            materialType: mat.getClassName(),
            isMulti: false,
            subMaterialsCount: 1,
            maxLights: (mat as any).maxSimultaneousLights ?? 10
          });
        }
      }
    }

    const finalReceivers = Array.from(finalReceiversSet);
    this.strictInteriorReceiversCache.set(cacheKey, finalReceivers);

    this.lastAuditReport = {
      lightUid: lightEntity.uid,
      containerUid: container.uid,
      containerFound: true,
      containerName: container.name,
      runtimeRootName: container.view.name,
      totalDescendants: totalDescendantsCount,
      totalRenderableMeshes: renderables.length,
      totalReceivers: finalReceivers.length,
      rejectedCount: rejected.length,
      rejectedDetails: rejected,
      materialsSummary: materialsSummary
    };

    return finalReceivers;
  }

  public applyContainment(light: PointLight | SpotLight, entity: GameEntity, scene: Scene): void {
    const mode: LightContainmentMode = entity.light?.containmentMode || 'GLOBAL';
    const affectDescendantsOnly = entity.light?.affectDescendantsOnly ?? false;

    const cacheStamp = `${mode}_${entity.light?.containerEntityUid || ''}_${entity.uid}_${affectDescendantsOnly}`;
    if ((light as any)._containmentAppliedStamp === cacheStamp && !entity.isDirty) {
      return;
    }

    // CORRECCIÓN CLAVE: No aislar la luz excluyendo el resto de la escena salvo que se pida explícitamente
    if (mode === 'INTERIOR' && affectDescendantsOnly) {
      const receivers = this.getInteriorMeshesStrict(entity, scene);
      if (receivers.length > 0) {
        light.includedOnlyMeshes = [...receivers];
        light.excludedMeshes = [];
      } else {
        light.includedOnlyMeshes = [];
        light.excludedMeshes = [];
      }
    } else {
      light.includedOnlyMeshes = [];
      light.excludedMeshes = [];
    }

    (light as any)._containmentAppliedStamp = cacheStamp;
  }

  public clearContainment(light: PointLight | SpotLight): void {
    (light as any)._containmentAppliedStamp = undefined;
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }
}