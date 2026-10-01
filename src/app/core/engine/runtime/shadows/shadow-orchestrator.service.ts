
import { Injectable, inject } from '@angular/core';
import { DirectionalLight, Vector3, CascadedShadowGenerator, ShadowGenerator, AbstractMesh, Mesh, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { ShadowLODManager } from './shadow-lod-manager.service';
import { ShadowLOD, ShadowProfile } from './shadow.model';
import { GameEntity } from '../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ShadowOrchestratorService implements IUpdatable {
  public id = 'ShadowOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private ownership = inject(CameraOwnershipService);
  private worldSettings = inject(WorldSettingsService);
  private context = inject(GameContextService); 
  private shadowLOD = inject(ShadowLODManager);

  private mainSun: DirectionalLight | null = null;
  private shadowGenerator: CascadedShadowGenerator | null = null;
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
   * Determina si la entidad debe proyectar sombras bajo la luz solar direccional.
   * La oclusión óptica de postes, arquitectura y túneles no depende de 'isSolid'.
   */
  private isEligibleShadowCaster(e: GameEntity): boolean {
      if (!e.view || !e.view.isVisible || !e.view.isEnabled()) return false;

      // Descartar triggers, imágenes proyectadas, burbujas y elementos no oclusores
      if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') {
          return false;
      }

      // Si es una fuente de luz abstracta sin geometría física asociada, no proyecta sombra
      if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) {
          return false;
      }

      // Personajes, jugador y NPCs
      if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') {
          return true;
      }

      // Geometría real: modelos GLB (postes, arquitectura, edificios) y primitivas
      const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
      if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
          return true;
      }

      return false;
  }

  public start(): void {
      this.frameCounter = 0;
  }

  public stop(): void {
      if (this.mainSun) {
          this.mainSun.dispose();
          this.mainSun = null;
      }
      if (this.shadowGenerator) {
          this.shadowGenerator.dispose();
          this.shadowGenerator = null;
      }
  }

  public update(dtMs: number): void {
     const scene = this.motor3d.getScene();
     if (!scene || !this.mainSun) return;

     this.frameCounter++;
     if (this.frameCounter === 1 || this.frameCounter % 60 === 0) {
         this.asignarObjetosASombrasDeLuces();
     }

     const refPos = this.getReferencePosition();
     
     if (this.frameCounter === 1 || Vector3.DistanceSquared(this.mainSun.position, refPos) > 25) {
         this.mainSun.position.copyFrom(refPos);
         this.mainSun.position.subtractInPlace(this.mainSun.direction.scale(100));
     }
  }

  public asignarObjetosASombrasDeLuces(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (!this.mainSun) {
       const w = this.worldSettings.settings();
       this.mainSun = new DirectionalLight('sunLight', new Vector3(w.ambientDirX, w.ambientDirY, w.ambientDirZ).normalize(), scene);
       this.mainSun.intensity = 0.8;
       this.mainSun.position = new Vector3(0, 100, 0);
    } else {
       const w = this.worldSettings.settings();
       this.mainSun.direction.copyFromFloats(w.ambientDirX, w.ambientDirY, w.ambientDirZ).normalize();
    }

    if (!this.shadowGenerator) {
       const isEditor = this.context.mode() === 'EDITOR';
       const shadowRes = isEditor ? 1024 : 2048; 

       this.shadowGenerator = new CascadedShadowGenerator(shadowRes, this.mainSun);
       
       this.shadowGenerator.cascadeBlendPercentage = 0.1; 
       this.shadowGenerator.lambda = 0.65; 
       this.shadowGenerator.usePercentageCloserFiltering = true;
       this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
       this.shadowGenerator.bias = 0.0012;
       this.shadowGenerator.normalBias = 0.012;
       this.shadowGenerator.shadowMaxZ = 35; 
       this.shadowGenerator.setDarkness(0.35);
       this.shadowGenerator.autoCalcDepthBounds = false; 
       this.shadowGenerator.stabilizeCascades = true; 
    }

    const renderList = this.shadowGenerator.getShadowMap()?.renderList;
    if (renderList) {
        renderList.length = 0;
        
        const entities = this.entityManager.getAllEntities();
        const refPos = this.getReferencePosition();

        const profile: ShadowProfile = {
            maxShadowDistance: 35,
            lod1Distance: 30, 
            lod2Distance: 50,
            lod3Distance: 100,
            updateIntervalMs: 1000
        };
        
        const maxDistSq = (profile.maxShadowDistance + 20) * (profile.maxShadowDistance + 20);

        for (let i = 0; i < entities.length; i++) {
           const e = entities[i];
           if (this.isEligibleShadowCaster(e) && e.view) {
               const distSq = Vector3.DistanceSquared(e.view.getAbsolutePosition(), refPos);
               if (distSq > maxDistSq) continue; // 🔥 Frustum/LOD rápido para Sun Shadows
               
               const lodValue = Number(this.shadowLOD.calculateLOD(e.view.getAbsolutePosition(), refPos, profile));
               
               if (lodValue === 0) {
                   const processMeshForShadows = (m: AbstractMesh) => {
                       if (m.isVisible && m.isEnabled() && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) {
                           if (m instanceof Mesh && m.getTotalVertices() > 0) {
                               renderList.push(m);
                           }
                           m.receiveShadows = true;
                       }
                   };

                   processMeshForShadows(e.view);
                   e.view.getChildMeshes(false).forEach(processMeshForShadows);
               } 
           } else if (e.view) {
               if (!Tags.MatchesQuery(e.view, "light_visual || debug_element || proxy_collider")) {
                   e.view.receiveShadows = true;
                   e.view.getChildMeshes(false).forEach(cm => {
                       if (!Tags.MatchesQuery(cm, "light_visual || debug_element || proxy_collider")) {
                           cm.receiveShadows = true;
                       }
                   });
               }
           }
        }
    }
  }
}