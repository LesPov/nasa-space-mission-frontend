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

export type CullState = 'VISIBLE' | 'FADING_OUT' | 'HARD_CULLED' | 'RESTORING';

interface RenderState {
  state: CullState;
  visibility: number;
  targetVisibility: number;
  isShadowProtected: boolean;
  isStructural: boolean;
  lastStateChangeTime: number;
  flapCounter: number;
}

export interface CullingSystemMetrics {
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

  private readonly PERCEPTIBLE_FLAP_MIN_VISIBILITY = 0.20;
  private readonly PERCEPTIBLE_FLAP_MAX_VISIBILITY = 0.80;
  private readonly MAX_PERCEPTIBLE_FLAP_DISTANCE = 80.0;

  private frameCounter = 0;
  private distanceCheckTimer = 0;
  private meshCache = new Map<string, AbstractMesh[]>();
  private renderStates = new Map<string, RenderState>();

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

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (e.autoAnim?.enabled) return false;
    if (e.movementAuthority !== 'GAMEPLAY') return false;
    if (e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_')) return false;
    if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') return false;
    if (this.isStructuralEntity(e)) return false;
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

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 160, fadeMargin: 50 };
    if (!cullingConfig.enabled) {
      this.stop();
      return;
    }

    const origin = explicitOrigin || (playerEntity?.view ? playerEntity.view.getAbsolutePosition() : Vector3.Zero());
    this.lastPlayerPos.copyFrom(origin);
    this.spatialGroups.updateGroups(origin, Vector3.Zero());

    const cullDistance = Math.max(60, Number(cullingConfig.cullDistance) || 160);
    const fadeMargin = Math.min(cullDistance - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 50));
    const fadeStartDist = Math.max(0, cullDistance - fadeMargin);
    const criticalRadius = 30.0;

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

      const isStructural = this.isStructuralEntity(e);
      const cachedMeshes = this.getCachedMeshes(e, mesh);

      if (isStructural || !this.isEligibleForHardCull(e)) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
        this.renderStates.set(e.uid, { 
          state: 'VISIBLE', 
          visibility: 1.0, 
          targetVisibility: 1.0, 
          isShadowProtected: false, 
          isStructural: true, 
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        this._visibleCount++;
        continue;
      }

      let effectiveDist = this.spatialHub.getDistanceToPlayer(e.uid);
      const group = this.spatialGroups.getGroupForEntity(e.uid);
      if (group) {
        effectiveDist = Math.min(effectiveDist, group.distanceToBox);
      }

      if (effectiveDist <= criticalRadius) {
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
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        this._visibleCount++;
      } else if (effectiveDist > cullDistance) {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
        e.isCulled = true;
        // REGLA FUNDAMENTAL: Jamás apagar la malla si la sombra o el mundo la necesita
        mesh.setEnabled(true);
        mesh.isVisible = isNeededForShadow;
        this.applyVisibilityToMeshes(cachedMeshes, isNeededForShadow ? 0.0001 : 0.0);
        this.renderStates.set(e.uid, { 
          state: 'HARD_CULLED', 
          visibility: 0.0, 
          targetVisibility: 0.0, 
          isShadowProtected: isNeededForShadow, 
          isStructural: false, 
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
          lastStateChangeTime: now, 
          flapCounter: 0 
        });
        if (alpha >= 0.98) this._visibleCount++; else this._fadingCount++;
      }
    }

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
        lastStateChangeTime: now, 
        flapCounter: 0 
      });
      this._visibleCount++;
    }
  }

  public update(dtMs: number): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    // En Modo Editor: Mantener todas las entidades 100% visibles
    if (isEditor) {
      if (this.frameCounter === 0) {
        this.ensureAllEntitiesVisibleForEditor();
      }
      this.frameCounter++;
      return;
    }

    this.frameCounter++;
    this.distanceCheckTimer += dtMs;

    const shouldCheckDistance = this.distanceCheckTimer >= 40;
    if (shouldCheckDistance) {
      this.distanceCheckTimer = 0;
    }

    const isTransitioning = this.context.isTransitioning();
    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 160, fadeMargin: 50 };
    if (!cullingConfig.enabled || isTransitioning) {
      return;
    }

    if (playerEntity && playerEntity.view && dtMs > 0) {
      const currPos = playerEntity.view.getAbsolutePosition();
      this.playerVelocity.copyFrom(currPos).subtractInPlace(this.lastPlayerPos).scaleInPlace(1000 / dtMs);
      this.lastPlayerPos.copyFrom(currPos);

      const rawSpeed = this.playerVelocity.length();
      this.smoothedSpeed = (this.smoothedSpeed * 0.88) + (rawSpeed * 0.12);

      const currentFps = this.profiler.getSnapshot(false).fps;
      if (rawSpeed > 14.5 && currentFps < 45) {
        this.incidentSvc.recordFastMove(rawSpeed, currPos);
      }
    }

    if (shouldCheckDistance && playerEntity && playerEntity.view) {
      this.spatialGroups.updateGroups(playerEntity.view.getAbsolutePosition(), this.playerVelocity);
    }

    const dynamicLookAheadBonus = Math.min(25.0, this.smoothedSpeed * 1.2);
    const baseCullDist = Math.max(60, Number(cullingConfig.cullDistance) || 160);
    const fadeMargin = Math.min(baseCullDist - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 50));
    const fadeStartDist = Math.max(0, baseCullDist - fadeMargin);

    const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.18);
    let discreteStateChanged = false;

    let vCount = 0, fCount = 0, hCount = 0, rCount = 0, sCount = 0;
    let evaluatedCount = 0;
    let changedCount = 0;
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

      if (!this.renderStates.has(e.uid)) {
        this.renderStates.set(e.uid, {
          state: 'VISIBLE',
          visibility: 1.0,
          targetVisibility: 1.0,
          isShadowProtected: false,
          isStructural,
          lastStateChangeTime: now,
          flapCounter: 0
        });
      }
      const renderState = this.renderStates.get(e.uid)!;

      if (isStructural || !this.isEligibleForHardCull(e)) {
        if (e.isCulled) {
          e.isCulled = false;
          discreteStateChanged = true;
          changedCount++;
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
        evaluatedCount++;
        const wasCulled = e.isCulled;
        const prevState = renderState.state;

        let effectiveDist = this.spatialHub.getDistanceToPlayer(e.uid);
        
        const group = this.spatialGroups.getGroupForEntity(e.uid);
        if (group) {
          effectiveDist = Math.min(effectiveDist, group.distanceToBox);
        }

        const isGroupPreactivatingOrBetter = Boolean(
          group && (
            group.state === 'ACTIVE' || 
            group.state === 'PREACTIVATING' ||
            group.isPredictedTarget
          )
        );

        this.evaluateIndividualCulling(
          e, renderState, mesh, effectiveDist, baseCullDist, 
          dynamicLookAheadBonus, fadeStartDist, isGroupPreactivatingOrBetter
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
          changedCount++;

          if (e.isCulled) {
            this.incidentSvc.recordObjectPopOut(e.uid, e.name, effectiveDist, this.smoothedSpeed);
          } else {
            this.incidentSvc.recordObjectPopIn(e.uid, e.name, effectiveDist, this.smoothedSpeed);
          }
        }
      }

      const cachedMeshes = this.getCachedMeshes(e, mesh);

      switch (renderState.state) {
        case 'VISIBLE':
          vCount++;
          if (Math.abs(renderState.visibility - renderState.targetVisibility) > 0.005) {
            renderState.state = renderState.targetVisibility < 1.0 ? 'FADING_OUT' : 'RESTORING';
          } else {
            if (!mesh.isEnabled()) mesh.setEnabled(true);
            if (!mesh.isVisible) mesh.isVisible = true;
            if (renderState.visibility !== 1.0) {
              renderState.visibility = 1.0;
              this.applyVisibilityToMeshes(cachedMeshes, 1.0);
            }
          }
          break;

        case 'FADING_OUT':
          fCount++;
          if (!mesh.isEnabled()) mesh.setEnabled(true);
          if (!mesh.isVisible) mesh.isVisible = true;

          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;
          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility <= 0.01 && renderState.targetVisibility <= 0.005) {
            renderState.visibility = 0.0;
            renderState.state = 'HARD_CULLED';
            e.isCulled = true;

            const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
            renderState.isShadowProtected = isNeededForShadow;

            // NO desactivar la malla físicamente: se mantiene activa con opacidad cero para evitar pop-in
            mesh.setEnabled(true);
            mesh.isVisible = false;
            this.applyVisibilityToMeshes(cachedMeshes, 0.0);

            discreteStateChanged = true;
            changedCount++;
            hCount++;
          }
          break;

        case 'HARD_CULLED':
          hCount++;
          mesh.setEnabled(true);
          mesh.isVisible = false;
          break;

        case 'RESTORING':
          rCount++;
          if (!mesh.isEnabled()) mesh.setEnabled(true);
          if (!mesh.isVisible) mesh.isVisible = true;

          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * (lerpSpeed * 1.5);
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

    this.profiler.cullingEvaluatedCount = evaluatedCount;
    this.profiler.cullingChangedCount = changedCount;
    this.profiler.recordDistanceEvaluation('LocalRenderingSystem', evaluatedCount);

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
    isGroupPreactivated: boolean
  ): void {
    const groupBonus = isGroupPreactivated ? 20.0 : 0.0;
    const effectiveCull = baseCullDist + dynamicLookAheadBonus + groupBonus;
    const effectiveFadeStart = fadeStartDist + dynamicLookAheadBonus + groupBonus;
    const REACQUIRE_MARGIN = 14.0;

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