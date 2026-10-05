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

export interface SpatialEntityRecord {
  uid: string;
  entity: GameEntity;
  centerWorld: Vector3;
  minWorld: Vector3;
  maxWorld: Vector3;
  boundingRadius: number;
  distSqToPlayer: number;
  distToPlayer: number | null;
  distSqToCamera: number;
  distToCamera: number | null;
  directionToPlayer: Vector3;
  dotWithCameraForward: number;
  lastUpdatedFrame: number;
}

export interface HubMetrics {
  evaluations: number;
  exactDistanceCalculations: number;
  squaredDistanceCalculations: number;
  cacheHits: number;
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

  private static readonly _fallbackPos = Vector3.Zero();
  private static readonly _tempCamFwd = Vector3.Zero();

  private lastRefPos = new Vector3(-99999, -99999, -99999);
  private currentRefPos = Vector3.Zero();
  private currentCamPos = Vector3.Zero();

  private _evaluations = 0;
  private _exactDistanceCalculations = 0;
  private _squaredDistanceCalculations = 0;
  private _cacheHits = 0;
  private _updateTimeMs = 0;

  public getMetrics(): HubMetrics {
    return {
      evaluations: this._evaluations,
      exactDistanceCalculations: this._exactDistanceCalculations,
      squaredDistanceCalculations: this._squaredDistanceCalculations,
      cacheHits: this._cacheHits,
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
        distToPlayer: null,
        distSqToCamera: Number.MAX_VALUE,
        distToCamera: null,
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

  public preUpdate(dtMs: number): void {
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
    const shouldRecomputeAll = refMovedSq > 0.0025 || this.frameCount % 8 === 0;

    if (shouldRecomputeAll) {
      this.lastRefPos.copyFrom(this.currentRefPos);

      let evals = 0;
      let sqCalls = 0;

      for (const [, record] of this.registry.entries()) {
        const entity = record.entity;
        if (!entity.view || entity.view.isDisposed()) {
          continue;
        }

        if (entity.isDirty) {
          this.computeEntityBounds(record);
        }

        // Distancia euclidiana exacta a la superficie del AABB (0 si el player está dentro de la caja)
        const cx = Math.max(record.minWorld.x, Math.min(this.currentRefPos.x, record.maxWorld.x));
        const cy = Math.max(record.minWorld.y, Math.min(this.currentRefPos.y, record.maxWorld.y));
        const cz = Math.max(record.minWorld.z, Math.min(this.currentRefPos.z, record.maxWorld.z));
        
        const dx = this.currentRefPos.x - cx;
        const dy = this.currentRefPos.y - cy;
        const dz = this.currentRefPos.z - cz;
        
        record.distSqToPlayer = dx * dx + dy * dy + dz * dz;
        record.distToPlayer = null;
        sqCalls++;

        const cdx = this.currentCamPos.x - record.centerWorld.x;
        const cdy = this.currentCamPos.y - record.centerWorld.y;
        const cdz = this.currentCamPos.z - record.centerWorld.z;
        record.distSqToCamera = cdx * cdx + cdy * cdy + cdz * cdz;
        record.distToCamera = null;
        sqCalls++;

        if (record.distSqToCamera > 0.01) {
          const invDist = 1.0 / Math.sqrt(record.distSqToCamera);
          const dirX = (record.centerWorld.x - this.currentCamPos.x) * invDist;
          const dirZ = (record.centerWorld.z - this.currentCamPos.z) * invDist;
          record.dotWithCameraForward = (dirX * SpatialRelevanceHubService._tempCamFwd.x) + (dirZ * SpatialRelevanceHubService._tempCamFwd.z);
        } else {
          record.dotWithCameraForward = 1.0;
        }

        record.lastUpdatedFrame = this.frameCount;
        evals++;
      }

      this._evaluations = evals;
      this._squaredDistanceCalculations = sqCalls;
    }

    this._updateTimeMs = performance.now() - tStart;
  }

  public getRecord(uid: string): SpatialEntityRecord | null {
    const record = this.registry.get(uid);
    if (record) {
      this._cacheHits++;
      return record;
    }

    const entity = this.entityManager.getEntityByUid(uid);
    if (entity) {
      return this.registerEntity(entity);
    }
    return null;
  }

  public getDistanceSquaredToPlayer(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distSqToPlayer : Number.MAX_VALUE;
  }

  public getDistanceToPlayer(uid: string): number {
    const record = this.getRecord(uid);
    if (!record) return Number.MAX_VALUE;

    if (record.distToPlayer === null) {
      record.distToPlayer = Math.sqrt(record.distSqToPlayer);
      this._exactDistanceCalculations++;
    }
    return record.distToPlayer;
  }

  public getDistanceSquaredToCamera(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distSqToCamera : Number.MAX_VALUE;
  }

  public getDistanceToCamera(uid: string): number {
    const record = this.getRecord(uid);
    if (!record) return Number.MAX_VALUE;

    if (record.distToCamera === null) {
      record.distToCamera = Math.sqrt(record.distSqToCamera);
      this._exactDistanceCalculations++;
    }
    return record.distToCamera;
  }
}