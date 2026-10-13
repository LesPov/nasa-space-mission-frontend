// file: src/app/core/engine/runtime/systems/lighting/light-containment.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags, Mesh, InstancedMesh, Node, Matrix, Ray } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode, ConfiguredPortal } from '../../../entities/game.entity';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';
import { ContainmentSource, LightSpatialState } from './lighting-types';

export interface ModelContainmentResult {
  inside: boolean;
  preEntry: boolean;
  preExit: boolean;
  spatialState: LightSpatialState;
  distanceToBoundary: number;
  signedDistance: number;
  matchedPortalId?: string;
  progress: number;
  boundaryPoint?: Vector3;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: ContainmentSource;
}

export interface PortalOpening {
  id: string;
  name: string;
  position: Vector3;
  outwardNormal: Vector3;
  radius: number;
  width: number;
  height: number;
  depth: number;
  preEntryDistance: number;
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

  private _spatialGroups: SpatialStreamingGroupService | null = null;
  private get spatialGroups(): SpatialStreamingGroupService {
    if (!this._spatialGroups) this._spatialGroups = this.injector.get(SpatialStreamingGroupService);
    return this._spatialGroups;
  }

  private containerRenderablesCache = new Map<string, AbstractMesh[]>();
  private containerGeometryCache = new Map<string, ContainerGeometryCache>();

  private _tempRay = new Ray(Vector3.Zero(), Vector3.Up(), 50);

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

  public analyzeContainerGeometry(container: GameEntity, scene: Scene, configuredPortals?: ConfiguredPortal[]): ContainerGeometryCache {
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
    const portalConfigHash = (configuredPortals && configuredPortals.length > 0)
      ? configuredPortals.map(p => `${p.id}_${p.localPosition.x.toFixed(3)}_${p.localPosition.y.toFixed(3)}_${p.localPosition.z.toFixed(3)}_${(p.radius || 1.75).toFixed(3)}_${(p.preEntryDistance || 16).toFixed(2)}_${p.enabled}`).join(';')
      : 'auto';
    const matrixHash = `${wm.m[12].toFixed(2)}_${wm.m[13].toFixed(2)}_${wm.m[14].toFixed(2)}_${rootMesh.scaling.x.toFixed(2)}_${rootMesh.scaling.z.toFixed(2)}_${portalConfigHash}`;

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
    const corridorApproxHeight = Math.max(3.0, sizeWorld.y);
    const corridorApproxWidth = Math.max(3.0, Math.min(sizeWorld.x, sizeWorld.z));

    const parentScaleX = Math.abs(rootMesh.scaling.x || 1.0);
    const parentScaleY = Math.abs(rootMesh.scaling.y || 1.0);
    const parentScaleZ = Math.abs(rootMesh.scaling.z || 1.0);
    const maxHorizontalParentScale = Math.max(parentScaleX, parentScaleZ);

    const openings: PortalOpening[] = [];

    // Prioridad 1: Portales explícitamente configurados por el creador
    if (configuredPortals && configuredPortals.length > 0) {
      for (let p = 0; p < configuredPortals.length; p++) {
        const cp = configuredPortals[p];
        if (cp.enabled === false) continue;

        const locPos = new Vector3(cp.localPosition.x, cp.localPosition.y, cp.localPosition.z);
        
        let rawNormal = new Vector3(cp.localNormal.x, cp.localNormal.y, cp.localNormal.z);
        
        // Detección robusta de normal saliente cuando la normal guardada es nula o degenerada:
        // Se determina el eje principal de la posición local del portal respecto al centro del bounding box local.
        if (rawNormal.lengthSquared() < 0.0001) {
          const centerLocal = minLocal.add(maxLocal).scale(0.5);
          const deltaFromCenter = locPos.subtract(centerLocal);
          deltaFromCenter.y = 0;
          
          if (Math.abs(deltaFromCenter.z) >= Math.abs(deltaFromCenter.x)) {
            rawNormal = new Vector3(0, 0, deltaFromCenter.z < 0 ? -1 : 1);
          } else {
            rawNormal = new Vector3(deltaFromCenter.x < 0 ? -1 : 1, 0, 0);
          }
        }
        const locNorm = rawNormal.normalize();
        
        const worldPos = Vector3.TransformCoordinates(locPos, wm);
        const worldNorm = Vector3.TransformNormal(locNorm, wm).normalize();

        const baseRadius = cp.radius !== undefined ? cp.radius : ((cp.width || corridorApproxWidth) * 0.5);
        const worldPortalRadius = Math.max(2.0, baseRadius);

        const configuredDist = cp.preEntryDistance || 16.0;
        const effectivePreDist = Math.max(configuredDist, configuredDist * (maxHorizontalParentScale > 1.5 ? (maxHorizontalParentScale * 0.6) : 1.0));

        openings.push({
          id: cp.id,
          name: cp.name,
          position: worldPos,
          outwardNormal: worldNorm,
          radius: worldPortalRadius,
          width: cp.width || (worldPortalRadius * 2),
          height: (cp.height || corridorApproxHeight) * parentScaleY,
          depth: cp.depth || 2.0,
          preEntryDistance: effectivePreDist
        });
      }
    }

    // Prioridad 2: Portales derivados del grupo de streaming topológico
    if (openings.length === 0) {
      const group = this.spatialGroups.getGroupForEntity(container.uid);
      if (group && group.portals.length > 0) {
        for (let p = 0; p < group.portals.length; p++) {
          openings.push({
            id: `auto_portal_${p}`,
            name: `Portal Automático ${p + 1}`,
            position: group.portals[p].position.clone(),
            outwardNormal: group.portals[p].normal.normalize(),
            radius: 4.0 * maxHorizontalParentScale,
            width: (group.portals[p].width || corridorApproxWidth) * maxHorizontalParentScale,
            height: corridorApproxHeight,
            depth: 2.0,
            preEntryDistance: 24.0
          });
        }
      }
    }

    // Prioridad 3: Geometría de dos bocas en los extremos
    if (openings.length === 0) {
      const floorYWorld = minWorld.y + 1.2;
      const p1World = new Vector3(centerWorld.x, floorYWorld, minWorld.z);
      const n1World = new Vector3(0, 0, -1);
      openings.push({
        id: 'portal_boca_1',
        name: 'Abertura Frontal',
        position: p1World,
        outwardNormal: n1World,
        radius: 4.0 * maxHorizontalParentScale,
        width: corridorApproxWidth,
        height: corridorApproxHeight,
        depth: 2.0,
        preEntryDistance: 24.0
      });

      const p2World = new Vector3(centerWorld.x, floorYWorld, maxWorld.z);
      const n2World = new Vector3(0, 0, 1);
      openings.push({
        id: 'portal_boca_2',
        name: 'Abertura Posterior',
        position: p2World,
        outwardNormal: n2World,
        radius: 4.0 * maxHorizontalParentScale,
        width: corridorApproxWidth,
        height: corridorApproxHeight,
        depth: 2.0,
        preEntryDistance: 24.0
      });
    }

    const result: ContainerGeometryCache = {
      containerUid: container.uid,
      matrixHash,
      source: (configuredPortals && configuredPortals.length > 0) ? 'COLLISION_MESH' : 'GEOMETRY',
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
    preEntryDistance: number = 16.0,
    wasInRange: boolean = false,
    actorVelocity: Vector3 = Vector3.Zero(),
    configuredPortals?: ConfiguredPortal[]
  ): ModelContainmentResult {
    if (!container || !container.view || container.view.isDisposed()) {
      return {
        inside: false,
        preEntry: false,
        preExit: false,
        spatialState: 'OUTSIDE',
        distanceToBoundary: Number.MAX_VALUE,
        signedDistance: Number.MAX_VALUE,
        progress: 0,
        confidence: 'LOW',
        source: 'AABB_FALLBACK'
      };
    }

    const scene = container.view.getScene();
    const geoData = this.analyzeContainerGeometry(container, scene, configuredPortals);

    const minW = geoData.minWorld;
    const maxW = geoData.maxWorld;

    const maxConfiguredPre = Math.max(preEntryDistance, 35.0);
    const broadMargin = maxConfiguredPre + 35.0;
    if (
      actorWorldPos.x < (minW.x - broadMargin) || actorWorldPos.x > (maxW.x + broadMargin) ||
      actorWorldPos.z < (minW.z - broadMargin) || actorWorldPos.z > (maxW.z + broadMargin) ||
      actorWorldPos.y < (minW.y - 20.0) || actorWorldPos.y > (maxW.y + 30.0)
    ) {
      return {
        inside: false,
        preEntry: false,
        preExit: false,
        spatialState: 'OUTSIDE',
        distanceToBoundary: Number.MAX_VALUE,
        signedDistance: Number.MAX_VALUE,
        progress: 0,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    this.metrics.preciseEvaluations++;

    let bestPortalDist = Number.MAX_VALUE;
    let bestSignedDist = Number.MAX_VALUE;
    let matchedPortal: PortalOpening | null = null;
    let isInsidePortalPreEntryCone = false;
    let matchedPortalPreDist = preEntryDistance;
    let highestProgress = 0;

    // Evaluación direccional de cruce de portales
    let isCrossingInward = false;
    let isCrossingOutward = false;

    for (let i = 0; i < geoData.openings.length; i++) {
      const portal = geoData.openings[i];
      const portalPreDist = portal.preEntryDistance || preEntryDistance;
      const toActor = actorWorldPos.subtract(portal.position);
      const dist = toActor.length();

      const dotOutward = Vector3.Dot(toActor, portal.outwardNormal);
      const lateralDistSq = Math.max(0, (dist * dist) - (dotOutward * dotOutward));
      const lateralDist = Math.sqrt(lateralDistSq);

      const maxAllowedLateral = Math.max(14.0, portal.radius * 3.8);

      if (lateralDist <= maxAllowedLateral) {
        // Enfoque hacia el umbral exterior: dotOutward >= 0 (fuera del portal) hasta portalPreDist
        if (dotOutward >= 0.0 && dotOutward <= portalPreDist) {
          isInsidePortalPreEntryCone = true;
          const currentProg = Math.max(0, Math.min(1.0, 1.0 - (dotOutward / portalPreDist)));
          if (currentProg >= highestProgress) {
            highestProgress = currentProg;
            matchedPortal = portal;
            matchedPortalPreDist = portalPreDist;
            bestPortalDist = dist;
            bestSignedDist = dotOutward;
          }
        }

        // Justo al cruzar el portal hacia adentro (dotOutward < 0, hasta la profundidad del cono de entrada interior)
        if (dotOutward < 0.0 && dotOutward >= -Math.max(10.0, portal.radius * 2.5)) {
          // El jugador ha atravesado el plano hacia adentro en la zona del umbral
          isCrossingInward = true;
          if (!matchedPortal || dist < bestPortalDist) {
            matchedPortal = portal;
            matchedPortalPreDist = portalPreDist;
            bestPortalDist = dist;
            bestSignedDist = dotOutward;
          }
        }

        // Detección de presalida real: sólo si el jugador ya estaba adentro y se mueve hacia el exterior
        // (su vector velocidad tiene componente positiva a lo largo de outwardNormal)
        if (wasInRange && dotOutward >= -Math.max(8.0, portalPreDist * 0.5) && dotOutward <= 2.0) {
          const velocityDotOutward = Vector3.Dot(actorVelocity, portal.outwardNormal);
          if (velocityDotOutward > 0.1) {
            isCrossingOutward = true;
            if (!matchedPortal) {
              matchedPortal = portal;
              matchedPortalPreDist = portalPreDist;
              bestPortalDist = dist;
              bestSignedDist = dotOutward;
            }
          }
        }
      }

      if (dist < bestPortalDist && !matchedPortal) {
        bestPortalDist = dist;
        bestSignedDist = dotOutward;
        matchedPortalPreDist = portalPreDist;
      }
    }

    const isWithinHorizontalInterior = (
      actorWorldPos.x >= (minW.x - 3.5) && actorWorldPos.x <= (maxW.x + 3.5) &&
      actorWorldPos.z >= (minW.z - 3.5) && actorWorldPos.z <= (maxW.z + 3.5)
    );
    const isWithinVerticalInterior = (
      actorWorldPos.y >= (minW.y - 3.5) && actorWorldPos.y <= (maxW.y + 8.0)
    );

    let isRealInterior = false;

    // 1. Si acaba de cruzar el portal hacia el interior (dotOutward < 0 dentro del cono),
    // se confirma de forma inmediata el estado interior para evitar cualquier brecha o apagón.
    if (isCrossingInward && isWithinVerticalInterior) {
      isRealInterior = true;
    }

    // 2. Comprobación de permanencia en el interior por AABB y presencia en pasillo
    if (!isRealInterior && isWithinHorizontalInterior && isWithinVerticalInterior) {
      const group = this.spatialGroups.getGroupForEntity(container.uid);
      const isGroupActive = group && (group.state === 'ACTIVE' || group.isInsideVolume);

      if (wasInRange && (isGroupActive || !isCrossingOutward)) {
        isRealInterior = true;
      } else {
        const testOrigin = new Vector3(actorWorldPos.x, actorWorldPos.y + 0.5, actorWorldPos.z);
        this._tempRay.origin.copyFrom(testOrigin);
        this._tempRay.direction.set(0, 1, 0);
        this._tempRay.length = Math.max(30.0, geoData.corridorApproxHeight + 15.0);

        const hitUp = scene.pickWithRay(this._tempRay, (m) => geoData.allRenderableMeshes.includes(m as AbstractMesh));
        const hasRoofAbove = hitUp && hitUp.hit;

        this._tempRay.direction.set(0, -1, 0);
        this._tempRay.length = 15.0;
        const hitDown = scene.pickWithRay(this._tempRay, (m) => geoData.allRenderableMeshes.includes(m as AbstractMesh));
        const hasFloorBelow = hitDown && hitDown.hit;

        if ((hasRoofAbove && hasFloorBelow) || isGroupActive || (wasInRange && isWithinHorizontalInterior)) {
          isRealInterior = true;
        }
      }
    }

    // RESOLUCIÓN DE ESTADOS:

    // A. Si está dentro del interior (incluyendo el cruce inmediato tras el portal 1)
    if (isRealInterior) {
      // Solo transiciona a PRE_EXIT si el jugador va caminando deliberadamente hacia afuera y está cerca del umbral
      if (isCrossingOutward && bestSignedDist >= -4.0 && bestSignedDist <= 2.0) {
        return {
          inside: true,
          preEntry: false,
          preExit: true,
          spatialState: 'PRE_EXIT',
          distanceToBoundary: Math.max(0, bestPortalDist),
          signedDistance: bestSignedDist,
          matchedPortalId: matchedPortal?.id,
          progress: 1.0,
          confidence: 'HIGH',
          source: geoData.source
        };
      }

      // 100 % de intensidad permanente dentro de todo el pasillo
      return {
        inside: true,
        preEntry: false,
        preExit: false,
        spatialState: 'INSIDE',
        distanceToBoundary: 0,
        signedDistance: 0,
        matchedPortalId: matchedPortal?.id,
        progress: 1.0,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // B. En aproximación exterior (pre-entrada progresiva)
    if (isInsidePortalPreEntryCone && bestSignedDist >= 0.0 && bestSignedDist <= matchedPortalPreDist) {
      return {
        inside: false,
        preEntry: true,
        preExit: false,
        spatialState: 'PRE_ENTRY',
        distanceToBoundary: Math.max(0, bestSignedDist),
        signedDistance: bestSignedDist,
        matchedPortalId: matchedPortal?.id,
        progress: highestProgress,
        confidence: 'HIGH',
        source: geoData.source
      };
    }

    // C. En transición de salida hacia afuera ya iniciada
    if (wasInRange && isCrossingOutward && bestPortalDist <= (matchedPortalPreDist + 8.0)) {
      const exitProg = Math.max(0, 1.0 - (Math.max(0, bestSignedDist) / (matchedPortalPreDist + 8.0)));
      return {
        inside: false,
        preEntry: false,
        preExit: true,
        spatialState: 'PRE_EXIT',
        distanceToBoundary: bestPortalDist,
        signedDistance: bestSignedDist,
        matchedPortalId: matchedPortal?.id,
        progress: exitProg,
        confidence: 'MEDIUM',
        source: geoData.source
      };
    }

    // D. Completamente en el exterior
    return {
      inside: false,
      preEntry: false,
      preExit: false,
      spatialState: 'OUTSIDE',
      distanceToBoundary: bestPortalDist,
      signedDistance: bestSignedDist,
      matchedPortalId: matchedPortal?.id,
      progress: 0,
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

    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }

  public clearContainment(light: PointLight | SpotLight): void {
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }
}