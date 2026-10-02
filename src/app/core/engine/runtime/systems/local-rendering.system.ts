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

// 🔥 FIX B: Caché de Volumen. Almacenamos el centro y radio real, ignorando dónde está el pivote.
interface VolumeCache {
    center: Vector3;
    radius: number;
}

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';
  
  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  private frameCounter = 0;
  private distanceCheckTimer = 0;
  private meshCache = new Map<string, AbstractMesh[]>();
  private volumeCache = new Map<string, VolumeCache>();
  
  private static _fallbackPos = Vector3.Zero();

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
      
      // Si el objeto fue alterado o no tiene caché, se calcula el volumen real
      if (!vol || entity.isDirty) {
          // getHierarchyBoundingVectors calcula min y max iterando todos los hijos reales.
          // Le pasamos `false` para que incluya hijos que están actualmente invisibles por culling.
          const bounds = rootMesh.getHierarchyBoundingVectors(false, (m) => {
              // Excluir esferas de luz, cajas verdes de físicas y gizmos del tamaño
              return !Tags.MatchesQuery(m, "system_element || editor_only || proxy_collider || light_visual");
          });
          
          const center = bounds.min.add(bounds.max).scale(0.5);
          const radius = bounds.max.subtract(center).length(); // Radio envolvente perfecto
          
          vol = { center, radius };
          this.volumeCache.set(entity.uid, vol);
      }
      return vol;
  }

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
              
              const meshesToRestore = this.meshCache.has(e.uid) 
                  ? this.meshCache.get(e.uid)! 
                  : [mesh, ...mesh.getChildMeshes(false)];
                  
              for (let m = 0; m < meshesToRestore.length; m++) {
                  const c = meshesToRestore[m];
                  if (!Tags.MatchesQuery(c, "proxy_collider || debug_element || editor_only || light_visual")) {
                      c.visibility = 1.0;
                  }
              }
          }
      }
      this.meshCache.clear();
      this.volumeCache.clear();
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
      const entities = this.entityManager.getAllEntities();
      const playerEntity = this.context.activePlayerEntity();

      const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 150, fadeMargin: 30 };
      const isCullingEnabled = cullingConfig.enabled;
      
      const cullDist = Math.max(10, cullingConfig.cullDistance);
      const fadeMargin = Math.min(cullDist - 1, Math.max(0, cullingConfig.fadeMargin));
      const fadeStartDist = cullDist - fadeMargin;

      const CULL_SQ = cullDist * cullDist;
      const FADE_SQ = fadeStartDist * fadeStartDist;
      const BROADPHASE_DIST = cullDist + 100; // Extendemos la broadphase por culpa de los radios gigantes posibles

      const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.15);

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          const mesh = e.view as AbstractMesh;
          if (!mesh || mesh.isDisposed()) continue;

          if (e.isPersistent || e.characterConfig || e.rol === 'spawn_point') continue;
          if (e.type === 'trigger' || e.type === 'trigger_compuesto' || e.type.startsWith('light_')) continue;
          if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') continue; 
          
          if (e.visual?.disableCulling) {
              if (e.isCulled || e.runtimeVisibilityTarget !== 1.0) {
                   e.isCulled = false;
                   e.runtimeVisibilityTarget = 1.0;
              }
          } else if (isEditor || !isCullingEnabled || isTransitioning) {
              e.isCulled = false;
              e.runtimeVisibilityTarget = 1.0;
          } else if (shouldCheckDistance) {
              // 🔥 FIX B: Obtención del Bounding Sphere real
              const volume = this.getVolume(e, mesh);
              
              // Broadphase usando el centro real
              const dx = Math.abs(refPos.x - volume.center.x);
              const dy = Math.abs(refPos.y - volume.center.y);
              const dz = Math.abs(refPos.z - volume.center.z);

              // Si el centro + el radio del objeto está más allá de la broadphase, ocultar
              if (dx - volume.radius > BROADPHASE_DIST || dy - volume.radius > BROADPHASE_DIST || dz - volume.radius > BROADPHASE_DIST) {
                  e.isCulled = true;
                  e.runtimeVisibilityTarget = 0.0001;
              } else {
                  // Narrowphase: Distancia a la superficie de la Bounding Sphere
                  const distToCenter = Math.sqrt(dx*dx + dy*dy + dz*dz);
                  const effectiveDist = Math.max(0, distToCenter - volume.radius);
                  const distSq = effectiveDist * effectiveDist;

                  if (distSq > CULL_SQ) {
                      e.isCulled = true;
                      e.runtimeVisibilityTarget = 0.0001;
                  } else if (distSq < FADE_SQ) {
                      e.isCulled = false;
                      e.runtimeVisibilityTarget = 1.0;
                  } else {
                      e.isCulled = false;
                      let t = 1.0 - ((effectiveDist - fadeStartDist) / fadeMargin);
                      t = t * t * (3 - 2 * t); 
                      e.runtimeVisibilityTarget = Math.max(0.0001, Math.min(1.0, t));
                  }
              }
          }

          if (e.currentRuntimeVisibility === undefined || this.frameCounter <= 2 || isTransitioning) {
              e.currentRuntimeVisibility = e.runtimeVisibilityTarget;
          }

          if (Math.abs(e.currentRuntimeVisibility - e.runtimeVisibilityTarget) < 0.005 && e.currentRuntimeVisibility === e.runtimeVisibilityTarget) {
              if (e.runtimeVisibilityTarget === 1.0 && !mesh.isEnabled()) {
                  mesh.setEnabled(true);
              }
              continue; 
          }

          e.currentRuntimeVisibility += (e.runtimeVisibilityTarget - e.currentRuntimeVisibility) * lerpSpeed;
          
          if (Math.abs(e.currentRuntimeVisibility - e.runtimeVisibilityTarget) < 0.005) {
              e.currentRuntimeVisibility = e.runtimeVisibilityTarget;
          }

          const activeVis = e.currentRuntimeVisibility;
          const cachedMeshes = this.getCachedMeshes(e, mesh);

          if (activeVis > 0.001) {
              if (!mesh.isEnabled()) {
                  for (let c = 0; c < cachedMeshes.length; c++) {
                      cachedMeshes[c].visibility = 0.0001;
                  }
                  mesh.setEnabled(true);
              }

              for (let c = 0; c < cachedMeshes.length; c++) {
                  cachedMeshes[c].visibility = activeVis;
              }
          } else {
              if (mesh.isEnabled()) {
                  for (let c = 0; c < cachedMeshes.length; c++) {
                      cachedMeshes[c].visibility = 0.0001;
                  }
                  mesh.setEnabled(false); 
              }
          }
      }
  }
}