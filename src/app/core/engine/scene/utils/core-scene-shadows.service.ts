
import { Injectable, inject } from '@angular/core';
import { CascadedShadowGenerator, DirectionalLight, ShadowGenerator, SpotLight, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class CoreSceneShadowsService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);

  public asignarObjetosASombrasDeLuces(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    const lights = scene.lights.filter(l => l instanceof DirectionalLight || l instanceof SpotLight);

    lights.forEach(light => {
      let sg: any = light.getShadowGenerator();
      if (!sg) {
        if (light instanceof DirectionalLight) {
          // SOMBRAS ALTA CALIDAD: PCF High para el sol
          const csg = new CascadedShadowGenerator(2048, light);
          csg.usePercentageCloserFiltering = true;
          csg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
          csg.setDarkness(0.4);
          csg.autoCalcDepthBounds = true; 
          sg = csg;
        } else {
          // SOMBRAS ALTA CALIDAD MINOR: PCF Medium en vez de Poisson para eliminar el pixelado
          const regularSg = new ShadowGenerator(1024, light as SpotLight);
          regularSg.usePercentageCloserFiltering = true;
          regularSg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
          regularSg.setDarkness(0.4);
          sg = regularSg;
        }
      }

      const renderList = sg.getShadowMap()?.renderList;
      if (renderList) {
        renderList.length = 0;
        scene.meshes.forEach(m => {

          const entity = this.entityManager.getEntityByMesh(m);
          const type = entity?.type;

          const isValidShadowCaster = m.isVisible &&
            !Tags.MatchesQuery(m, "system_element || fog_element || debug_element || editor_only || proxy_collider || decal") &&
            type !== 'trigger' &&
            type !== 'bubble' &&
            type !== 'video_plane' &&
            !type?.startsWith('light_');

          // CULLING ESTRICTO: Protege los FPS al obviar props pequeños
          let isLargeEnough = true;
          if (isValidShadowCaster) {
            try {
               m.computeWorldMatrix(true);
               if (m.getBoundingInfo().diagonalLength < 0.5) {
                 isLargeEnough = false;
               }
            } catch (e) {}
          }

          if (isValidShadowCaster && isLargeEnough) {
            sg.addShadowCaster(m, false);
            m.receiveShadows = true;
          }
        });
      }
    });
  }
}
