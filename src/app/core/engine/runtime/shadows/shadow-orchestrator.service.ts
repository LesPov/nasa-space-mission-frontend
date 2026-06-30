
import { Injectable, inject } from '@angular/core';
import { DirectionalLight, Vector3, CascadedShadowGenerator, ShadowGenerator, Scene, AbstractMesh } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../world/world-settings.service';

@Injectable({ providedIn: 'root' })
export class ShadowOrchestratorService implements IUpdatable {
  public id = 'ShadowOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private ownership = inject(CameraOwnershipService);
  private worldSettings = inject(WorldSettingsService);

  private mainSun: DirectionalLight | null = null;
  private shadowGenerator: CascadedShadowGenerator | null = null;

  public update(dtMs: number): void {
     const scene = this.motor3d.getScene();
     const camera = this.ownership.getCamera();
     if (!scene || !camera || !this.mainSun) return;

     // 🔥 FIX SHADOW LAG: Se adhiere la luz del Sol estrictamente a la cámara en cada frame.
     // No se usan Lerps. Esto elimina los "saltos" en las sombras cuando el jugador camina.
     this.mainSun.position.copyFrom(camera.globalPosition);
     this.mainSun.position.subtractInPlace(this.mainSun.direction.scale(200));
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
       // 🔥 OPTIMIZACIÓN: Las Cascaded Shadows son excelentes, pero el cálculo automático causa tirones.
       this.shadowGenerator = new CascadedShadowGenerator(1024, this.mainSun);
       this.shadowGenerator.usePercentageCloserFiltering = true;
       this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_LOW;
       this.shadowGenerator.shadowMaxZ = 150; 
       this.shadowGenerator.setDarkness(0.5);
       
       // 🔥 FIX TIRONES CÁMARA: Apagado el recálculo asíncrono para mantener 60fps estables.
       this.shadowGenerator.autoCalcDepthBounds = false; 
    }

    const renderList = this.shadowGenerator.getShadowMap()?.renderList;
    if (renderList) {
        renderList.length = 0;
        
        const entities = this.entityManager.getAllEntities();
        for (let i = 0; i < entities.length; i++) {
           const e = entities[i];
           if (e.view && e.view instanceof AbstractMesh) {
               const mesh = e.view;
               // Solo los props sólidos o personajes proyectan sombras. Pisos excluidos para evitar bugs.
               if (e.characterConfig || (e.visual?.isSolid && e.type !== 'plane' && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                   renderList.push(mesh);
                   mesh.getChildMeshes().forEach(m => renderList.push(m));
               }
               // Todos reciben las sombras.
               mesh.receiveShadows = true;
               mesh.getChildMeshes().forEach(m => m.receiveShadows = true);
           }
        }
    }
  }
}