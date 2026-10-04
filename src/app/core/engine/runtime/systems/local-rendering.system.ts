
// file: src/app/core/engine/runtime/systems/local-rendering.system.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { AbstractMesh, Vector3, Tags, Mesh, InstancedMesh } from '@babylonjs/core';
import { GameMode } from '../../session/game-mode.model';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../../scene/scene-access.token';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { LightShadowService } from './lighting/light-shadow.service';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
import { SpatialRelevanceHubService } from '../../spatial/spatial-relevance-hub.service';

export type CullState = 'VISIBLE' | 'FADING_OUT' | 'HARD_CULLED' | 'RESTORING';

interface RenderState {
  state: CullState;
  visibility: number;
  targetVisibility: number;
  isShadowProtected: boolean;
}

export interface CullingSystemMetrics {
  visibleObjects: number;
  fadingObjects: number;
  hardCulledObjects: number;
  restoringObjects: number;
  shadowProtectedObjects: number;
}

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';

  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private shadowService = inject(LightShadowService);
  private profiler = inject(EngineProfilerService);
  private spatialHub = inject(SpatialRelevanceHubService);

  private frameCounter = 0;
  private distanceCheckTimer = 0;
  private meshCache = new Map<string, AbstractMesh[]>();
  private renderStates = new Map<string, RenderState>();

  private _visibleCount = 0;
  private _fadingCount = 0;
  private _hardCulledCount = 0;
  private _restoringCount = 0;
  private _shadowProtectedCount = 0;

  public getMetrics(): CullingSystemMetrics {
    return {
      visibleObjects: this._visibleCount,
      fadingObjects: this._fadingCount,
      hardCulledObjects: this._hardCulledCount,
      restoringObjects: this._restoringCount,
      shadowProtectedObjects: this._shadowProtectedCount
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

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.rol === 'npc' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (e.autoAnim?.enabled) return false;
    if (e.movementAuthority !== 'GAMEPLAY') return false;
    if (e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_')) return false;
    if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') return false;
    if (e.visual?.disableCulling) return false;
    return true;
  }

  public start(): void {
    this.meshCache.clear();
    this.renderStates.clear();
    this.frameCounter = 0;
    this.distanceCheckTimer = 9999;
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

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 100, fadeMargin: 50 };
    if (!cullingConfig.enabled) {
      this.stop();
      return;
    }

    const cullDistance = Math.max(10, Number(cullingConfig.cullDistance) || 100);
    const fadeMargin = Math.min(cullDistance - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 50));
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

      if (!this.isEligibleForHardCull(e)) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false });
        this._visibleCount++;
        continue;
      }

      const distToCenter = this.spatialHub.getDistanceToPlayer(e.uid);
      const rec = this.spatialHub.getRecord(e.uid);
      const radius = rec ? rec.boundingRadius : 1.0;
      const effectiveDist = Math.max(0, distToCenter - radius);
      const cachedMeshes = this.getCachedMeshes(e, mesh);

      if (effectiveDist > cullDistance) {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);

        if (isNeededForShadow) {
          e.isCulled = true;
          mesh.setEnabled(true);
          mesh.isVisible = false;
          this.applyVisibilityToMeshes(cachedMeshes, 0.0);
          this.renderStates.set(e.uid, { state: 'HARD_CULLED', visibility: 0.0, targetVisibility: 0.0, isShadowProtected: true });
          this._shadowProtectedCount++;
          this._hardCulledCount++;
        } else {
          e.isCulled = true;
          mesh.setEnabled(false);
          mesh.isVisible = false;
          this.applyVisibilityToMeshes(cachedMeshes, 0.0);
          this.renderStates.set(e.uid, { state: 'HARD_CULLED', visibility: 0.0, targetVisibility: 0.0, isShadowProtected: false });
          this._hardCulledCount++;
        }
      } else if (effectiveDist <= fadeStartDist) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false });
        this._visibleCount++;
      } else {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        let t = (effectiveDist - fadeStartDist) / fadeMargin;
        t = Math.max(0, Math.min(1, t));
        const initialAlpha = Math.max(0.00001, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));
        this.applyVisibilityToMeshes(cachedMeshes, initialAlpha);
        this.renderStates.set(e.uid, { state: 'FADING_OUT', visibility: initialAlpha, targetVisibility: initialAlpha, isShadowProtected: false });
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
      this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false });
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

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 100, fadeMargin: 50 };
    if (!cullingConfig.enabled || isTransitioning) {
      return;
    }

    const dynamicCullDist = Math.max(10, Number(cullingConfig.cullDistance) || 100);
    const fadeMargin = Math.min(dynamicCullDist - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 50));
    const fadeStartDist = Math.max(0, dynamicCullDist - fadeMargin);

    const CULL_SQ = dynamicCullDist * dynamicCullDist;
    const FADE_SQ = fadeStartDist * fadeStartDist;

    const hysteresisMargin = Math.min(10, Math.max(3, fadeMargin * 0.2));
    const cullInDistance = Math.max(0, dynamicCullDist - hysteresisMargin);
    const CULL_IN_SQ = cullInDistance * cullInDistance;

    const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.18);
    let visibilityChangedInBatch = false;

    let vCount = 0, fCount = 0, hCount = 0, rCount = 0, sCount = 0;
    let evaluatedCount = 0;
    let changedCount = 0;

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

      if (!this.renderStates.has(e.uid)) {
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false });
      }
      const renderState = this.renderStates.get(e.uid)!;

      if (!this.isEligibleForHardCull(e)) {
        if (e.isCulled) {
          e.isCulled = false;
          visibilityChangedInBatch = true;
          changedCount++;
        }
        renderState.targetVisibility = 1.0;
        if (renderState.state === 'HARD_CULLED' || renderState.state === 'FADING_OUT') {
          renderState.state = 'RESTORING';
        }
        vCount++;
      } else if (shouldCheckDistance) {
        evaluatedCount++;

        // 🔥 INTEGRACIÓN SPATIAL HUB: Reutiliza distSqToPlayer precalculado
        const distSqToCenter = this.spatialHub.getDistanceSquaredToPlayer(e.uid);
        const rec = this.spatialHub.getRecord(e.uid);
        const radius = rec ? rec.boundingRadius : 1.0;

        // Comprobación rápida por esferas envolventes
        const effectiveDist = Math.max(0, Math.sqrt(distSqToCenter) - radius);
        const distSq = effectiveDist * effectiveDist;
        const wasCulled = e.isCulled;

        if (renderState.state === 'HARD_CULLED') {
          if (distSq < CULL_IN_SQ) {
            renderState.state = 'RESTORING';
            e.isCulled = false;
            mesh.setEnabled(true);
            mesh.isVisible = true;
            renderState.visibility = 0.00001;
            renderState.isShadowProtected = false;
            this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 0.00001);

            if (distSq <= FADE_SQ) {
              renderState.targetVisibility = 1.0;
            } else {
              let t = (effectiveDist - fadeStartDist) / fadeMargin;
              t = Math.max(0, Math.min(1, t));
              const easeAlpha = 1.0 - t * t * (3.0 - 2.0 * t);
              renderState.targetVisibility = Math.max(0.00001, Math.min(1.0, easeAlpha));
            }

            this.shadowService.notifyCasterRestored(e.uid);
          }
        } else {
          if (distSq > CULL_SQ) {
            renderState.targetVisibility = 0.00001;
            if (renderState.state === 'VISIBLE') {
              renderState.state = 'FADING_OUT';
            }
          } else if (distSq <= FADE_SQ) {
            renderState.targetVisibility = 1.0;
            if (renderState.state === 'FADING_OUT') {
              renderState.state = 'RESTORING';
            }
            e.isCulled = false;
            renderState.isShadowProtected = false;
          } else {
            let t = (effectiveDist - fadeStartDist) / fadeMargin;
            t = Math.max(0, Math.min(1, t));
            const easeAlpha = 1.0 - t * t * (3.0 - 2.0 * t);
            renderState.targetVisibility = Math.max(0.00001, Math.min(1.0, easeAlpha));

            if (renderState.state === 'VISIBLE') {
              renderState.state = 'FADING_OUT';
            }
            e.isCulled = false;
            renderState.isShadowProtected = false;
          }
        }

        if (wasCulled !== e.isCulled) {
          visibilityChangedInBatch = true;
          changedCount++;
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

          if (Math.abs(renderState.visibility - renderState.targetVisibility) < 0.001) {
            renderState.visibility = renderState.targetVisibility;
          }

          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility <= 0.00005 && renderState.targetVisibility <= 0.00002) {
            renderState.visibility = 0.00001;
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
              this.applyVisibilityToMeshes(cachedMeshes, 0.00001);
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
            if (mesh.isEnabled() && this.isEligibleForHardCull(e)) {
              mesh.setEnabled(false);
            }
            mesh.isVisible = false;
          }
          break;

        case 'RESTORING':
          rCount++;
          if (!mesh.isEnabled()) mesh.setEnabled(true);
          if (!mesh.isVisible) mesh.isVisible = true;

          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;

          if (Math.abs(renderState.visibility - renderState.targetVisibility) < 0.001) {
            renderState.visibility = renderState.targetVisibility;
          }

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

    // Reporte al profiler
    this.profiler.cullingEvaluatedCount = evaluatedCount;
    this.profiler.cullingChangedCount = changedCount;
    this.profiler.recordDistanceEvaluation('LocalRenderingSystem', evaluatedCount);

    if (visibilityChangedInBatch) {
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
    }
  }

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number) {
    const clamped = Math.max(0.00001, Math.min(1.0, visibility));
    for (let c = 0; c < meshes.length; c++) {
      const m = meshes[c];
      m.visibility = clamped;
      m.isVisible = clamped > 0.0001;
    }
  }
}