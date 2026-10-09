// file: src/app/core/engine/spatial/spatial-relevance-hub.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { Vector3, AbstractMesh, Tags } from '@babylonjs/core';
import { IUpdatable } from '../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameContextService } from '../session/game-context.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { GameEntity } from '../entities/game.entity';
import { LightReferenceService } from '../runtime/systems/lighting/light-reference.service';
import { LightTransformService } from '../runtime/systems/lighting/light-transform.service';
import { GameMode } from '../session/game-mode.model';

export interface SpatialEntityRecord {
  uid: string;
  entity: GameEntity;
  centerWorld: Vector3;
  minWorld: Vector3;
  maxWorld: Vector3;
  boundingRadius: number;
  distSqToPlayer: number;
  distToPlayer: number;
  distSqToCamera: number;
  distToCamera: number;
  directionToPlayer: Vector3;
  dotWithCameraForward: number;
  lastUpdatedFrame: number;
}

export interface HubMetrics {
  evaluations: number;
  exactDistanceCalculations: number;
  squaredDistanceCalculations: number;
  cacheHits: number;
  cacheMisses: number;
  registeredEntities: number;
  updateTimeMs: number;
}

@Injectable({ providedIn: 'root' })
export class SpatialRelevanceHubService implements IUpdatable {
  public id = 'SpatialRelevanceHubSystem';

  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private referenceSvc = inject(LightReferenceService);
  private lightTransform = inject(LightTransformService);
  private injector = inject(Injector);

  private _motor3d: ISceneAccess | null = null;
  private get motor3d(): ISceneAccess {
    if (!this._motor3d) {
      this._motor3d = this.injector.get(SCENE_ACCESS_TOKEN);
    }
    return this._motor3d;
  }

  private registry = new Map<string, SpatialEntityRecord>();
  private frameCount = 0;

  private static readonly _tempCamFwd = Vector3.Zero();
  private lastRefPos = new Vector3(-99999, -99999, -99999);
  private currentRefPos = Vector3.Zero();
  private currentCamPos = Vector3.Zero();

  private _evaluations = 0;
  private _exactDistanceCalculations = 0;
  private _squaredDistanceCalculations = 0;
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _updateTimeMs = 0;

  public getMetrics(): HubMetrics {
    return {
      evaluations: this._evaluations,
      exactDistanceCalculations: this._exactDistanceCalculations,
      squaredDistanceCalculations: this._squaredDistanceCalculations,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      registeredEntities: this.registry.size,
      updateTimeMs: this._updateTimeMs
    };
  }

  public start(): void {
    this.clear();
    this.rebuildRegistry();
  }

  public stop(): void {
    this.clear();
  }

  public clear(): void {
    this.registry.clear();
    this.lastRefPos.set(-99999, -99999, -99999);
    this._evaluations = 0;
    this._exactDistanceCalculations = 0;
    this._squaredDistanceCalculations = 0;
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._updateTimeMs = 0;
  }

  public rebuildRegistry(): void {
    this.registry.clear();
    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
      this.registerEntity(entities[i]);
    }
  }

  public registerEntity(entity: GameEntity): SpatialEntityRecord | null {
    if (!entity || !entity.view || entity.view.isDisposed()) return null;

    let record = this.registry.get(entity.uid);
    if (!record) {
      record = {
        uid: entity.uid,
        entity,
        centerWorld: Vector3.Zero(),
        minWorld: Vector3.Zero(),
        maxWorld: Vector3.Zero(),
        boundingRadius: 1.0,
        distSqToPlayer: Number.MAX_VALUE,
        distToPlayer: Number.MAX_VALUE,
        distSqToCamera: Number.MAX_VALUE,
        distToCamera: Number.MAX_VALUE,
        directionToPlayer: Vector3.Zero(),
        dotWithCameraForward: 0,
        lastUpdatedFrame: -1
      };
      this.registry.set(entity.uid, record);
    } else {
      record.entity = entity;
    }

    this.computeEntityBounds(record);
    return record;
  }

  public unregisterEntity(uid: string): void {
    this.registry.delete(uid);
  }

  private computeEntityBounds(record: SpatialEntityRecord): void {
    if (record.entity.type.startsWith('light_')) {
      this.lightTransform.getEntityWorldPosition(record.entity, record.centerWorld);
      record.minWorld.copyFrom(record.centerWorld);
      record.maxWorld.copyFrom(record.centerWorld);
      record.boundingRadius = record.entity.light?.range || 1.0;
      return;
    }

    const mesh = record.entity.view as AbstractMesh;
    if (!mesh || mesh.isDisposed()) {
      this.lightTransform.getEntityWorldPosition(record.entity, record.centerWorld);
      record.minWorld.copyFrom(record.centerWorld);
      record.maxWorld.copyFrom(record.centerWorld);
      record.boundingRadius = 1.0;
      return;
    }

    mesh.computeWorldMatrix(true);
    const bounds = mesh.getHierarchyBoundingVectors(true, (m: AbstractMesh) => {
      return !Tags.MatchesQuery(m, 'system_element || editor_only || proxy_collider || light_visual || debug_element || invisible_floor');
    });

    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x) || bounds.min.x > bounds.max.x) {
      this.lightTransform.getEntityWorldPosition(record.entity, record.centerWorld);
      record.minWorld.copyFrom(record.centerWorld);
      record.maxWorld.copyFrom(record.centerWorld);
      record.boundingRadius = 1.0;
      return;
    }

    record.minWorld.copyFrom(bounds.min);
    record.maxWorld.copyFrom(bounds.max);
    record.centerWorld.copyFrom(bounds.min).addInPlace(bounds.max).scaleInPlace(0.5);
    
    const diagonal = bounds.max.subtract(record.centerWorld);
    record.boundingRadius = Math.max(0.5, diagonal.length());
  }

  public getReferencePosition(): Vector3 {
    return this.referenceSvc.getReferencePosition('PLAYER');
  }

  public forceUpdatePositions(refPos: Vector3, camPos: Vector3, camFwd: Vector3): void {
    this.currentRefPos.copyFrom(refPos);
    this.currentCamPos.copyFrom(camPos);
    SpatialRelevanceHubService._tempCamFwd.copyFrom(camFwd);
    this.lastRefPos.copyFrom(refPos);

    for (const record of this.registry.values()) {
      this.computeDistancesForRecord(record);
    }
  }

  private computeDistancesForRecord(record: SpatialEntityRecord): void {
    if (!record.entity.view || record.entity.view.isDisposed()) return;
    
    if (record.entity.isDirty) {
      this.computeEntityBounds(record);
    }

    const cx = Math.max(record.minWorld.x, Math.min(this.currentRefPos.x, record.maxWorld.x));
    const cy = Math.max(record.minWorld.y, Math.min(this.currentRefPos.y, record.maxWorld.y));
    const cz = Math.max(record.minWorld.z, Math.min(this.currentRefPos.z, record.maxWorld.z));
    
    const dx = this.currentRefPos.x - cx;
    const dy = this.currentRefPos.y - cy;
    const dz = this.currentRefPos.z - cz;
    
    const dSqP = dx * dx + dy * dy + dz * dz;
    record.distSqToPlayer = dSqP;
    record.distToPlayer = Math.sqrt(dSqP); // Pre-calculado exactamente una sola vez

    const cdx = this.currentCamPos.x - record.centerWorld.x;
    const cdy = this.currentCamPos.y - record.centerWorld.y;
    const cdz = this.currentCamPos.z - record.centerWorld.z;
    const dSqC = cdx * cdx + cdy * cdy + cdz * cdz;
    record.distSqToCamera = dSqC;
    record.distToCamera = Math.sqrt(dSqC);

    if (record.distToCamera > 0.1) {
      const invDist = 1.0 / record.distToCamera;
      const dirX = (record.centerWorld.x - this.currentCamPos.x) * invDist;
      const dirZ = (record.centerWorld.z - this.currentCamPos.z) * invDist;
      record.dotWithCameraForward = (dirX * SpatialRelevanceHubService._tempCamFwd.x) + (dirZ * SpatialRelevanceHubService._tempCamFwd.z);
    } else {
      record.dotWithCameraForward = 1.0;
    }

    record.lastUpdatedFrame = this.frameCount;
  }

  public preUpdate(dtMs: number): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    const tStart = performance.now();
    this.frameCount++;

    const ref = this.getReferencePosition();
    this.currentRefPos.copyFrom(ref);

    const scene = this.motor3d.getScene();
    const cam = this.ownership.getCamera() || scene?.activeCamera || this.motor3d.getEditorCamera();
    if (cam) {
      cam.computeWorldMatrix();
      this.currentCamPos.copyFrom(cam.globalPosition);

      if (cam.getDirectionToRef) {
        cam.getDirectionToRef(Vector3.Forward(), SpatialRelevanceHubService._tempCamFwd);
      } else {
        SpatialRelevanceHubService._tempCamFwd.copyFrom(cam.getDirection(Vector3.Forward()));
      }
      SpatialRelevanceHubService._tempCamFwd.y = 0;
      SpatialRelevanceHubService._tempCamFwd.normalize();
    } else {
      this.currentCamPos.copyFrom(ref);
      SpatialRelevanceHubService._tempCamFwd.set(0, 0, 1);
    }

    const refMovedSq = Vector3.DistanceSquared(this.lastRefPos, this.currentRefPos);

    if (isEditor && refMovedSq < 0.001 && this.frameCount > 10) {
      this._updateTimeMs = performance.now() - tStart;
      return;
    }

    const shouldRecomputeAll = refMovedSq > 0.01 || this.frameCount % 10 === 0;

    if (shouldRecomputeAll) {
      this.lastRefPos.copyFrom(this.currentRefPos);
      let evals = 0;

      for (const record of this.registry.values()) {
        this.computeDistancesForRecord(record);
        evals++;
      }

      this._evaluations = evals;
      this._squaredDistanceCalculations = evals * 2;
      this._exactDistanceCalculations = evals * 2;
    }

    this._updateTimeMs = performance.now() - tStart;
  }

  public getRecord(uid: string): SpatialEntityRecord | null {
    const record = this.registry.get(uid);
    if (record) {
      this._cacheHits++;
      return record;
    }

    this._cacheMisses++;
    const entity = this.entityManager.getEntityByUid(uid);
    if (entity) {
      const newRec = this.registerEntity(entity);
      if (newRec) {
        this.computeDistancesForRecord(newRec);
        return newRec;
      }
    }
    return null;
  }

  public getDistanceSquaredToPlayer(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distSqToPlayer : Number.MAX_VALUE;
  }

  public getDistanceToPlayer(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distToPlayer : Number.MAX_VALUE;
  }

  public getDistanceSquaredToCamera(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distSqToCamera : Number.MAX_VALUE;
  }

  public getDistanceToCamera(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distToCamera : Number.MAX_VALUE;
  }
}