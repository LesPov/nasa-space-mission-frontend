
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { AbstractMesh, Vector3, Tags } from '@babylonjs/core';
import { GameMode } from '../../session/game-mode.model';
import { WorldSettingsService } from '../../world/world-settings.service';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../../scene/scene-access.token';

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';
  
  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  private frameCounter = 0;

  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      return camera ? camera.globalPosition : Vector3.Zero();
  }

  /**
   * Al detener el sistema (salir de TEST LIVE o recargar), restauramos forzosamente 
   * la visibilidad física de todas las mallas para no perderlas en el Editor.
   */
  public stop(): void {
      const entities = this.entityManager.getAllEntities();
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          e.isCulled = false;
          e.runtimeVisibilityTarget = 1.0;
          e.currentRuntimeVisibility = 1.0;
          
          const mesh = e.view as AbstractMesh;
          if (mesh && !mesh.isDisposed()) {
              if (!mesh.isEnabled()) mesh.setEnabled(true);
              mesh.visibility = 1.0;
              mesh.getChildMeshes(false).forEach(c => {
                  if (!Tags.MatchesQuery(c, "proxy_collider || debug_element || editor_only")) {
                      c.visibility = 1.0;
                  }
              });
          }
      }
  }

  public update(dtMs: number): void {
      this.frameCounter++;
      
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const isTransitioning = this.context.isTransitioning();
      
      const refPos = this.getReferencePosition();
      const entities = this.entityManager.getAllEntities();
      const playerEntity = this.context.activePlayerEntity();

      // 1. Leer la configuración global del player de forma segura
      const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 150, fadeMargin: 30 };
      const isCullingEnabled = cullingConfig.enabled;
      
      const cullDist = Math.max(10, cullingConfig.cullDistance);
      const fadeMargin = Math.min(cullDist - 1, Math.max(0, cullingConfig.fadeMargin));
      const fadeStartDist = cullDist - fadeMargin;

      const CULL_SQ = cullDist * cullDist;
      const FADE_SQ = fadeStartDist * fadeStartDist;
      const BROADPHASE_DIST = cullDist + 30; // Buffer holgado de rechazo rápido (AABB)

      // Lerp temporal independiente del framerate.
      // Ecuación rápida y extremadamente fluida. 0.15 a 60fps = transiciones en ~0.3 segundos.
      const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.15);

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          const mesh = e.view as AbstractMesh;
          if (!mesh || mesh.isDisposed()) continue;

          // --- FILTROS DE EXCLUSIÓN ---
          // Entidades sistémicas, de luz pura, o que tienen fade propio (ej: UI, hologramas)
          if (e.isPersistent || e.characterConfig || e.rol === 'spawn_point') continue;
          if (e.type === 'trigger' || e.type === 'trigger_compuesto' || e.type.startsWith('light_')) continue;
          if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') continue; 
          
          // Excepción individual: Objeto configurado desde Inspector como "Siempre Visible"
          if (e.visual?.disableCulling) {
              if (e.isCulled || e.runtimeVisibilityTarget !== 1.0) {
                   e.isCulled = false;
                   e.runtimeVisibilityTarget = 1.0;
              }
              // El sistema dejará que Narrowphase devuelva la visibilidad a 1.0 progresivamente si estaba en fade
          } 
          // Si estamos en editor o hay una transición de nivel, anulamos el culling
          else if (isEditor || !isCullingEnabled || isTransitioning) {
              e.isCulled = false;
              e.runtimeVisibilityTarget = 1.0;
          } 
          else {
              const meshPos = mesh.getAbsolutePosition();
              
              // --- BROADPHASE (Cálculo Ultra-Rápido por frame) ---
              // Protege CPU contra multiplicaciones complejas en objetos lejanos
              const dx = Math.abs(refPos.x - meshPos.x);
              const dy = Math.abs(refPos.y - meshPos.y);
              const dz = Math.abs(refPos.z - meshPos.z);

              if (dx > BROADPHASE_DIST || dy > BROADPHASE_DIST || dz > BROADPHASE_DIST) {
                  e.isCulled = true;
                  e.runtimeVisibilityTarget = 0.0001;
              } else {
                  // --- NARROWPHASE EXACTO ---
                  const distSq = dx*dx + dy*dy + dz*dz;

                  if (distSq > CULL_SQ) {
                      e.isCulled = true;
                      e.runtimeVisibilityTarget = 0.0001;
                  } else if (distSq < FADE_SQ) {
                      e.isCulled = false;
                      e.runtimeVisibilityTarget = 1.0;
                  } else {
                      // Fase Intermedia: Aplicamos Easing Smoothstep a la Visibilidad
                      e.isCulled = false;
                      const dist = Math.sqrt(distSq);
                      
                      let t = 1.0 - ((dist - fadeStartDist) / fadeMargin);
                      t = t * t * (3 - 2 * t); // Suaviza la entrada y salida de la curva visual
                      
                      e.runtimeVisibilityTarget = Math.max(0.0001, Math.min(1.0, t));
                  }
              }
          }

          // =========================================================================
          // APLICACIÓN VISUAL Y SEGURIDAD ANTI-POPPING (La magia ocurre aquí)
          // =========================================================================

          // Inicialización forzada o rescate de teleportación
          if (e.currentRuntimeVisibility === undefined || this.frameCounter <= 2 || isTransitioning) {
              e.currentRuntimeVisibility = e.runtimeVisibilityTarget;
          }

          // Ahorro de CPU: Si el objeto está estabilizado y sin cambios, saltamos al siguiente
          if (e.currentRuntimeVisibility === 1.0 && e.runtimeVisibilityTarget === 1.0 && mesh.isEnabled()) {
              continue;
          }
          if (e.currentRuntimeVisibility === 0.0001 && e.runtimeVisibilityTarget === 0.0001 && !mesh.isEnabled()) {
              continue;
          }

          // Interpolación Temporal del estado (persigue al target)
          e.currentRuntimeVisibility += (e.runtimeVisibilityTarget - e.currentRuntimeVisibility) * lerpSpeed;
          
          if (Math.abs(e.currentRuntimeVisibility - e.runtimeVisibilityTarget) < 0.005) {
              e.currentRuntimeVisibility = e.runtimeVisibilityTarget;
          }

          const activeVis = e.currentRuntimeVisibility;

          // Lógica estricta CERO-POPS
          if (activeVis > 0.001) {
              if (!mesh.isEnabled()) {
                  // 🔥 PRE-FADE OBLIGATORIO: Forzamos invisibilidad milimétrica ANTES 
                  // de prender el mesh para que BabylonJS no devuelva un frame glitcheado al 100%
                  mesh.visibility = 0.0001;
                  const children = mesh.getChildMeshes(false);
                  for (let c = 0; c < children.length; c++) {
                      const child = children[c];
                      if (!Tags.MatchesQuery(child, "proxy_collider || debug_element || editor_only")) {
                          child.visibility = 0.0001;
                      }
                  }
                  mesh.setEnabled(true);
              }

              // 🔥 FADE CONTINUO
              mesh.visibility = activeVis;
              const children = mesh.getChildMeshes(false);
              for (let c = 0; c < children.length; c++) {
                  const child = children[c];
                  if (!Tags.MatchesQuery(child, "proxy_collider || debug_element || editor_only")) {
                      child.visibility = activeVis;
                  }
              }
          } else {
              // 🔥 CULLING FINAL SUAVE
              if (mesh.isEnabled()) {
                  mesh.visibility = 0.0001; 
                  const children = mesh.getChildMeshes(false);
                  for (let c = 0; c < children.length; c++) {
                      if (!Tags.MatchesQuery(children[c], "proxy_collider || debug_element || editor_only")) {
                          children[c].visibility = 0.0001;
                      }
                  }
                  mesh.setEnabled(false); // Eliminado de los cálculos de GPU
              }
          }
      }
  }
}