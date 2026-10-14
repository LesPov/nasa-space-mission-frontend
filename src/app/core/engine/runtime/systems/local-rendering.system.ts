// file: src/app/core/engine/runtime/systems/local-rendering.system.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { AbstractMesh, Vector3, Tags, Mesh, InstancedMesh } from '@babylonjs/core';
import { GameMode } from '../../session/game-mode.model';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { LightShadowService } from './lighting/light-shadow.service';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
import { SpatialRelevanceHubService } from '../../spatial/spatial-relevance-hub.service';
import { SpatialStreamingGroupService } from '../../spatial/spatial-streaming-group.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { LightPoolService } from './lighting/light-pool.service';

export type CullState = 'VISIBLE' | 'FADING_OUT' | 'HARD_CULLED' | 'RESTORING';

interface RenderState {
  state: CullState;
  visibility: number;
  targetVisibility: number;
  isShadowProtected: boolean;
  isStructural: boolean;
  isResourceResident: boolean;
  lastStateChangeTime: number;
  flapCounter: number;
}

export interface CullingSystemMetrics {
  evaluatedEntities: number;
  modifiedEntities: number;
  visibleObjects: number;
  fadingObjects: number;
  hardCulledObjects: number;
  restoringObjects: number;
  shadowProtectedObjects: number;
  smoothedPlayerSpeed: number;
  queuedForStreamingCount: number;
}

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';

  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private eventBus = inject(GameEventBusService);
  private shadowService = inject(LightShadowService);
  private profiler = inject(EngineProfilerService);
  private spatialHub = inject(SpatialRelevanceHubService);
  private spatialGroups = inject(SpatialStreamingGroupService);
  private ownership = inject(CameraOwnershipService);
  private lightPool = inject(LightPoolService);

  private frameCounter = 0;
  private distanceCheckTimer = 0;
  private meshCache = new Map<string, AbstractMesh[]>();
  private renderStates = new Map<string, RenderState>();

  private _evaluatedCount = 0;
  private _modifiedCount = 0;
  private _visibleCount = 0;
  private _fadingCount = 0;
  private _hardCulledCount = 0;
  private _restoringCount = 0;
  private _shadowProtectedCount = 0;

  private playerVelocity = Vector3.Zero();
  private lastPlayerPos = Vector3.Zero();
  private smoothedSpeed = 0;

  public getMetrics(): CullingSystemMetrics {
    return {
      evaluatedEntities: this._evaluatedCount,
      modifiedEntities: this._modifiedCount,
      visibleObjects: this._visibleCount,
      fadingObjects: this._fadingCount,
      hardCulledObjects: this._hardCulledCount,
      restoringObjects: this._restoringCount,
      shadowProtectedObjects: this._shadowProtectedCount,
      smoothedPlayerSpeed: parseFloat(this.smoothedSpeed.toFixed(2)),
      queuedForStreamingCount: 0
    };
  }

  private getCachedMeshes(entity: GameEntity, rootMesh: AbstractMesh): AbstractMesh[] {
    let cached = this.meshCache.get(entity.uid);
    if (!cached || cached.length === 0 || cached[0] !== rootMesh) {
      const rebuilt: AbstractMesh[] = [];

      const collectRenderable = (mesh: AbstractMesh) => {
        if (!mesh || mesh.isDisposed()) return;
        if (Tags.MatchesQuery(mesh, 'proxy_collider || debug_element || editor_only || light_visual || system_element || fog_element || invisible_floor')) {
          return;
        }

        const className = mesh.getClassName();
        if (className === 'Mesh' || className === 'InstancedMesh') {
          if (className === 'InstancedMesh') {
            const source = (mesh as InstancedMesh).sourceMesh;
            if (source && source.getTotalVertices() > 0) rebuilt.push(mesh);
          } else if ((mesh as Mesh).getTotalVertices() > 0) {
            rebuilt.push(mesh);
          }
        }
      };

      collectRenderable(rootMesh);
      const descendants = rootMesh.getChildMeshes(false);
      for (let i = 0; i < descendants.length; i++) {
        collectRenderable(descendants[i]);
      }

      if (rebuilt.length === 0) {
        rebuilt.push(rootMesh);
      }

      cached = rebuilt;
      this.meshCache.set(entity.uid, cached);
    }
    return cached;
  }

  public isStructuralEntity(e: GameEntity): boolean {
    if (e.visual?.disableCulling === true) return true;
    
    const nameL = e.name ? e.name.toLowerCase() : '';
    if (nameL.includes('sueloinvisible') || Tags.MatchesQuery(e.view, 'invisible_floor')) {
      return true;
    }
    return false;
  }

  private isProtectedByActiveContainerLight(entityUid: string): boolean {
    // Solo proteger al contenedor del culling si la luz interior está REALMENTE emitiendo luz
    // Si la luz ya se apagó por distancia, el contenedor puede entrar en culling y desaparecer normalmente.
    const allSlots = this.lightPool.getAllSlots();
    for (let i = 0; i < allSlots.length; i++) {
      const slot = allSlots[i];
      if (slot.assignedEntityUid && slot.currentIntensity > 0.001) {
        const lightEnt = this.entityManager.getEntityByUid(slot.assignedEntityUid);
        if (lightEnt && lightEnt.light?.containmentMode === 'INTERIOR') {
          const containerUid = lightEnt.light.containerEntityUid || lightEnt.parentId;
          if (containerUid === entityUid) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (this.isStructuralEntity(e)) return false;
    if (this.isProtectedByActiveContainerLight(e.uid)) return false;
    if (e.autoAnim?.enabled) return false;
    if (e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_')) return false;
    if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') return false;
    if (e.visual?.disableCulling === true) return false;
    return true;
  }

  public start(): void {
    this.meshCache.clear();
    this.renderStates.clear();
    this.frameCounter = 0;
    this.distanceCheckTimer = 9999;
    this.smoothedSpeed = 0;
    this.resetCounters();
  }

  private resetCounters(): void {
    this._evaluatedCount = 0;
    this._modifiedCount = 0;
    this._visibleCount = 0;
    this._fadingCount = 0;
    this._hardCulledCount = 0;
    this._restoringCount = 0;
    this._shadowProtectedCount = 0;
  }

  public stop(): void {
    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      e.isCulled = false;
      if (e.isManuallyHidden) continue;

      const mesh = e.view as AbstractMesh;
      if (mesh && !mesh.isDisposed()) {
        if (!mesh.isEnabled()) mesh.setEnabled(true);
        mesh.isVisible = true;
        mesh.visibility = 1.0;

        const cachedMeshes = this.getCachedMeshes(e, mesh);
        for (let m = 0; m < cachedMeshes.length; m++) {
          const c = cachedMeshes[m];
          if (!Tags.MatchesQuery(c, 'proxy_collider || debug_element || editor_only || light_visual || fog_element')) {
            c.setEnabled(true);
            c.isVisible = true;
            c.visibility = 1.0;
          }
        }
      }
    }
    this.start();
    this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
  }

  public reconcileAllEntitiesImmediate(explicitOrigin?: Vector3): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    if (isEditor) {
      this.ensureAllEntitiesVisibleForEditor();
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
      return;
    }

    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const origin = explicitOrigin || (playerEntity?.view ? playerEntity.view.getAbsolutePosition() : Vector3.Zero());
    this.lastPlayerPos.copyFrom(origin);
    this.spatialGroups.updateGroups(origin, Vector3.Zero());

    const cullingConfig = playerEntity?.playerConfig?.culling;
    const isCullingEnabled = cullingConfig ? cullingConfig.enabled !== false : true;
    const cullDistance = cullingConfig?.cullDistance ? Math.max(10, cullingConfig.cullDistance) : 150.0;
    const fadeMargin = cullingConfig?.fadeMargin ? Math.max(1, cullingConfig.fadeMargin) : 30.0;
    const fadeStartDistance = Math.max(5, cullDistance - fadeMargin);

    this.resetCounters();
    const now = performance.now();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const mesh = e.view as AbstractMesh;
      if (!mesh || mesh.isDisposed()) continue;

      if (e.isManuallyHidden) {
        mesh.isVisible = false;
        mesh.setEnabled(false);
        continue;
      }

      const cachedMeshes = this.getCachedMeshes(e, mesh);
      const isEligible = this.isEligibleForHardCull(e);

      if (!isEligible || !isCullingEnabled) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0, false);
        this.renderStates.set(e.uid, { 
          state: 'VISIBLE', 
          visibility: 1.0, 
          targetVisibility: 1.0, 
          isShadowProtected: false, 
          isStructural: this.isStructuralEntity(e), 
          isResourceResident: true,
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        this._visibleCount++;
        continue;
      }

      const effectiveDist = this.getDirectDistance(e, origin);
      const record = this.spatialHub.getRecord(e.uid);
      const boundingRadius = record ? record.boundingRadius : 2.0;
      const adjustedDist = Math.max(0, effectiveDist - boundingRadius);

      if (adjustedDist <= fadeStartDistance) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0, false);
        this.renderStates.set(e.uid, { 
          state: 'VISIBLE', 
          visibility: 1.0, 
          targetVisibility: 1.0, 
          isShadowProtected: false, 
          isStructural: false, 
          isResourceResident: true,
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        this._visibleCount++;
      } else if (adjustedDist <= cullDistance) {
        const factor = 1.0 - ((adjustedDist - fadeStartDistance) / fadeMargin);
        const targetVis = Math.max(0.01, Math.min(1.0, factor));
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, targetVis, false);
        this.renderStates.set(e.uid, { 
          state: 'FADING_OUT', 
          visibility: targetVis, 
          targetVisibility: targetVis, 
          isShadowProtected: false, 
          isStructural: false, 
          isResourceResident: true,
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        this._fadingCount++;
      } else {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
        e.isCulled = !isNeededForShadow;
        mesh.setEnabled(isNeededForShadow);
        mesh.isVisible = isNeededForShadow;
        this.applyVisibilityToMeshes(cachedMeshes, isNeededForShadow ? 1.0 : 0.0, isNeededForShadow);
        this.renderStates.set(e.uid, { 
          state: isNeededForShadow ? 'VISIBLE' : 'HARD_CULLED', 
          visibility: isNeededForShadow ? 1.0 : 0.0, 
          targetVisibility: isNeededForShadow ? 1.0 : 0.0, 
          isShadowProtected: isNeededForShadow, 
          isStructural: false, 
          isResourceResident: true,
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        if (isNeededForShadow) {
          this._shadowProtectedCount++;
          this._visibleCount++;
        } else {
          this._hardCulledCount++;
        }
      }
    }

    this._evaluatedCount = entities.length;
    this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
  }

  public ensureAllEntitiesVisibleForEditor(): void {
    const entities = this.entityManager.getAllEntities();
    this.resetCounters();
    const now = performance.now();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.isManuallyHidden) continue;

      e.isCulled = false;
      const mesh = e.view as AbstractMesh;
      if (mesh && !mesh.isDisposed()) {
        if (!mesh.isEnabled()) mesh.setEnabled(true);
        mesh.isVisible = true;
        mesh.visibility = 1.0;
        const cachedMeshes = this.getCachedMeshes(e, mesh);
        this.applyVisibilityToMeshes(cachedMeshes, 1.0, false);
      }
      this.renderStates.set(e.uid, { 
        state: 'VISIBLE', 
        visibility: 1.0, 
        targetVisibility: 1.0, 
        isShadowProtected: false, 
        isStructural: this.isStructuralEntity(e), 
        isResourceResident: true,
        lastStateChangeTime: now, 
        flapCounter: 0 
      });
      this._visibleCount++;
    }
    this._evaluatedCount = entities.length;
  }

  private getDirectDistance(entity: GameEntity, referencePos: Vector3): number {
    if (entity.view && !entity.view.isDisposed()) {
      return Vector3.Distance(entity.view.getAbsolutePosition(), referencePos);
    }
    return Vector3.Distance(
      new Vector3(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z),
      referencePos
    );
  }

  public update(dtMs: number): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    if (isEditor) {
      const anyCulledInEditor = this.entityManager.getAllEntities().some(e => !e.isManuallyHidden && e.isCulled);
      if (this.frameCounter === 0 || anyCulledInEditor) {
        this.ensureAllEntitiesVisibleForEditor();
      }
      this.frameCounter++;
      return;
    }

    this.frameCounter++;
    this.distanceCheckTimer += dtMs;

    const shouldCheckDistance = this.distanceCheckTimer >= 50;
    if (shouldCheckDistance) {
      this.distanceCheckTimer = 0;
    }

    const isTransitioning = this.context.isTransitioning();
    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    if (isTransitioning) return;

    let observerOrigin: Vector3 = Vector3.Zero();
    if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
      observerOrigin = playerEntity.view.getAbsolutePosition();
    } else {
      const activeCam = this.ownership.getCamera();
      if (activeCam) observerOrigin = activeCam.globalPosition;
    }

    if (dtMs > 0 && observerOrigin.lengthSquared() > 0.001) {
      this.playerVelocity.copyFrom(observerOrigin).subtractInPlace(this.lastPlayerPos).scaleInPlace(1000 / dtMs);
      this.lastPlayerPos.copyFrom(observerOrigin);
    }

    if (shouldCheckDistance && observerOrigin.lengthSquared() > 0.001) {
      this.spatialGroups.updateGroups(observerOrigin, this.playerVelocity);
    }

    const cullingConfig = playerEntity?.playerConfig?.culling;
    const isCullingEnabled = cullingConfig ? cullingConfig.enabled !== false : true;
    const cullDistance = cullingConfig?.cullDistance ? Math.max(10, cullingConfig.cullDistance) : 150.0;
    const fadeMargin = cullingConfig?.fadeMargin ? Math.max(1, cullingConfig.fadeMargin) : 30.0;
    const fadeStartDistance = Math.max(5, cullDistance - fadeMargin);

    let vCount = 0, fCount = 0, hCount = 0, rCount = 0, sCount = 0;
    let evaluatedThisFrame = 0;
    let changedThisFrame = 0;
    const now = performance.now();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const mesh = e.view as AbstractMesh;
      if (!mesh || mesh.isDisposed()) continue;

      if (e.isManuallyHidden) {
        if (mesh.isVisible || mesh.isEnabled()) {
          mesh.isVisible = false;
          mesh.setEnabled(false);
          const cached = this.getCachedMeshes(e, mesh);
          for (let m = 0; m < cached.length; m++) {
            cached[m].isVisible = false;
            cached[m].setEnabled(false);
          }
        }
        continue;
      }

      const isStructural = this.isStructuralEntity(e);
      const isEligible = this.isEligibleForHardCull(e);

      if (!this.renderStates.has(e.uid)) {
        this.renderStates.set(e.uid, {
          state: 'VISIBLE',
          visibility: 1.0,
          targetVisibility: 1.0,
          isShadowProtected: false,
          isStructural,
          isResourceResident: true,
          lastStateChangeTime: now,
          flapCounter: 0
        });
      }
      const renderState = this.renderStates.get(e.uid)!;

      if (!isEligible || !isCullingEnabled) {
        if (renderState.visibility !== 1.0 || !mesh.isVisible || !mesh.isEnabled()) {
          renderState.targetVisibility = 1.0;
          renderState.visibility = 1.0;
          renderState.state = 'VISIBLE';
          e.isCulled = false;
          mesh.setEnabled(true);
          mesh.isVisible = true;
          this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0, false);
          changedThisFrame++;
        }
        vCount++;
        continue;
      }

      if (shouldCheckDistance) {
        evaluatedThisFrame++;
        const effectiveDist = this.getDirectDistance(e, observerOrigin);
        const record = this.spatialHub.getRecord(e.uid);
        const boundingRadius = record ? record.boundingRadius : 2.0;
        const adjustedDist = Math.max(0, effectiveDist - boundingRadius);

        // ZONA 1: Rango de visibilidad plena
        if (adjustedDist <= fadeStartDistance) {
          if (renderState.visibility !== 1.0 || renderState.state !== 'VISIBLE' || !mesh.isVisible || !mesh.isEnabled()) {
            const prevState = renderState.state;
            renderState.targetVisibility = 1.0;
            renderState.visibility = 1.0;
            renderState.state = 'VISIBLE';
            e.isCulled = false;
            mesh.setEnabled(true);
            mesh.isVisible = true;
            this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0, false);
            changedThisFrame++;

            this.profiler.recordTimelineEvent('CULLING', 'CULLING_STATE_CHANGED', {
              entityUid: e.uid,
              name: e.name,
              distance: effectiveDist,
              reason: 'RESTORING_AFTER_CULL'
            }, {
              entityUid: e.uid,
              previousState: prevState,
              newState: 'VISIBLE',
              reason: 'RESTORING_AFTER_CULL'
            });
          }
          vCount++;
        } 
        // ZONA 2: En la franja de desvanecimiento progresivo
        else if (adjustedDist <= cullDistance) {
          const factor = 1.0 - ((adjustedDist - fadeStartDistance) / fadeMargin);
          const targetVis = Math.max(0.01, Math.min(1.0, factor));

          if (Math.abs(renderState.visibility - targetVis) > 0.03 || renderState.state !== 'FADING_OUT' || !mesh.isVisible || !mesh.isEnabled()) {
            renderState.state = 'FADING_OUT';
            renderState.targetVisibility = targetVis;
            renderState.visibility = targetVis;
            e.isCulled = false;
            mesh.setEnabled(true);
            mesh.isVisible = true;
            this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), targetVis, false);
            changedThisFrame++;
          }
          fCount++;
        } 
        // ZONA 3: Fuera del rango de corte
        else {
          const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
          
          if (isNeededForShadow) {
            if (renderState.state !== 'VISIBLE' || !mesh.isVisible || !mesh.isEnabled()) {
              const prevState = renderState.state;
              renderState.state = 'VISIBLE';
              renderState.visibility = 1.0;
              renderState.targetVisibility = 1.0;
              renderState.isShadowProtected = true;
              e.isCulled = false;
              mesh.setEnabled(true);
              mesh.isVisible = true;
              this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0, true);
              changedThisFrame++;

              this.profiler.recordTimelineEvent('CULLING', 'CULLING_STATE_CHANGED', {
                entityUid: e.uid,
                name: e.name,
                distance: effectiveDist,
                reason: 'SHADOW_PROTECTED'
              }, {
                entityUid: e.uid,
                previousState: prevState,
                newState: 'VISIBLE',
                reason: 'SHADOW_PROTECTED'
              });
            }
            sCount++;
            vCount++;
          } else {
            if (renderState.state !== 'HARD_CULLED' || mesh.isVisible || mesh.isEnabled()) {
              const prevState = renderState.state;
              renderState.state = 'HARD_CULLED';
              renderState.visibility = 0.0;
              renderState.targetVisibility = 0.0;
              renderState.isShadowProtected = false;
              e.isCulled = true;
              mesh.setEnabled(false);
              mesh.isVisible = false;
              this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 0.0, false);
              changedThisFrame++;

              this.profiler.recordTimelineEvent('CULLING', 'CULLING_STATE_CHANGED', {
                entityUid: e.uid,
                name: e.name,
                distance: effectiveDist,
                reason: 'OUT_OF_RANGE'
              }, {
                entityUid: e.uid,
                previousState: prevState,
                newState: 'HARD_CULLED',
                reason: 'OUT_OF_RANGE'
              });
            }
            hCount++;
          }
        }
      } else {
        if (renderState.state === 'VISIBLE') vCount++;
        else if (renderState.state === 'FADING_OUT') fCount++;
        else hCount++;
      }
    }

    this._visibleCount = vCount;
    this._fadingCount = fCount;
    this._hardCulledCount = hCount;
    this._restoringCount = rCount;
    this._shadowProtectedCount = sCount;

    if (shouldCheckDistance) {
      this._evaluatedCount = evaluatedThisFrame;
      this._modifiedCount = changedThisFrame;
      this.profiler.recordDistanceEvaluation('LocalRenderingSystem', evaluatedThisFrame);
    }

    if (changedThisFrame > 0) {
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
    }
  }

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number, isShadowCaster = false): void {
    const isFullyVisible = visibility >= 0.99;
    const isHidden = visibility <= 0.001;

    for (let c = 0; c < meshes.length; c++) {
      const m = meshes[c];
      if (!m || m.isDisposed()) continue;

      if (isHidden) {
        m.setEnabled(false);
        m.isVisible = false;
        m.visibility = 0.0;
      } else {
        m.setEnabled(true);
        m.isVisible = true;
        m.visibility = isFullyVisible ? 1.0 : visibility;
      }

      if (isShadowCaster && !isHidden) {
        m.alwaysSelectAsActiveMesh = true;
      } else {
        m.alwaysSelectAsActiveMesh = false;
      }
    }
  }
}