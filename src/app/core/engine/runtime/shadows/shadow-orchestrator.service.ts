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

  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      return camera ? camera.globalPosition : Vector3.Zero();
  }

  private isEligibleShadowCaster(e: GameEntity): boolean {
      if (!e.view || !e.view.isVisible || !e.view.isEnabled()) return false;

      if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') {
          return false;
      }

      if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) {
          return false;
      }

      if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') {
          return true;
      }

      const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
      if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
          return true;
      }

      return false;
  }

  public start(): void {
      // 🔥 FIX DE RENDIMIENTO CRÍTICO: La lista de sombras solares se compila
      // de forma global exclusivamente al arrancar o al hacer Spawn de un nuevo objeto.
      // Delegamos el Culling nativo de sombras al Frustum del CascadedShadowGenerator de BabylonJS.
      this.asignarObjetosASombrasDeLuces();
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

     // La única responsabilidad por Frame de la orquestación solar es acompañar al player/cámara
     const refPos = this.getReferencePosition();
     if (Vector3.DistanceSquared(this.mainSun.position, refPos) > 25) {
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

        for (let i = 0; i < entities.length; i++) {
           const e = entities[i];
           if (this.isEligibleShadowCaster(e) && e.view) {
               const processMeshForShadows = (m: AbstractMesh) => {
                   if (!Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) {
                       if (m instanceof Mesh && m.getTotalVertices() > 0) {
                           renderList.push(m);
                       }
                       m.receiveShadows = true;
                   }
               };

               processMeshForShadows(e.view);
               e.view.getChildMeshes(false).forEach(processMeshForShadows);
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