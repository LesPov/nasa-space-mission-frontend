// file: src/app/core/engine/spatial/spatial-streaming-group.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, Tags } from '@babylonjs/core';
import { SpatialGroup, SpatialGroupState, SpatialPortal, DEFAULT_SPATIAL_GROUP_CONFIG } from './spatial-group.model';
import { EntityManagerService } from '../entities/entity-manager.service';
import { SpatialRelevanceHubService } from './spatial-relevance-hub.service';
import { GameEntity } from '../entities/game.entity';
import { EngineProfilerService } from '../telemetry/engine-profiler.service';

@Injectable({ providedIn: 'root' })
export class SpatialStreamingGroupService {
  private entityManager = inject(EntityManagerService);
  private spatialHub = inject(SpatialRelevanceHubService);
  private profiler = inject(EngineProfilerService);

  private groups = new Map<string, SpatialGroup>();
  private entityToGroupId = new Map<string, string>();

  private activeGroupIds = new Set<string>();
  private preparedGroupIds = new Set<string>();
  private preactivatingGroupIds = new Set<string>();

  private currentPrimaryGroupId: string | null = null;
  private predictedTargetGroupId: string | null = null;

  private smoothedVelocity = Vector3.Zero();

  // Umbral máximo de contacto para considerar que dos pasillos se tocan físicamente (m)
  private readonly CORRIDOR_ABUTTING_THRESHOLD = 3.5;

  public clear(): void {
    this.groups.clear();
    this.entityToGroupId.clear();
    this.activeGroupIds.clear();
    this.preparedGroupIds.clear();
    this.preactivatingGroupIds.clear();
    this.currentPrimaryGroupId = null;
    this.predictedTargetGroupId = null;
    this.smoothedVelocity.setAll(0);
  }

  public getGroups(): SpatialGroup[] {
    return Array.from(this.groups.values());
  }

  public getGroupById(groupId: string): SpatialGroup | undefined {
    return this.groups.get(groupId);
  }

  public getGroupIdForEntity(entityUid: string): string | null {
    return this.entityToGroupId.get(entityUid) || null;
  }

  public getGroupForEntity(entityUid: string): SpatialGroup | null {
    const gid = this.getGroupIdForEntity(entityUid);
    return gid ? this.groups.get(gid) || null : null;
  }

  public getActiveGroupId(): string | null {
    return this.currentPrimaryGroupId;
  }

  public getActiveGroupIds(): Set<string> {
    return this.activeGroupIds;
  }

  public getPreparedGroupIds(): Set<string> {
    return this.preparedGroupIds;
  }

  public getPreactivatingGroupIds(): Set<string> {
    return this.preactivatingGroupIds;
  }

  public getHopDistance(fromGroupId: string, toGroupId: string): number {
    if (fromGroupId === toGroupId) return 0;
    const gFrom = this.groups.get(fromGroupId);
    if (!gFrom) return 999;
    if (gFrom.neighborGroupIds.has(toGroupId)) return 1;

    for (const nId of gFrom.neighborGroupIds) {
      const gN = this.groups.get(nId);
      if (gN && gN.neighborGroupIds.has(toGroupId)) {
        return 2;
      }
    }
    return 999;
  }

  public isGroupReadyForGameplay(groupId: string): boolean {
    const grp = this.groups.get(groupId);
    if (!grp) return false;
    return grp.state === 'ACTIVE' || grp.state === 'PREACTIVATING' || grp.state === 'PREPARED';
  }

  private isIgnoredGroupEntity(e: GameEntity): boolean {
    if (e.isManuallyHidden) return true;
    if (e.rol === 'player' || e.characterConfig || e.rol === 'spawn_point') return true;
    if (e.type === 'trigger' || e.type === 'trigger_compuesto') return true;

    const nameL = e.name ? e.name.toLowerCase() : '';
    if (nameL.includes('piso') || nameL.includes('sueloinvisible') || nameL.includes('ground') || Tags.MatchesQuery(e.view, 'invisible_floor')) {
      return true;
    }
    return false;
  }

  public buildGroups(): void {
    this.clear();
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.isIgnoredGroupEntity(e)) continue;

      const isContainer = e.type === 'model' || e.type === 'cube' || (e.view && e.view.getChildren().length > 0);
      const isRoot = !e.parentId && isContainer;

      if (isRoot) {
        const group: SpatialGroup = {
          id: `grp_${e.uid}`,
          name: e.name,
          rootEntityUid: e.uid,
          memberUids: new Set<string>([e.uid]),
          neighborGroupIds: new Set<string>(),
          portals: [],
          minWorld: new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
          maxWorld: new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE),
          centerWorld: Vector3.Zero(),
          boundingRadius: 1.0,
          state: 'DORMANT',
          previousState: 'DORMANT',
          distanceToPlayer: Number.MAX_VALUE,
          distanceToBox: Number.MAX_VALUE,
          predictedDistanceToBox: Number.MAX_VALUE,
          directionDot: 0,
          isInsideVolume: false,
          isPredictedTarget: false,
          hopDistanceFromActive: 999,
          config: { ...DEFAULT_SPATIAL_GROUP_CONFIG },
          lastStateChangeTimestamp: performance.now(),
          preparationProgress: 0
        };
        this.groups.set(group.id, group);
        this.entityToGroupId.set(e.uid, group.id);
      }
    }

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.entityToGroupId.has(e.uid)) continue;
      if (this.isIgnoredGroupEntity(e)) continue;

      let rootUid = e.parentId;
      if (!rootUid && e.light?.containerEntityUid) {
        rootUid = e.light.containerEntityUid;
      }

      while (rootUid) {
        const parentEntity = this.entityManager.getEntityByUid(rootUid);
        if (!parentEntity || !parentEntity.parentId) break;
        rootUid = parentEntity.parentId;
      }

      if (rootUid) {
        const targetGroupId = `grp_${rootUid}`;
        const group = this.groups.get(targetGroupId);
        if (group) {
          group.memberUids.add(e.uid);
          this.entityToGroupId.set(e.uid, group.id);
        } else {
          this.createAutonomousGroup(e);
        }
      } else {
        this.createAutonomousGroup(e);
      }
    }

    this.recalculateAllBounds();
    this.discoverNeighborGroupsAndPortals();
  }

  private createAutonomousGroup(e: GameEntity): void {
    const group: SpatialGroup = {
      id: `grp_${e.uid}`,
      name: e.name,
      rootEntityUid: e.uid,
      memberUids: new Set<string>([e.uid]),
      neighborGroupIds: new Set<string>(),
      portals: [],
      minWorld: new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
      maxWorld: new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE),
      centerWorld: Vector3.Zero(),
      boundingRadius: 1.0,
      state: 'DORMANT',
      previousState: 'DORMANT',
      distanceToPlayer: Number.MAX_VALUE,
      distanceToBox: Number.MAX_VALUE,
      predictedDistanceToBox: Number.MAX_VALUE,
      directionDot: 0,
      isInsideVolume: false,
      isPredictedTarget: false,
      hopDistanceFromActive: 999,
      config: { ...DEFAULT_SPATIAL_GROUP_CONFIG },
      lastStateChangeTimestamp: performance.now(),
      preparationProgress: 0
    };
    this.groups.set(group.id, group);
    this.entityToGroupId.set(e.uid, group.id);
  }

  public recalculateAllBounds(): void {
    for (const group of this.groups.values()) {
      group.minWorld.set(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
      group.maxWorld.set(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

      let count = 0;
      for (const uid of group.memberUids) {
        const rec = this.spatialHub.getRecord(uid);
        if (rec) {
          group.minWorld.minimizeInPlace(rec.minWorld);
          group.maxWorld.maximizeInPlace(rec.maxWorld);
          count++;
        }
      }

      if (count > 0) {
        group.minWorld.addToRef(group.maxWorld, group.centerWorld);
        group.centerWorld.scaleInPlace(0.5);
        const diag = group.maxWorld.subtract(group.centerWorld);
        group.boundingRadius = Math.max(1.0, diag.length());
      } else {
        group.minWorld.setAll(0);
        group.maxWorld.setAll(0);
        group.centerWorld.setAll(0);
        group.boundingRadius = 1.0;
      }
    }
  }

  private discoverNeighborGroupsAndPortals(): void {
    const groupList = Array.from(this.groups.values());

    for (let i = 0; i < groupList.length; i++) {
      const gA = groupList[i];
      for (let j = i + 1; j < groupList.length; j++) {
        const gB = groupList[j];

        const dx = Math.max(0, Math.max(gA.minWorld.x - gB.maxWorld.x, gB.minWorld.x - gA.maxWorld.x));
        const dy = Math.max(0, Math.max(gA.minWorld.y - gB.maxWorld.y, gB.minWorld.y - gA.maxWorld.y));
        const dz = Math.max(0, Math.max(gA.minWorld.z - gB.maxWorld.z, gB.minWorld.z - gA.maxWorld.z));
        const distBetweenBoxes = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Umbral de adyacencia estricto (3.5 m). Impide unir pasillos lejanos separados por curvas o paredes
        if (distBetweenBoxes <= this.CORRIDOR_ABUTTING_THRESHOLD) {
          gA.neighborGroupIds.add(gB.id);
          gB.neighborGroupIds.add(gA.id);

          // Cálculo del punto medio de contacto para el portal de transición
          const portalPos = new Vector3(
            Math.max(gA.minWorld.x, gB.minWorld.x) * 0.5 + Math.min(gA.maxWorld.x, gB.maxWorld.x) * 0.5,
            Math.max(gA.minWorld.y, gB.minWorld.y) * 0.5 + Math.min(gA.maxWorld.y, gB.maxWorld.y) * 0.5,
            Math.max(gA.minWorld.z, gB.minWorld.z) * 0.5 + Math.min(gA.maxWorld.z, gB.maxWorld.z) * 0.5
          );

          const normalAB = gB.centerWorld.subtract(gA.centerWorld).normalize();
          const normalBA = normalAB.scale(-1);

          gA.portals.push({ targetGroupId: gB.id, position: portalPos.clone(), normal: normalAB, width: 3.0 });
          gB.portals.push({ targetGroupId: gA.id, position: portalPos.clone(), normal: normalBA, width: 3.0 });
        }
      }
    }

    // Identificar extremos con salidas hacia el exterior
    for (let i = 0; i < groupList.length; i++) {
      const g = groupList[i];
      if (g.neighborGroupIds.size <= 1) {
        // Segmento terminal (Pasillo 1 o Pasillo 3): añadir portal al exterior
        const portalPos = new Vector3(
          g.centerWorld.x,
          g.minWorld.y + 1.2,
          g.neighborGroupIds.size === 0 ? g.maxWorld.z : (g.minWorld.z < 0 ? g.minWorld.z : g.maxWorld.z)
        );
        g.portals.push({
          targetGroupId: 'EXTERIOR',
          position: portalPos,
          normal: new Vector3(0, 0, 1),
          width: 3.5
        });
      }
    }
  }

  public updateGroups(playerPos: Vector3, playerVelocity: Vector3): void {
    const now = performance.now();

    Vector3.LerpToRef(this.smoothedVelocity, playerVelocity, 0.25, this.smoothedVelocity);
    const speed = this.smoothedVelocity.length();

    const lookAheadDist = Math.min(
      DEFAULT_SPATIAL_GROUP_CONFIG.maxLookAheadDistance,
      Math.max(8.0, speed * DEFAULT_SPATIAL_GROUP_CONFIG.lookAheadMultiplier)
    );
    const moveDir = speed > 0.15 ? this.smoothedVelocity.normalizeToNew() : Vector3.Zero();
    const predictedPos = playerPos.add(moveDir.scale(lookAheadDist));

    this.activeGroupIds.clear();
    this.preparedGroupIds.clear();
    this.preactivatingGroupIds.clear();

    let closestActiveGroup: SpatialGroup | null = null;
    let minActiveDist = Number.MAX_VALUE;

    let bestPredictedTarget: SpatialGroup | null = null;
    let minPredictedDist = Number.MAX_VALUE;

    for (const group of this.groups.values()) {
      const min = group.minWorld;
      const max = group.maxWorld;

      const dx = Math.max(0, min.x - playerPos.x, playerPos.x - max.x);
      const dy = Math.max(0, min.y - playerPos.y, playerPos.y - max.y);
      const dz = Math.max(0, min.z - playerPos.z, playerPos.z - max.z);
      const distToBox = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const pdx = Math.max(0, min.x - predictedPos.x, predictedPos.x - max.x);
      const pdy = Math.max(0, min.y - predictedPos.y, predictedPos.y - max.y);
      const pdz = Math.max(0, min.z - predictedPos.z, predictedPos.z - max.z);
      const predDistToBox = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);

      group.distanceToBox = distToBox;
      group.predictedDistanceToBox = predDistToBox;
      group.distanceToPlayer = Vector3.Distance(playerPos, group.centerWorld);
      group.isInsideVolume = (dx === 0 && dy === 0 && dz === 0);

      if (speed > 0.2 && group.distanceToPlayer > 1.0) {
        const toCenterDir = group.centerWorld.subtract(playerPos).normalize();
        group.directionDot = Vector3.Dot(moveDir, toCenterDir);
      } else {
        group.directionDot = 0;
      }

      if (group.isInsideVolume) {
        if (group.distanceToPlayer < minActiveDist) {
          minActiveDist = group.distanceToPlayer;
          closestActiveGroup = group;
        }
      }

      if (!group.isInsideVolume && group.directionDot > 0.15) {
        if (predDistToBox < minPredictedDist) {
          minPredictedDist = predDistToBox;
          bestPredictedTarget = group;
        }
      }
    }

    if (!closestActiveGroup) {
      let nearestDist = Number.MAX_VALUE;
      for (const group of this.groups.values()) {
        if (group.distanceToBox < nearestDist) {
          nearestDist = group.distanceToBox;
          closestActiveGroup = group;
        }
      }
    }

    if (closestActiveGroup && this.currentPrimaryGroupId !== closestActiveGroup.id) {
      const prev = this.currentPrimaryGroupId;
      this.currentPrimaryGroupId = closestActiveGroup.id;
      this.profiler.recordTimelineEvent('ZONE', 'PRIMARY_GROUP_CHANGED', {
        previousGroupId: prev,
        newGroupId: closestActiveGroup.id,
        newGroupName: closestActiveGroup.name
      });
    }

    if (bestPredictedTarget && this.predictedTargetGroupId !== bestPredictedTarget.id) {
      this.predictedTargetGroupId = bestPredictedTarget.id;
    }

    // Actualización de distancias topológicas (Hops) desde el grupo primario
    const currentPrimary = this.currentPrimaryGroupId;
    for (const group of this.groups.values()) {
      group.hopDistanceFromActive = currentPrimary ? this.getHopDistance(currentPrimary, group.id) : 999;
    }

    for (const group of this.groups.values()) {
      const isCurrent = Boolean(closestActiveGroup && group.id === closestActiveGroup.id);
      const hop = group.hopDistanceFromActive;

      // Zonas a >= 2 saltos topológicos quedan estrictamente DORMANT
      if (hop >= 2 && !isCurrent) {
        this.transitionGroup(group, 'DORMANT', now);
        continue;
      }

      const isNeighborOfCurrent = hop === 1;
      const isPredicted = Boolean(bestPredictedTarget && group.id === bestPredictedTarget.id);
      group.isPredictedTarget = isPredicted;

      // Proximidad real hacia el portal que conecta con este vecino
      let distToConnectingPortal = Number.MAX_VALUE;
      if (isNeighborOfCurrent && closestActiveGroup) {
        for (let p = 0; p < closestActiveGroup.portals.length; p++) {
          const portal = closestActiveGroup.portals[p];
          if (portal.targetGroupId === group.id) {
            const d = Vector3.Distance(playerPos, portal.position);
            if (d < distToConnectingPortal) distToConnectingPortal = d;
          }
        }
      }

      if (isCurrent || group.isInsideVolume) {
        this.transitionGroup(group, 'ACTIVE', now);
        this.activeGroupIds.add(group.id);
        this.preparedGroupIds.add(group.id);
      }
      else if (isNeighborOfCurrent && (distToConnectingPortal <= group.config.prepareMargin || group.distanceToBox <= group.config.prepareMargin)) {
        this.transitionGroup(group, 'PREACTIVATING', now);
        this.preactivatingGroupIds.add(group.id);
        this.preparedGroupIds.add(group.id);
      }
      else if (isNeighborOfCurrent && (group.distanceToBox <= group.config.preloadMargin)) {
        this.transitionGroup(group, 'PREPARED', now);
        this.preparedGroupIds.add(group.id);
      }
      else {
        this.transitionGroup(group, 'DORMANT', now);
      }
    }
  }

  private transitionGroup(group: SpatialGroup, newState: SpatialGroupState, now: number): void {
    if (group.state !== newState) {
      group.previousState = group.state;
      group.state = newState;
      group.lastStateChangeTimestamp = now;

      if (newState === 'PREPARED' || newState === 'PREACTIVATING') {
        group.preparationProgress = 1.0;
        this.profiler.recordTimelineEvent('ZONE', 'SPATIAL_PREPARE_COMPLETED', {
          groupId: group.id,
          groupName: group.name,
          state: newState
        });
      } else if (newState === 'ACTIVE') {
        this.profiler.recordTimelineEvent('ZONE', 'SPATIAL_ZONE_ACTIVATED', {
          groupId: group.id,
          groupName: group.name
        });
      }
    }
  }
}