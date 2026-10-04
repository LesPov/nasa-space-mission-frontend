// file: src/app/core/engine/spatial/spatial-relevance-hub.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { Vector3, Matrix, AbstractMesh, Tags } from '@babylonjs/core';
import { IUpdatable } from '../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameContextService } from '../session/game-context.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { GameEntity } from '../entities/game.entity';
import { GameMode } from '../session/game-mode.model';

export interface SpatialEntityRecord {
  uid: string;
  entity: GameEntity;
  centerWorld: Vector3;
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

  // Vectores estáticos para cero allocations en actualización
  private static readonly _fallbackPos = Vector3.Zero();
  private static readonly _tempVec = Vector3.Zero();
  private static readonly _tempCamFwd = Vector3.Zero();

  private lastRefPos = new Vector3(-99999, -99999, -99999);
  private currentRefPos = Vector3.Zero();
  private currentCamPos = Vector3.Zero();

  // Métricas
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
    const mesh = record.entity.view as AbstractMesh;
    if (!mesh || mesh.isDisposed()) return;

    mesh.computeWorldMatrix(true);
    const bounds = mesh.getHierarchyBoundingVectors(true, (m: AbstractMesh) => {
      return !Tags.MatchesQuery(m, 'system_element || editor_only || proxy_collider || light_visual || debug_element');
    });

    record.centerWorld.copyFrom(bounds.min).addInPlace(bounds.max).scaleInPlace(0.5);
    const diagonal = bounds.max.subtract(record.centerWorld);
    record.boundingRadius = Math.max(0.5, diagonal.length());
  }

  public getReferencePosition(): Vector3 {
    const mode = this.context.mode();
    const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    if (!isEditorPure) {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
        return playerEntity.view.getAbsolutePosition();
      }
    }

    const scene = this.motor3d.getScene();
    const camera = this.ownership.getCamera() || scene?.activeCamera || this.motor3d.getEditorCamera();
    if (camera) {
      return camera.globalPosition;
    }

    return SpatialRelevanceHubService._fallbackPos;
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
    const shouldRecomputeAll = refMovedSq > 0.0025 || this.frameCount % 10 === 0;

    if (shouldRecomputeAll) {
      this.lastRefPos.copyFrom(this.currentRefPos);

      let evals = 0;
      let sqCalls = 0;

      for (const [uid, record] of this.registry.entries()) {
        const entity = record.entity;
        if (!entity.view || entity.view.isDisposed()) {
          continue;
        }

        if (entity.isDirty) {
          this.computeEntityBounds(record);
        }

        // Distancia cuadrática al jugador / referencia primaria
        const dx = this.currentRefPos.x - record.centerWorld.x;
        const dy = this.currentRefPos.y - record.centerWorld.y;
        const dz = this.currentRefPos.z - record.centerWorld.z;
        record.distSqToPlayer = dx * dx + dy * dy + dz * dz;
        record.distToPlayer = null; // invalidamos sqrt para cálculo on-demand
        sqCalls++;

        // Distancia cuadrática a la cámara
        const cdx = this.currentCamPos.x - record.centerWorld.x;
        const cdy = this.currentCamPos.y - record.centerWorld.y;
        const cdz = this.currentCamPos.z - record.centerWorld.z;
        record.distSqToCamera = cdx * cdx + cdy * cdy + cdz * cdz;
        record.distToCamera = null;
        sqCalls++;

        // Orientación respecto al frente de la cámara
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

  // =========================================================================
  // CONSULTAS PÚBLICAS OPTIMIZADAS (API O(1))
  // =========================================================================

  public getRecord(uid: string): SpatialEntityRecord | null {
    const record = this.registry.get(uid);
    if (record) {
      this._cacheHits++;
      return record;
    }

    // Auto-registro bajo demanda
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

  /**
   * Resuelve el actor más cercano a una posición arbitraria aprovechando la posición
   * del centro espacial pre-alocada en el Hub.
   */
  public getClosestActorForPosition(pos: Vector3, actors: GameEntity[]): { actor: GameEntity | null; distance: number; actorPosition: Vector3 } {
    if (actors.length === 0) {
      return { actor: null, distance: Number.MAX_VALUE, actorPosition: SpatialRelevanceHubService._fallbackPos };
    }

    let closestActor: GameEntity | null = null;
    let minDistanceSq = Number.MAX_VALUE;
    const closestPos = new Vector3();

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      const rec = this.getRecord(actor.uid);
      const actorPos = rec ? rec.centerWorld : (actor.view?.getAbsolutePosition() || SpatialRelevanceHubService._fallbackPos);

      const dx = pos.x - actorPos.x;
      const dy = pos.y - actorPos.y;
      const dz = pos.z - actorPos.z;
      const dSq = dx * dx + dy * dy + dz * dz;

      if (dSq < minDistanceSq) {
        minDistanceSq = dSq;
        closestActor = actor;
        closestPos.copyFrom(actorPos);
      }
    }

    return {
      actor: closestActor,
      distance: Math.sqrt(minDistanceSq),
      actorPosition: closestPos
    };
  }
}