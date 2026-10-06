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
import { PerformanceIncidentService } from '../../telemetry/performance-incident.service';
import { CoreSceneMaterialService } from '../../scene/utils/core-scene-material.service';

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
  private incidentSvc = inject(PerformanceIncidentService);
  private materialSvc = inject(CoreSceneMaterialService);

  private readonly PERCEPTIBLE_FLAP_MIN_VISIBILITY = 0.20;
  private readonly PERCEPTIBLE_FLAP_MAX_VISIBILITY = 0.80;
  private readonly MAX_PERCEPTIBLE_FLAP_DISTANCE = 80.0;

  // Radio crítico 360° donde jamás se oculta nada
  private readonly CRITICAL_SPHERE_RADIUS = 35.0;

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
    if (
      nameL.includes('sueloinvisible') || 
      nameL.includes('ground') ||
      nameL.includes('terrain') ||
      Tags.MatchesQuery(e.view, 'invisible_floor')
    ) {
      return true;
    }
    return false;
  }

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (e.autoAnim?.enabled) return false;
    if (e.movementAuthority !== 'GAMEPLAY') return false;
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
        if (!mesh.isVisible) mesh.isVisible = true;

        const cachedMeshes = this.getCachedMeshes(e, mesh);
        for (let m = 0; m < cachedMeshes.length; m++) {
          const c = cachedMeshes[m];
          if (!Tags.MatchesQuery(c, 'proxy_collider || debug_element || editor_only || light_visual || fog_element')) {
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
      return;
    }

    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 150, fadeMargin: 40 };
    if (!cullingConfig.enabled) {
      this.stop();
      return;
    }

    const origin = explicitOrigin || (playerEntity?.view ? playerEntity.view.getAbsolutePosition() : Vector3.Zero());
    this.lastPlayerPos.copyFrom(origin);
    this.spatialGroups.updateGroups(origin, Vector3.Zero());

    const rawCull = Number(cullingConfig.cullDistance) || 150;
    const rawMargin = Number(cullingConfig.fadeMargin) || 40;
    const cullDistance = Math.max(30, rawCull);
    const fadeMargin = Math.min(cullDistance - 5, Math.max(5, rawMargin));
    const fadeStartDist = Math.max(0, cullDistance - fadeMargin);

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

      if (!isEligible) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
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

      const effectiveDist = this.spatialHub.getDistanceToPlayer(e.uid);

      if (effectiveDist <= this.CRITICAL_SPHERE_RADIUS) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
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
      } else if (effectiveDist > cullDistance) {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
        e.isCulled = true;
        mesh.setEnabled(true);
        mesh.isVisible = isNeededForShadow;
        this.applyVisibilityToMeshes(cachedMeshes, isNeededForShadow ? 0.0001 : 0.0);
        this.renderStates.set(e.uid, { 
          state: 'HARD_CULLED', 
          visibility: 0.0, 
          targetVisibility: 0.0, 
          isShadowProtected: isNeededForShadow, 
          isStructural: false, 
          isResourceResident: true,
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        this._hardCulledCount++;
      } else {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        const alpha = this.calculateSmoothVisibility(effectiveDist, fadeStartDist, cullDistance);
        this.applyVisibilityToMeshes(cachedMeshes, alpha);
        this.renderStates.set(e.uid, { 
          state: alpha >= 0.98 ? 'VISIBLE' : 'FADING_OUT', 
          visibility: alpha, 
          targetVisibility: alpha, 
          isShadowProtected: false, 
          isStructural: false, 
          isResourceResident: true,
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        if (alpha >= 0.98) this._visibleCount++; else this._fadingCount++;
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
        const cachedMeshes = this.getCachedMeshes(e, mesh);
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
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

  public update(dtMs: number): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    if (isEditor) {
      if (this.frameCounter === 0) {
        this.ensureAllEntitiesVisibleForEditor();
      }
      this.frameCounter++;
      return;
    }

    this.frameCounter++;
    this.distanceCheckTimer += dtMs;

    const shouldCheckDistance = this.distanceCheckTimer >= 33;
    if (shouldCheckDistance) {
      this.distanceCheckTimer = 0;
    }

    const isTransitioning = this.context.isTransitioning();
    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 150, fadeMargin: 40 };
    if (!cullingConfig.enabled || isTransitioning) {
      return;
    }

    if (playerEntity && playerEntity.view && dtMs > 0) {
      const currPos = playerEntity.view.getAbsolutePosition();
      this.playerVelocity.copyFrom(currPos).subtractInPlace(this.lastPlayerPos).scaleInPlace(1000 / dtMs);
      this.lastPlayerPos.copyFrom(currPos);

      const rawSpeed = this.playerVelocity.length();
      this.smoothedSpeed = (this.smoothedSpeed * 0.88) + (rawSpeed * 0.12);
    }

    if (shouldCheckDistance && playerEntity && playerEntity.view) {
      this.spatialGroups.updateGroups(playerEntity.view.getAbsolutePosition(), this.playerVelocity);
    }

    const dynamicLookAheadBonus = Math.min(15.0, this.smoothedSpeed * 1.0);
    const rawCull = Number(cullingConfig.cullDistance) || 150;
    const rawMargin = Number(cullingConfig.fadeMargin) || 40;
    const baseCullDist = Math.max(30, rawCull);
    const fadeMargin = Math.min(baseCullDist - 5, Math.max(5, rawMargin));
    const fadeStartDist = Math.max(0, baseCullDist - fadeMargin);

    const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.25);
    let discreteStateChanged = false;

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

      if (!isEligible) {
        if (e.isCulled) {
          e.isCulled = false;
          discreteStateChanged = true;
          changedThisFrame++;
        }
        renderState.targetVisibility = 1.0;
        renderState.state = 'VISIBLE';
        if (!mesh.isEnabled()) mesh.setEnabled(true);
        if (!mesh.isVisible) mesh.isVisible = true;
        if (renderState.visibility !== 1.0) {
          renderState.visibility = 1.0;
          this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0);
        }
        vCount++;
        continue;
      }

      if (shouldCheckDistance) {
        evaluatedThisFrame++;
        const wasCulled = e.isCulled;
        const prevState = renderState.state;

        const effectiveDist = this.spatialHub.getDistanceToPlayer(e.uid);
        const group = this.spatialGroups.getGroupForEntity(e.uid);

        const isGroupPreactivatingOrBetter = Boolean(
          group && (
            group.state === 'ACTIVE' || 
            group.state === 'PREACTIVATING' || 
            group.state === 'PREPARED' ||
            group.isPredictedTarget
          )
        );

        this.evaluateIndividualCulling(
          e, renderState, mesh, effectiveDist, baseCullDist, 
          dynamicLookAheadBonus, fadeStartDist, isGroupPreactivatingOrBetter, isStructural
        );

        if (prevState !== renderState.state) {
          const isPerceptibleFlap = 
            effectiveDist <= this.MAX_PERCEPTIBLE_FLAP_DISTANCE &&
            renderState.visibility >= this.PERCEPTIBLE_FLAP_MIN_VISIBILITY &&
            renderState.visibility <= this.PERCEPTIBLE_FLAP_MAX_VISIBILITY;

          if (isPerceptibleFlap && (now - renderState.lastStateChangeTime < 2800)) {
            renderState.flapCounter++;
            if (renderState.flapCounter >= 4) {
              this.incidentSvc.recordCullingFlap(e.uid, e.name, effectiveDist, this.smoothedSpeed, renderState.visibility);
              renderState.flapCounter = 0;
            }
          } else {
            renderState.flapCounter = 0;
          }
          renderState.lastStateChangeTime = now;
        }

        if (wasCulled !== e.isCulled) {
          discreteStateChanged = true;
          changedThisFrame++;
        }
      }

      const cachedMeshes = this.getCachedMeshes(e, mesh);

      switch (renderState.state) {
        case 'VISIBLE':
          vCount++;
          if (Math.abs(renderState.visibility - renderState.targetVisibility) > 0.005) {
            renderState.state = renderState.targetVisibility < 1.0 ? 'FADING_OUT' : 'RESTORING';
          }
          break;

        case 'FADING_OUT':
          fCount++;
          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;
          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility <= 0.01 && renderState.targetVisibility <= 0.005) {
            renderState.visibility = 0.0;
            renderState.state = 'HARD_CULLED';
            e.isCulled = true;

            const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
            renderState.isShadowProtected = isNeededForShadow;

            mesh.setEnabled(true);
            mesh.isVisible = isNeededForShadow;
            this.applyVisibilityToMeshes(cachedMeshes, 0.0);

            discreteStateChanged = true;
            changedThisFrame++;
            hCount++;
          }
          break;

        case 'HARD_CULLED':
          hCount++;
          break;

        case 'RESTORING':
          if (!this.materialSvc.isMaterialReadyForMesh(mesh.material, mesh)) {
            break;
          }

          rCount++;
          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * (lerpSpeed * 1.8);
          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility >= 0.99 && renderState.targetVisibility >= 0.99) {
            renderState.visibility = 1.0;
            renderState.state = 'VISIBLE';
            this.applyVisibilityToMeshes(cachedMeshes, 1.0);
          }
          break;
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

    if (discreteStateChanged) {
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
    }
  }

  private evaluateIndividualCulling(
    e: GameEntity,
    renderState: RenderState,
    mesh: AbstractMesh,
    effectiveDist: number,
    baseCullDist: number,
    dynamicLookAheadBonus: number,
    fadeStartDist: number,
    isGroupPreactivated: boolean,
    isStructural: boolean
  ): void {
    if (effectiveDist <= this.CRITICAL_SPHERE_RADIUS) {
      renderState.targetVisibility = 1.0;
      if (renderState.state === 'HARD_CULLED' || renderState.state === 'FADING_OUT') {
        renderState.state = 'RESTORING';
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
      }
      return;
    }

    const structuralBonus = isStructural ? 15.0 : 0.0;
    const groupBonus = isGroupPreactivated ? 15.0 : 0.0;

    const effectiveCull = baseCullDist + dynamicLookAheadBonus + groupBonus + structuralBonus;
    const effectiveFadeStart = fadeStartDist + dynamicLookAheadBonus + groupBonus + structuralBonus;
    const REACQUIRE_MARGIN = 8.0;

    if (renderState.state === 'HARD_CULLED') {
      if (effectiveDist <= (effectiveCull - REACQUIRE_MARGIN)) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        renderState.isShadowProtected = false;

        if (effectiveDist <= effectiveFadeStart) {
          renderState.state = 'RESTORING';
          renderState.targetVisibility = 1.0;
        } else {
          renderState.state = 'RESTORING';
          renderState.targetVisibility = this.calculateSmoothVisibility(effectiveDist, effectiveFadeStart, effectiveCull);
        }
        renderState.visibility = Math.max(0.05, renderState.visibility);
        this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), renderState.visibility);
        this.shadowService.notifyCasterRestored(e.uid);
      }
    } else {
      if (effectiveDist > effectiveCull) {
        renderState.targetVisibility = 0.0;
        if (renderState.state === 'VISIBLE' || renderState.state === 'RESTORING') {
          renderState.state = 'FADING_OUT';
        }
      } else if (effectiveDist <= effectiveFadeStart) {
        renderState.targetVisibility = 1.0;
        if (renderState.state === 'FADING_OUT') {
          renderState.state = 'RESTORING';
        }
        e.isCulled = false;
        renderState.isShadowProtected = false;
      } else {
        renderState.targetVisibility = this.calculateSmoothVisibility(effectiveDist, effectiveFadeStart, effectiveCull);
        if (renderState.targetVisibility < renderState.visibility) {
          renderState.state = 'FADING_OUT';
        } else if (renderState.targetVisibility > renderState.visibility) {
          renderState.state = 'RESTORING';
        }
        e.isCulled = false;
        renderState.isShadowProtected = false;
      }
    }
  }

  private calculateSmoothVisibility(dist: number, fadeStart: number, cullDist: number): number {
    if (dist <= fadeStart) return 1.0;
    if (dist >= cullDist) return 0.0;
    const t = Math.max(0, Math.min(1, (dist - fadeStart) / (cullDist - fadeStart)));
    return Math.max(0.0, Math.min(1.0, 1.0 - (t * t * (3.0 - 2.0 * t))));
  }

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number) {
    const clamped = Math.max(0.0, Math.min(1.0, visibility));
    const isFullyVisible = clamped >= 0.995;
    const isHidden = clamped <= 0.005;

    for (let c = 0; c < meshes.length; c++) {
      const m = meshes[c];
      m.visibility = isFullyVisible ? 1.0 : (isHidden ? 0.0 : clamped);
      m.isVisible = !isHidden;
    }
  }
}