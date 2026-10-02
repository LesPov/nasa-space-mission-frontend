
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { AbstractMesh, Vector3, Tags } from '@babylonjs/core';
import { GameMode } from '../../session/game-mode.model';
import { WorldSettingsService } from '../../world/world-settings.service';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../../scene/scene-access.token';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';

interface VolumeCache {
    center: Vector3;
    radius: number;
}

export type CullState = 'VISIBLE' | 'FADING_OUT' | 'HARD_CULLED' | 'RESTORING';

interface RenderState {
    state: CullState;
    visibility: number;
    targetVisibility: number;
}

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';
  
  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);

  private frameCounter = 0;
  private distanceCheckTimer = 0;
  private meshCache = new Map<string, AbstractMesh[]>();
  private volumeCache = new Map<string, VolumeCache>();
  private renderStates = new Map<string, RenderState>();
  
  private static _fallbackPos = Vector3.Zero();

  private lastRefPos = Vector3.Zero();

  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      if (camera) return camera.globalPosition;
      return LocalRenderingSystem._fallbackPos;
  }

  private getCachedMeshes(entity: GameEntity, rootMesh: AbstractMesh): AbstractMesh[] {
      let cached = this.meshCache.get(entity.uid);
      if (!cached || cached[0] !== rootMesh) {
          cached = [rootMesh];
          const children = rootMesh.getChildMeshes(false);
          for (let c = 0; c < children.length; c++) {
              if (!Tags.MatchesQuery(children[c], "proxy_collider || debug_element || editor_only || light_visual")) {
                  cached.push(children[c]);
              }
          }
          this.meshCache.set(entity.uid, cached);
      }
      return cached;
  }

  private getVolume(entity: GameEntity, rootMesh: AbstractMesh): VolumeCache {
      let vol = this.volumeCache.get(entity.uid);
      
      if (!vol || entity.isDirty) {
          const bounds = rootMesh.getHierarchyBoundingVectors(false, (m) => {
              return !Tags.MatchesQuery(m, "system_element || editor_only || proxy_collider || light_visual");
          });
          
          const center = bounds.min.add(bounds.max).scale(0.5);
          const radius = bounds.max.subtract(center).length(); 
          
          vol = { center, radius };
          this.volumeCache.set(entity.uid, vol);
      }
      return vol;
  }

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.rol === 'npc' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (e.autoAnim?.enabled) return false;
    if (e.movementAuthority !== 'GAMEPLAY') return false; 
    if (e.type === 'trigger' || e.type === 'trigger_compuesto') return false; 
    if (e.type.startsWith('light_')) return false; 
    if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') return false;
    return true;
  }

  public start(): void {
      this.meshCache.clear();
      this.volumeCache.clear();
      this.renderStates.clear();
      this.lastRefPos.set(0, 0, 0);
      this.frameCounter = 0;
      this.distanceCheckTimer = 0;
  }

  public stop(): void {
      const entities = this.entityManager.getAllEntities();
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          e.isCulled = false;
          
          if (e.isManuallyHidden) continue; // Respetar la decisión del usuario en el editor

          const mesh = e.view as AbstractMesh;
          if (mesh && !mesh.isDisposed()) {
              if (!mesh.isEnabled()) mesh.setEnabled(true);
              if (!mesh.isVisible) mesh.isVisible = true;
              
              const cachedMeshes = this.getCachedMeshes(e, mesh);
              for (let m = 0; m < cachedMeshes.length; m++) {
                  const c = cachedMeshes[m];
                  if (!Tags.MatchesQuery(c, "proxy_collider || debug_element || editor_only || light_visual")) {
                      c.isVisible = true;
                      c.visibility = 1.0;
                  }
              }
          }
      }
      this.start();
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
  }

  public update(dtMs: number): void {
      this.frameCounter++;
      this.distanceCheckTimer += dtMs;
      
      const shouldCheckDistance = this.distanceCheckTimer >= 100;
      if (shouldCheckDistance) {
          this.distanceCheckTimer = 0;
      }
      
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const isTransitioning = this.context.isTransitioning();
      
      const refPos = this.getReferencePosition();
      let velocityOffset = Vector3.Zero();
      let speed = 0;

      if (dtMs > 0 && this.frameCounter > 1) {
          const vel = refPos.subtract(this.lastRefPos).scale(1000 / dtMs);
          speed = vel.length();
          if (speed > 2.0) {
              // 🔥 EXPANDIR HACIA ADELANTE (Prediction Culling) con límite para evitar glitches
              velocityOffset = vel.normalize().scale(Math.min(speed * 0.75, 50)); 
          }
      }
      this.lastRefPos.copyFrom(refPos);

      const effectiveRefPos = refPos.add(velocityOffset);

      const entities = this.entityManager.getAllEntities();
      const playerEntity = this.context.activePlayerEntity();

      const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 150, fadeMargin: 30 };
      const isCullingEnabled = cullingConfig.enabled;
      
      let dynamicCullDist = Math.max(10, cullingConfig.cullDistance);
      // 🔥 AUMENTAR ANILLO DE CULLING SI ESTÁ CORRIENDO
      if (speed > 2.0) {
          dynamicCullDist += speed * 1.5;
      }

      const fadeMargin = Math.min(dynamicCullDist - 1, Math.max(0, cullingConfig.fadeMargin));
      const fadeStartDist = dynamicCullDist - fadeMargin;

      const CULL_SQ = dynamicCullDist * dynamicCullDist;
      const FADE_SQ = fadeStartDist * fadeStartDist;
      const BROADPHASE_DIST = dynamicCullDist + 100; 

      const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.15);
      
      let visibilityChangedInBatch = false;

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          const mesh = e.view as AbstractMesh;
          if (!mesh || mesh.isDisposed()) continue;

          // 🔥 PRIORIDAD ABSOLUTA: Decision manual del usuario en el Outliner
          if (e.isManuallyHidden) {
              if (mesh.isVisible || mesh.isEnabled()) {
                  mesh.isVisible = false;
                  mesh.setEnabled(false);
              }
              continue;
          }

          if (!this.renderStates.has(e.uid)) {
              this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0 });
          }
          const renderState = this.renderStates.get(e.uid)!;

          let effectiveDist = 0;

          // Inmunidades de culling
          if (e.isPersistent || e.characterConfig || e.rol === 'spawn_point' || 
              e.type === 'trigger' || e.type === 'trigger_compuesto' || e.type.startsWith('light_') ||
              e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble' ||
              e.visual?.disableCulling || isEditor || !isCullingEnabled || isTransitioning) {
              
              if (e.isCulled) {
                  e.isCulled = false;
                  visibilityChangedInBatch = true;
              }
              renderState.targetVisibility = 1.0;
              if (renderState.state === 'HARD_CULLED' || renderState.state === 'FADING_OUT') {
                  renderState.state = 'RESTORING';
              }
          } else if (shouldCheckDistance) {
              const volume = this.getVolume(e, mesh);
              
              const dx = Math.abs(effectiveRefPos.x - volume.center.x);
              const dy = Math.abs(effectiveRefPos.y - volume.center.y);
              const dz = Math.abs(effectiveRefPos.z - volume.center.z);

              const wasCulled = e.isCulled;
              let distSq = 0;

              if (dx - volume.radius > BROADPHASE_DIST || dy - volume.radius > BROADPHASE_DIST || dz - volume.radius > BROADPHASE_DIST) {
                  distSq = Number.MAX_VALUE;
                  effectiveDist = Math.sqrt(distSq);
              } else {
                  const distToCenter = Math.sqrt(dx*dx + dy*dy + dz*dz);
                  effectiveDist = Math.max(0, distToCenter - volume.radius);
                  distSq = effectiveDist * effectiveDist;
              }

              // 🔥 HISTÉRESIS Y RESOLUCIÓN DE ESTADOS CORREGIDA PARA TYPESCRIPT
              const cullInDistSq = Math.max(0, dynamicCullDist - 5);
              const cullInSq = cullInDistSq * cullInDistSq;

              if (renderState.state === 'HARD_CULLED') {
                  if (distSq < cullInSq) {
                      renderState.state = 'RESTORING';
                      e.isCulled = false;
                      this.debugLog(e, renderState, dynamicCullDist, effectiveDist);
                  }
              } else {
                  // Entra aquí solo si el estado NO ES HARD_CULLED
                  if (distSq > CULL_SQ) {
                      renderState.targetVisibility = 0.00001;
                      if (renderState.state === 'VISIBLE') renderState.state = 'FADING_OUT';
                      e.isCulled = true;
                  } else if (distSq < FADE_SQ) {
                      renderState.targetVisibility = 1.0;
                      if (renderState.state === 'FADING_OUT') {
                          renderState.state = 'RESTORING';
                      }
                      e.isCulled = false;
                  } else {
                      let t = 1.0 - ((Math.sqrt(distSq) - fadeStartDist) / fadeMargin);
                      t = t * t * (3 - 2 * t); // Suavizado Ease-In-Out Cuadrático
                      renderState.targetVisibility = Math.max(0.00001, Math.min(1.0, t));
                      
                      if (renderState.state === 'VISIBLE') renderState.state = 'FADING_OUT';
                      
                      e.isCulled = false;
                  }
              }

              if (wasCulled !== e.isCulled) {
                  visibilityChangedInBatch = true;
              }
          }

          // Transiciones de Carga Aceleradas
          if (this.frameCounter <= 2 || isTransitioning) {
              renderState.visibility = renderState.targetVisibility;
          }

          // 🔥 EJECUCIÓN PURA DE LA MÁQUINA DE ESTADOS
          const cachedMeshes = this.getCachedMeshes(e, mesh);

          switch (renderState.state) {
              case 'VISIBLE':
                  if (Math.abs(renderState.visibility - renderState.targetVisibility) > 0.005) {
                      renderState.state = renderState.targetVisibility < 1.0 ? 'FADING_OUT' : 'RESTORING';
                  } else {
                      if (!mesh.isEnabled()) mesh.setEnabled(true);
                      if (!mesh.isVisible) {
                          this.applyVisibilityToMeshes(cachedMeshes, 1.0);
                          mesh.isVisible = true;
                      }
                  }
                  break;

              case 'FADING_OUT':
                  if (!mesh.isEnabled()) mesh.setEnabled(true);
                  if (!mesh.isVisible) mesh.isVisible = true;

                  renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;
                  
                  if (Math.abs(renderState.visibility - renderState.targetVisibility) < 0.005) {
                      renderState.visibility = renderState.targetVisibility;
                  }

                  this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

                  if (renderState.visibility <= 0.000011 && renderState.targetVisibility <= 0.000011) {
                      renderState.visibility = 0.00001;
                      renderState.state = 'HARD_CULLED';
                      this.debugLog(e, renderState, dynamicCullDist, effectiveDist);
                  }
                  break;

              case 'HARD_CULLED':
                  // 🔥 HARD CULL DEFINITIVO (Descarga del RenderPipeline de la GPU)
                  if (mesh.isEnabled() && this.isEligibleForHardCull(e)) {
                      mesh.setEnabled(false);
                  }
                  if (mesh.isVisible) {
                      this.applyVisibilityToMeshes(cachedMeshes, 0.00001);
                      mesh.isVisible = false;
                  }
                  break;

              case 'RESTORING':
                  // Encendido Pre-Warm Inmediato en Negro (0.00001)
                  if (!mesh.isEnabled()) mesh.setEnabled(true);
                  if (!mesh.isVisible) mesh.isVisible = true;

                  if (renderState.visibility <= 0.00001) {
                      this.debugLog(e, renderState, dynamicCullDist, effectiveDist);
                  }

                  renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;

                  if (Math.abs(renderState.visibility - renderState.targetVisibility) < 0.005) {
                      renderState.visibility = renderState.targetVisibility;
                  }

                  this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

                  // Fin de la restauración
                  if (renderState.visibility >= 0.995 && renderState.targetVisibility >= 0.995) {
                      renderState.visibility = 1.0;
                      renderState.state = 'VISIBLE';
                      this.applyVisibilityToMeshes(cachedMeshes, 1.0);
                  }
                  break;
          }
      }
      
      // Emitir solo 1 evento de Angular por frame máximo si la estructura cambió
      if (visibilityChangedInBatch) {
          this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
      }
  }

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number) {
      for (let c = 0; c < meshes.length; c++) {
          const m = meshes[c];
          m.visibility = visibility;
          if (visibility > 0.00001) {
              m.isVisible = true;
          } else {
              m.isVisible = false;
          }
      }
  }

  private debugLog(e: GameEntity, state: RenderState, cullDist: number, effectiveDist: number) {
      if (!this.context.authorityProfile().canViewDebug) return;
      // Solo en casos límite (Desaparición o Reaparición)
      console.log(`[CULL DEBUG] object=${e.name} mode=${this.context.mode()} effectiveDistance=${effectiveDist.toFixed(1)} cullDistance=${cullDist.toFixed(1)} isCulled=${e.isCulled} state=${state.state} visibility=${state.visibility.toFixed(5)}`);
  }
}