// file: src/app/core/engine/spatial/spatial-streaming-group.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { SpatialGroup, SpatialGroupState, DEFAULT_SPATIAL_GROUP_CONFIG } from './spatial-group.model';
import { EntityManagerService } from '../entities/entity-manager.service';
import { SpatialRelevanceHubService } from './spatial-relevance-hub.service';
import { GameEntity } from '../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class SpatialStreamingGroupService {
  private entityManager = inject(EntityManagerService);
  private spatialHub = inject(SpatialRelevanceHubService);

  private groups = new Map<string, SpatialGroup>();
  private entityToGroupId = new Map<string, string>();

  // Soporte simultáneo para múltiples grupos activos (fronteras entre pasillos/salas)
  private activeGroupIds = new Set<string>();
  private preparedGroupIds = new Set<string>();

  public clear(): void {
    this.groups.clear();
    this.entityToGroupId.clear();
    this.activeGroupIds.clear();
    this.preparedGroupIds.clear();
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
    const first = this.activeGroupIds.values().next();
    return first.done ? null : first.value;
  }

  public getActiveGroupIds(): Set<string> {
    return this.activeGroupIds;
  }

  public getPreparedGroupIds(): Set<string> {
    return this.preparedGroupIds;
  }

  public buildGroups(): void {
    this.clear();
    const entities = this.entityManager.getAllEntities();

    // 1. Identificar raíces de grupos (Modelos estructurales o contenedores)
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.isManuallyHidden) continue;

      const isContainer = e.type === 'model' || e.type === 'cube' || (e.view && e.view.getChildren().length > 0);
      const isRoot = !e.parentId && isContainer;

      if (isRoot) {
        const group: SpatialGroup = {
          id: `grp_${e.uid}`,
          rootEntityUid: e.uid,
          memberUids: new Set<string>([e.uid]),
          minWorld: new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
          maxWorld: new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE),
          centerWorld: Vector3.Zero(),
          boundingRadius: 1.0,
          state: 'DORMANT',
          previousState: 'DORMANT',
          distanceToPlayer: Number.MAX_VALUE,
          distanceToBox: Number.MAX_VALUE,
          isInsideVolume: false,
          config: { ...DEFAULT_SPATIAL_GROUP_CONFIG },
          lastStateChangeTimestamp: performance.now()
        };
        this.groups.set(group.id, group);
        this.entityToGroupId.set(e.uid, group.id);
      }
    }

    // 2. Asociar miembros por jerarquía de parentId o containerEntityUid
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
  }

  private createAutonomousGroup(e: GameEntity): void {
    const group: SpatialGroup = {
      id: `grp_${e.uid}`,
      rootEntityUid: e.uid,
      memberUids: new Set<string>([e.uid]),
      minWorld: new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
      maxWorld: new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE),
      centerWorld: Vector3.Zero(),
      boundingRadius: 1.0,
      state: 'DORMANT',
      previousState: 'DORMANT',
      distanceToPlayer: Number.MAX_VALUE,
      distanceToBox: Number.MAX_VALUE,
      isInsideVolume: false,
      config: { ...DEFAULT_SPATIAL_GROUP_CONFIG },
      lastStateChangeTimestamp: performance.now()
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

  public updateGroups(playerPos: Vector3, playerVelocity: Vector3): void {
    const now = performance.now();
    const speed = playerVelocity.length();
    // Look-ahead acotado a 40m con velocidad suavizada para evitar saltos
    const lookAheadBonus = Math.min(40.0, speed * 1.8);
    const moveDir = speed > 0.1 ? playerVelocity.normalizeToNew() : Vector3.Zero();
    const predictedPos = playerPos.add(moveDir.scale(lookAheadBonus));

    this.activeGroupIds.clear();
    this.preparedGroupIds.clear();

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
      const predictedDistToBox = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);

      const effectiveDist = Math.min(distToBox, predictedDistToBox);
      group.distanceToBox = distToBox;
      group.distanceToPlayer = Vector3.Distance(playerPos, group.centerWorld);
      group.isInsideVolume = (dx === 0 && dy === 0 && dz === 0);

      const cfg = group.config;
      const wasActive = group.state === 'ACTIVE';
      const wasPrepared = group.state === 'PREPARED' || wasActive || group.state === 'RETAINED';

      // 1. ZONA ACTIVA COMPLETA: Mantiene los modelos y pasillos conectados completamente activos
      if (group.isInsideVolume || effectiveDist <= cfg.activeMargin) {
        this.transitionGroup(group, 'ACTIVE', now);
        this.activeGroupIds.add(group.id);
        this.preparedGroupIds.add(group.id);
      }
      // 2. ZONA DE PRECARGA PREDICTIVA (PREPARED): Prepara con amplia anticipación (hasta 150m)
      else if (effectiveDist <= (cfg.preloadMargin + lookAheadBonus)) {
        if (wasActive) {
          this.transitionGroup(group, 'RETAINED', now);
        } else {
          this.transitionGroup(group, 'PREPARED', now);
        }
        this.preparedGroupIds.add(group.id);
      }
      // 3. RETENCIÓN CON HISTÉRESIS ANTES DE DORMIR
      else {
        if (wasPrepared && effectiveDist <= (cfg.preloadMargin + cfg.retainDistance)) {
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
      group.previousState = group.state;
      group.state = newState;
      group.lastStateChangeTimestamp = now;
    }
  }
}