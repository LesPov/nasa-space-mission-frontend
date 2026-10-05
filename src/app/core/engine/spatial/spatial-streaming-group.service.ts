// file: src/app/core/engine/spatial/spatial-streaming-group.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { SpatialGroup, SpatialGroupState, DEFAULT_SPATIAL_GROUP_CONFIG } from './spatial-group.model';
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

  // Filtro de velocidad del jugador (amortiguamiento contra saltos bruscos)
  private smoothedVelocity = Vector3.Zero();

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

  public isGroupReadyForGameplay(groupId: string): boolean {
    const grp = this.groups.get(groupId);
    if (!grp) return false;
    return grp.state === 'ACTIVE' || grp.state === 'PREACTIVATING' || grp.state === 'PREPARED';
  }

  public buildGroups(): void {
    this.clear();
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.isManuallyHidden) continue;

      const isContainer = e.type === 'model' || e.type === 'cube' || (e.view && e.view.getChildren().length > 0);
      const isRoot = !e.parentId && isContainer;

      if (isRoot) {
        const group: SpatialGroup = {
          id: `grp_${e.uid}`,
          name: e.name,
          rootEntityUid: e.uid,
          memberUids: new Set<string>([e.uid]),
          neighborGroupIds: new Set<string>(),
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
    this.discoverNeighborGroups();
  }

  private createAutonomousGroup(e: GameEntity): void {
    const group: SpatialGroup = {
      id: `grp_${e.uid}`,
      name: e.name,
      rootEntityUid: e.uid,
      memberUids: new Set<string>([e.uid]),
      neighborGroupIds: new Set<string>(),
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

  private discoverNeighborGroups(): void {
    const groupList = Array.from(this.groups.values());
    const PROXIMITY_NEIGHBOR_THRESHOLD = 32.0;

    for (let i = 0; i < groupList.length; i++) {
      const gA = groupList[i];
      for (let j = i + 1; j < groupList.length; j++) {
        const gB = groupList[j];

        const dx = Math.max(0, Math.max(gA.minWorld.x - gB.maxWorld.x, gB.minWorld.x - gA.maxWorld.x));
        const dy = Math.max(0, Math.max(gA.minWorld.y - gB.maxWorld.y, gB.minWorld.y - gA.maxWorld.y));
        const dz = Math.max(0, Math.max(gA.minWorld.z - gB.maxWorld.z, gB.minWorld.z - gA.maxWorld.z));
        const distBetweenBoxes = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distBetweenBoxes <= PROXIMITY_NEIGHBOR_THRESHOLD) {
          gA.neighborGroupIds.add(gB.id);
          gB.neighborGroupIds.add(gA.id);
        }
      }
    }
  }

  public updateGroups(playerPos: Vector3, playerVelocity: Vector3): void {
    const now = performance.now();

    // Filtro IIR de velocidad: suaviza cambios bruscos de dirección sin perder la aceleración real
    Vector3.LerpToRef(this.smoothedVelocity, playerVelocity, 0.25, this.smoothedVelocity);
    const speed = this.smoothedVelocity.length();

    const lookAheadDist = Math.min(
      DEFAULT_SPATIAL_GROUP_CONFIG.maxLookAheadDistance,
      Math.max(6.0, speed * DEFAULT_SPATIAL_GROUP_CONFIG.lookAheadMultiplier)
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

      if (!group.isInsideVolume && group.directionDot > 0.25) {
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
      this.profiler.recordTimelineEvent('ZONE', 'SPATIAL_LOOKAHEAD_CHANGED', {
        predictedTargetGroupId: bestPredictedTarget.id,
        predictedTargetName: bestPredictedTarget.name,
        lookAheadDistance: parseFloat(lookAheadDist.toFixed(1)),
        playerSpeed: parseFloat(speed.toFixed(1))
      });
    }

    // Regla Clave Anti-Flapping: Tiempo de gracia de 1.8 segundos antes de des-preactivar una zona
    const STATE_DEGRADE_GRACE_PERIOD_MS = 1800;

    for (const group of this.groups.values()) {
      const cfg = group.config;
      const isCurrent = Boolean(closestActiveGroup && group.id === closestActiveGroup.id);
      const isNeighborOfCurrent = closestActiveGroup ? closestActiveGroup.neighborGroupIds.has(group.id) : false;
      const isPredicted = Boolean(bestPredictedTarget && group.id === bestPredictedTarget.id);
      
      group.isPredictedTarget = isPredicted;
      const effectiveDist = Math.min(group.distanceToBox, group.predictedDistanceToBox);

      if (isCurrent || group.isInsideVolume || effectiveDist <= cfg.activeMargin) {
        this.transitionGroup(group, 'ACTIVE', now);
        this.activeGroupIds.add(group.id);
        this.preparedGroupIds.add(group.id);
      }
      else if ((isNeighborOfCurrent && group.directionDot > 0.15 && effectiveDist <= cfg.prepareMargin) || (isPredicted && effectiveDist <= cfg.prepareMargin)) {
        this.transitionGroup(group, 'PREACTIVATING', now);
        this.preactivatingGroupIds.add(group.id);
        this.preparedGroupIds.add(group.id);
      }
      else if (effectiveDist <= (cfg.preloadMargin + lookAheadDist)) {
        // Histéresis contra flap: si estaba en PREACTIVATING, retener al menos 1.8s antes de bajar a PREPARED
        const canDegrade = (now - group.lastStateChangeTimestamp) > STATE_DEGRADE_GRACE_PERIOD_MS;
        if (group.state === 'PREACTIVATING' && !canDegrade) {
          this.preactivatingGroupIds.add(group.id);
          this.preparedGroupIds.add(group.id);
        } else {
          this.transitionGroup(group, 'PREPARED', now);
          this.preparedGroupIds.add(group.id);
        }
      }
      else {
        const wasPreparedOrActive = group.state === 'ACTIVE' || group.state === 'PREACTIVATING' || group.state === 'PREPARED' || group.state === 'RETAINED';
        if (wasPreparedOrActive && effectiveDist <= (cfg.preloadMargin + cfg.retainDistance)) {
          this.transitionGroup(group, 'RETAINED', now);
          this.preparedGroupIds.add(group.id);
        } else {
          this.transitionGroup(group, 'DORMANT', now);
        }
      }
    }
  }

  private transitionGroup(group: SpatialGroup, newState: SpatialGroupState, now: number): void {
    if (group.state !== newState) {
      const oldState = group.state;
      group.previousState = oldState;
      group.state = newState;
      group.lastStateChangeTimestamp = now;

      if (newState === 'PREPARED' || newState === 'PREACTIVATING') {
        group.preparationProgress = 1.0;
        this.profiler.recordTimelineEvent('ZONE', `SPATIAL_PREPARE_COMPLETED`, {
          groupId: group.id,
          groupName: group.name,
          state: newState,
          memberCount: group.memberUids.size
        });
      } else if (newState === 'ACTIVE') {
        this.profiler.recordTimelineEvent('ZONE', `SPATIAL_ZONE_ACTIVATED`, {
          groupId: group.id,
          groupName: group.name,
          distanceToPlayer: parseFloat(group.distanceToPlayer.toFixed(1))
        });
      }
    }
  }
}