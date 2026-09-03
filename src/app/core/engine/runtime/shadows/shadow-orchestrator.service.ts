
import { Injectable, inject } from '@angular/core';
import { DirectionalLight, Vector3, CascadedShadowGenerator, ShadowGenerator, Scene, AbstractMesh } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';

@Injectable({ providedIn: 'root' })
export class ShadowOrchestratorService implements IUpdatable {
  public id = 'ShadowOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private ownership = inject(CameraOwnershipService);
  private worldSettings = inject(WorldSettingsService);
  private context = inject(GameContextService); 

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

  public update(dtMs: number): void {
     const scene = this.motor3d.getScene();
     if (!scene || !this.mainSun) return;

     const refPos = this.getReferencePosition();
     
     // 🔥 FIX SHADOW SHIMMERING (JITTER DE SOMBRAS):
     // Mover la luz direccional en cada frame causa que las matrices de proyección de sombras 
     // flutúen microscópicamente por los sub-píxeles de punto flotante. 
     // Solo la movemos en saltos de 5 metros para mantener CSM 100% estabilizado internamente.
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
       this.shadowGenerator.usePercentageCloserFiltering = true;
       this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
       
       this.shadowGenerator.bias = 0.002;
       this.shadowGenerator.normalBias = 0.01;

       this.shadowGenerator.shadowMaxZ = 80; 
       
       this.shadowGenerator.setDarkness(0.65);
       this.shadowGenerator.autoCalcDepthBounds = false; 
       this.shadowGenerator.stabilizeCascades = true; 
    }

    const renderList = this.shadowGenerator.getShadowMap()?.renderList;
    if (renderList) {
        renderList.length = 0;
        
        const entities = this.entityManager.getAllEntities();
        for (let i = 0; i < entities.length; i++) {
           const e = entities[i];
           if (e.view && e.view instanceof AbstractMesh) {
               if (e.characterConfig || (e.visual?.isSolid && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                   const processMeshForShadows = (m: AbstractMesh) => {
                       if (m.isVisible && m.isEnabled()) {
                           renderList.push(m);
                           m.receiveShadows = true;
                       }
                   };

                   processMeshForShadows(e.view);
                   e.view.getChildMeshes(false).forEach(processMeshForShadows);
               }
           }
        }
    }
  }
}