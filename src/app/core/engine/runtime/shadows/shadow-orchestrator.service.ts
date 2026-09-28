
import { Injectable, inject } from '@angular/core';
import { DirectionalLight, Vector3, CascadedShadowGenerator, ShadowGenerator, AbstractMesh } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { ShadowLODManager } from './shadow-lod-manager.service';
import { ShadowLOD, ShadowProfile } from './shadow.model';

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
       this.shadowGenerator.shadowMaxZ = 26; 
       this.shadowGenerator.setDarkness(0.3);
       this.shadowGenerator.autoCalcDepthBounds = false; 
       this.shadowGenerator.stabilizeCascades = true; 
    }

    const renderList = this.shadowGenerator.getShadowMap()?.renderList;
    if (renderList) {
        renderList.length = 0;
        
        const entities = this.entityManager.getAllEntities();
        const refPos = this.getReferencePosition();

        const profile: ShadowProfile = {
            maxShadowDistance: 26,
            lod1Distance: 30, 
            lod2Distance: 50,
            lod3Distance: 100,
            updateIntervalMs: 1000
        };

        for (let i = 0; i < entities.length; i++) {
           const e = entities[i];
           if (e.view && e.view instanceof AbstractMesh) {
               if (e.characterConfig || (e.visual?.isSolid && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                   
                   const lodValue = Number(this.shadowLOD.calculateLOD(e.view.getAbsolutePosition(), refPos, profile));
                   
                   // 🔥 FIX CRÍTICO SHADOW RECOMPILATION: 
                   // Independientemente de la distancia (LOD), NUNCA modificamos e.view.receiveShadows.
                   // Las mallas siempre están preparadas para recibir sombras, pero su inclusión
                   // en la RenderList (para PROYECTAR sombras) sí se filtra por distancia.
                   if (lodValue === 0) {
                       const processMeshForShadows = (m: AbstractMesh) => {
                           if (m.isVisible && m.isEnabled()) {
                               renderList.push(m);
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
}