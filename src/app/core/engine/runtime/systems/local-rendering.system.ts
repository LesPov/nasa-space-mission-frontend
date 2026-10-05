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
      smoothedPlayerSpeed: parseFloat(this.smoothedSpeed.toFixed(2))
    };
  }

  private getCachedMeshes(entity: GameEntity, rootMesh: AbstractMesh): AbstractMesh[] {
    let cached = this.meshCache.get(entity.uid);
    if (!cached || cached.length === 0 || cached[0] !== rootMesh) {
      const rebuilt: AbstractMesh[] = [];

      const collectRenderable = (mesh: AbstractMesh) => {
        if (!mesh || mesh.isDisposed()) return;
        if (Tags.MatchesQuery(mesh, 'proxy_collider || debug_element || editor_only || light_visual || system_element')) {
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
    if (e.visual?.disableCulling) return true;
    if (e.type === 'plane' || e.name.toLowerCase().includes('piso') || e.name.toLowerCase().includes('suelo')) return true;
    if (
      e.type === 'model' &&
      (e.name.toLowerCase().includes('pasillo') ||
        e.name.toLowerCase().includes('corridor') ||
        e.name.toLowerCase().includes('room') ||
        e.name.toLowerCase().includes('sala') ||
        e.name.toLowerCase().includes('edificio') ||
        e.name.toLowerCase().includes('building') ||
        e.name.toLowerCase().includes('base') ||
        e.name.toLowerCase().includes('structure') ||
        e.name.toLowerCase().includes('wall') ||
        e.name.toLowerCase().includes('pared'))
    ) {
      return true;
    }

    const sx = Math.abs(e.transform.scale.x);
    const sz = Math.abs(e.transform.scale.z);
    if (sx >= 8.0 || sz >= 8.0) return true;

    const rec = this.spatialHub.getRecord(e.uid);
    if (rec && rec.boundingRadius > 10.0) return true;

    return false;
  }

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.rol === 'npc' || e.characterConfig || e.rol === 'spawn_point') return false;
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
          if (!Tags.MatchesQuery(c, 'proxy_collider || debug_element || editor_only || light_visual')) {
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

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 160, fadeMargin: 30 };
    if (!cullingConfig.enabled) {
      this.stop();
      return;
    }

    const origin = explicitOrigin || (playerEntity?.view ? playerEntity.view.getAbsolutePosition() : Vector3.Zero());
    this.spatialGroups.updateGroups(origin, Vector3.Zero());

    const cullDistance = Math.max(60, Number(cullingConfig.cullDistance) || 160);
    const fadeMargin = Math.min(cullDistance - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 30));
    const fadeStartDist = Math.max(0, cullDistance - fadeMargin);

    this.resetCounters();

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

      if (isStructural) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural: true, lastStateChangeTime: performance.now(), flapCounter: 0 });
        this._visibleCount++;
        continue;
      }

      if (!this.isEligibleForHardCull(e)) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural, lastStateChangeTime: performance.now(), flapCounter: 0 });
        this._visibleCount++;
        continue;
      }

      const group = this.spatialGroups.getGroupForEntity(e.uid);
      if (group) {
        if (group.state === 'ACTIVE' || group.state === 'PREPARED' || group.state === 'RETAINED') {
          e.isCulled = false;
          mesh.setEnabled(true);
          mesh.isVisible = true;
          this.applyVisibilityToMeshes(cachedMeshes, 1.0);
          this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural, lastStateChangeTime: performance.now(), flapCounter: 0 });
          this._visibleCount++;
          continue;
        }
      }

      const distToCenter = this.spatialHub.getDistanceToPlayer(e.uid);
      const rec = this.spatialHub.getRecord(e.uid);
      const radius = rec ? rec.boundingRadius : 1.0;
      const effectiveDist = Math.max(0, distToCenter - radius);

      if (effectiveDist > cullDistance) {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
        e.isCulled = true;
        mesh.setEnabled(isNeededForShadow);
        mesh.isVisible = false;
        this.applyVisibilityToMeshes(cachedMeshes, 0.0);
        this.renderStates.set(e.uid, { state: 'HARD_CULLED', visibility: 0.0, targetVisibility: 0.0, isShadowProtected: isNeededForShadow, isStructural: false, lastStateChangeTime: performance.now(), flapCounter: 0 });
        this._hardCulledCount++;
      } else if (effectiveDist <= fadeStartDist) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural: false, lastStateChangeTime: performance.now(), flapCounter: 0 });
        this._visibleCount++;
      } else {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        let t = (effectiveDist - fadeStartDist) / fadeMargin;
        t = Math.max(0, Math.min(1, t));
        const alpha = Math.max(0.0001, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));
        this.applyVisibilityToMeshes(cachedMeshes, alpha);
        this.renderStates.set(e.uid, { state: 'FADING_OUT', visibility: alpha, targetVisibility: alpha, isShadowProtected: false, isStructural: false, lastStateChangeTime: performance.now(), flapCounter: 0 });
        this._fadingCount++;
      }
    }

    this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
  }

  private ensureAllEntitiesVisibleForEditor(): void {
    const entities = this.entityManager.getAllEntities();
    this.resetCounters();

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
      this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural: true, lastStateChangeTime: performance.now(), flapCounter: 0 });
      this._visibleCount++;
    }
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

    // Frecuencia estable de evaluación: cada 45ms (~22 Hz)
    const shouldCheckDistance = this.distanceCheckTimer >= 45;
    if (shouldCheckDistance) {
      this.distanceCheckTimer = 0;
    }

    const isTransitioning = this.context.isTransitioning();
    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 160, fadeMargin: 30 };
    if (!cullingConfig.enabled || isTransitioning) {
      return;
    }

    if (playerEntity && playerEntity.view && dtMs > 0) {
      const currPos = playerEntity.view.getAbsolutePosition();
      this.playerVelocity.copyFrom(currPos).subtractInPlace(this.lastPlayerPos).scaleInPlace(1000 / dtMs);
      this.lastPlayerPos.copyFrom(currPos);

      const rawSpeed = this.playerVelocity.length();
      // Filtrado exponencial de velocidad para estabilizar el look-ahead y evitar flapping
      this.smoothedSpeed = (this.smoothedSpeed * 0.85) + (rawSpeed * 0.15);

      if (rawSpeed > 10.0) {
        this.incidentSvc.recordFastMove(rawSpeed, currPos);
      }
    }

    if (shouldCheckDistance && playerEntity && playerEntity.view) {
      this.spatialGroups.updateGroups(playerEntity.view.getAbsolutePosition(), this.playerVelocity);
    }

    const dynamicLookAheadBonus = Math.min(25.0, this.smoothedSpeed * 1.5);
    const baseCullDist = Math.max(60, Number(cullingConfig.cullDistance) || 160);
    const fadeMargin = Math.min(baseCullDist - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 30));
    const fadeStartDist = Math.max(0, baseCullDist - fadeMargin);

    const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.25);
    let visibilityChangedInBatch = false;

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

      // 1. ESTRUCTURAS, PAREDES, PASILLOS Y PERSONAJES: SIEMPRE 100% OPACOS (SIN ALPHA-BLENDING ROJO/GRIS)
      if (isStructural || !this.isEligibleForHardCull(e)) {
        if (e.isCulled) {
          e.isCulled = false;
          visibilityChangedInBatch = true;
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

      // 2. OBJETOS GENERALES Y PROPS: EVALUACIÓN DE DISTANCIA CON PREFETCH Y READINESS
      if (shouldCheckDistance) {
        evaluatedCount++;
        const group = this.spatialGroups.getGroupForEntity(e.uid);
        const wasCulled = e.isCulled;
        const prevState = renderState.state;

        if (group && (group.state === 'ACTIVE' || group.state === 'PREPARED' || group.state === 'RETAINED')) {
          // Dentro de la zona de prefetch de grupo: RESTAURACIÓN INMEDIATA A OPACIDAD TOTAL
          renderState.targetVisibility = 1.0;
          renderState.visibility = 1.0;
          renderState.state = 'VISIBLE';
          e.isCulled = false;
          mesh.setEnabled(true);
          mesh.isVisible = true;
          this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0);
          this.shadowService.notifyCasterRestored(e.uid);
        } else {
          this.evaluateIndividualCulling(e, renderState, mesh, baseCullDist, dynamicLookAheadBonus, fadeStartDist, fadeMargin);
        }

        if (prevState !== renderState.state) {
          if (now - renderState.lastStateChangeTime < 2000) {
            renderState.flapCounter++;
            if (renderState.flapCounter >= 3) {
              const dist = this.spatialHub.getDistanceToPlayer(e.uid);
              this.incidentSvc.recordCullingFlap(e.uid, e.name, dist, this.smoothedSpeed);
              renderState.flapCounter = 0;
            }
          } else {
            renderState.flapCounter = 0;
          }
          renderState.lastStateChangeTime = now;
        }

        if (wasCulled !== e.isCulled) {
          visibilityChangedInBatch = true;
          changedCount++;

          const dist = this.spatialHub.getDistanceToPlayer(e.uid);
          if (e.isCulled) {
            this.incidentSvc.recordObjectPopOut(e.uid, e.name, dist, this.smoothedSpeed);
          } else {
            this.incidentSvc.recordObjectPopIn(e.uid, e.name, dist, this.smoothedSpeed);
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

          if (renderState.visibility <= 0.0005 && renderState.targetVisibility <= 0.0002) {
            renderState.visibility = 0.0001;
            renderState.state = 'HARD_CULLED';
            e.isCulled = true;

            const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
            renderState.isShadowProtected = isNeededForShadow;

            if (isNeededForShadow) {
              mesh.setEnabled(true);
              mesh.isVisible = false;
              this.applyVisibilityToMeshes(cachedMeshes, 0.0);
              sCount++;
            } else {
              mesh.setEnabled(false);
              mesh.isVisible = false;
              this.applyVisibilityToMeshes(cachedMeshes, 0.0001);
            }

            visibilityChangedInBatch = true;
            changedCount++;
          }
          break;

        case 'HARD_CULLED':
          hCount++;
          if (renderState.isShadowProtected) {
            sCount++;
            if (!mesh.isEnabled()) mesh.setEnabled(true);
            mesh.isVisible = false;
          } else {
            if (mesh.isEnabled()) {
              mesh.setEnabled(false);
            }
            mesh.isVisible = false;
          }
          break;

        case 'RESTORING':
          rCount++;
          if (!mesh.isEnabled()) mesh.setEnabled(true);
          if (!mesh.isVisible) mesh.isVisible = true;

          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * (lerpSpeed * 2.0);
          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility >= 0.995 && renderState.targetVisibility >= 0.995) {
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

    if (visibilityChangedInBatch) {
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
    }
  }

  private evaluateIndividualCulling(
    e: GameEntity,
    renderState: RenderState,
    mesh: AbstractMesh,
    baseCullDist: number,
    dynamicLookAheadBonus: number,
    fadeStartDist: number,
    fadeMargin: number
  ): void {
    const distSqToCenter = this.spatialHub.getDistanceSquaredToPlayer(e.uid);
    const rec = this.spatialHub.getRecord(e.uid);
    const radius = rec ? rec.boundingRadius : 1.0;

    // Distancia matemática al borde exterior de la caja orientada
    const effectiveDist = Math.max(0, Math.sqrt(distSqToCenter) - radius);
    const effectiveCull = baseCullDist + dynamicLookAheadBonus;
    const effectiveFadeStart = fadeStartDist + dynamicLookAheadBonus;

    // Histéresis robusta para re-adquisición (5m de margen hacia afuera)
    const reacquireMargin = 5.0;

    if (renderState.state === 'HARD_CULLED') {
      if (effectiveDist < effectiveCull + reacquireMargin) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        renderState.isShadowProtected = false;

        // Si el jugador ya está dentro de la zona nítida, restaurar al 100% de inmediato
        if (effectiveDist <= effectiveFadeStart) {
          renderState.state = 'VISIBLE';
          renderState.visibility = 1.0;
          renderState.targetVisibility = 1.0;
          this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0);
        } else {
          renderState.state = 'RESTORING';
          let t = (effectiveDist - effectiveFadeStart) / fadeMargin;
          t = Math.max(0, Math.min(1, t));
          renderState.targetVisibility = Math.max(0.2, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));
          renderState.visibility = renderState.targetVisibility;
          this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), renderState.visibility);
        }

        this.shadowService.notifyCasterRestored(e.uid);
      }
    } else {
      if (effectiveDist > effectiveCull) {
        renderState.targetVisibility = 0.0001;
        if (renderState.state === 'VISIBLE') {
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
        let t = (effectiveDist - effectiveFadeStart) / fadeMargin;
        t = Math.max(0, Math.min(1, t));
        renderState.targetVisibility = Math.max(0.0001, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));

        if (renderState.state === 'VISIBLE') {
          renderState.state = 'FADING_OUT';
        }
        e.isCulled = false;
        renderState.isShadowProtected = false;
      }
    }
  }

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number) {
    const clamped = Math.max(0.0001, Math.min(1.0, visibility));
    for (let c = 0; c < meshes.length; c++) {
      const m = meshes[c];
      m.visibility = clamped;
      m.isVisible = clamped > 0.0005;
    }
  }
}