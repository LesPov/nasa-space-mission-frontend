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

  // Radio central de relevancia espacial amplia para pasillos y estructuras
  private readonly RELEVANCE_CORE_RADIUS = 140.0;
  private readonly RELEVANCE_HYSTERESIS_MARGIN = 25.0;

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
      nameL.includes('corridor') ||
      nameL.includes('pasillo') ||
      nameL.includes('pasillocurvo') ||
      nameL.includes('pared') ||
      nameL.includes('wall') ||
      nameL.includes('piso') ||
      nameL.includes('floor') ||
      nameL.includes('poste') ||
      nameL.includes('lamp') ||
      nameL.includes('luz') ||
      nameL.includes('door') ||
      nameL.includes('puerta') ||
      nameL.includes('doorframe') ||
      nameL.includes('marco') ||
      nameL.includes('portal') ||
      nameL.includes('arch') ||
      nameL.includes('ceiling') ||
      nameL.includes('roof') ||
      nameL.includes('techo') ||
      nameL.includes('col') ||
      nameL.includes('column') ||
      nameL.includes('columna') ||
      nameL.includes('corner') ||
      nameL.includes('curved') ||
      nameL.includes('texture_atlas') ||
      Tags.MatchesQuery(e.view, 'invisible_floor')
    ) {
      return true;
    }
    return false;
  }

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (this.isStructuralEntity(e)) return false;
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
    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const origin = explicitOrigin || (playerEntity?.view ? playerEntity.view.getAbsolutePosition() : Vector3.Zero());
    this.lastPlayerPos.copyFrom(origin);
    this.spatialGroups.updateGroups(origin, Vector3.Zero());

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

      const effectiveDist = this.spatialHub.getDistanceToPlayer(e.uid);
      const record = this.spatialHub.getRecord(e.uid);
      const boundingRadius = record ? record.boundingRadius : 2.0;

      // Compensación de volumen arquitectónico
      const adjustedDist = Math.max(0, effectiveDist - boundingRadius);

      if (adjustedDist <= this.RELEVANCE_CORE_RADIUS) {
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
      } else {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
        e.isCulled = !isNeededForShadow;
        mesh.setEnabled(true);
        // Si se requiere para sombras, se mantiene activo en el pipeline de renderizado
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

    // Evaluación a 15 Hz estable
    const shouldCheckDistance = this.distanceCheckTimer >= 66;
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

    if (playerEntity && playerEntity.view && dtMs > 0) {
      const currPos = playerEntity.view.getAbsolutePosition();
      this.playerVelocity.copyFrom(currPos).subtractInPlace(this.lastPlayerPos).scaleInPlace(1000 / dtMs);
      this.lastPlayerPos.copyFrom(currPos);
    }

    if (shouldCheckDistance && playerEntity && playerEntity.view) {
      this.spatialGroups.updateGroups(playerEntity.view.getAbsolutePosition(), this.playerVelocity);
    }

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

      // Inmunidad estructural permanente: mallas arquitectónicas nunca sufren culling
      if (!isEligible) {
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
        const effectiveDist = this.spatialHub.getDistanceToPlayer(e.uid);
        const record = this.spatialHub.getRecord(e.uid);
        const boundingRadius = record ? record.boundingRadius : 2.0;
        const adjustedDist = Math.max(0, effectiveDist - boundingRadius);

        if (adjustedDist <= this.RELEVANCE_CORE_RADIUS) {
          if (renderState.visibility !== 1.0 || renderState.state !== 'VISIBLE') {
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
        } else if (adjustedDist > (this.RELEVANCE_CORE_RADIUS + this.RELEVANCE_HYSTERESIS_MARGIN)) {
          const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
          
          if (isNeededForShadow) {
            // Protección de sombra: se mantiene activa con visibilidad completa para casters
            if (renderState.state !== 'VISIBLE' || !mesh.isVisible) {
              renderState.state = 'VISIBLE';
              renderState.visibility = 1.0;
              renderState.targetVisibility = 1.0;
              renderState.isShadowProtected = true;
              e.isCulled = false;
              mesh.setEnabled(true);
              mesh.isVisible = true;
              this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0, true);
              changedThisFrame++;
            }
            sCount++;
            vCount++;
          } else {
            if (renderState.state !== 'HARD_CULLED') {
              renderState.state = 'HARD_CULLED';
              renderState.visibility = 0.0;
              renderState.targetVisibility = 0.0;
              renderState.isShadowProtected = false;
              e.isCulled = true;
              mesh.setEnabled(true);
              mesh.isVisible = false;
              this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 0.0, false);
              changedThisFrame++;
            }
            hCount++;
          }
        } else {
          vCount++;
        }
      } else {
        if (renderState.state === 'VISIBLE') vCount++;
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

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number, isShadowCaster = false) {
    const isFullyVisible = visibility >= 0.99;
    const isHidden = visibility <= 0.01;

    for (let c = 0; c < meshes.length; c++) {
      const m = meshes[c];
      m.visibility = isFullyVisible ? 1.0 : (isHidden ? 0.0 : visibility);
      m.isVisible = !isHidden;

      // Garantiza que casters requeridos nunca se descarten en el frustum del ShadowMap
      if (isShadowCaster && !isHidden) {
        m.alwaysSelectAsActiveMesh = true;
      } else {
        m.alwaysSelectAsActiveMesh = false;
      }
    }
  }
}