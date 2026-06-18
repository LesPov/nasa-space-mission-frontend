
import { Injectable, inject } from '@angular/core';
import { CascadedShadowGenerator, DirectionalLight, ShadowGenerator, SpotLight } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class CoreSceneShadowsService {
  private motor3d = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);

  public asignarObjetosASombrasDeLuces(): void {
    const scene = this.motor3d.scene;
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

          const ignoredNames = ['ejeX', 'ejeY', 'ejeZ', 'gridHelper', 'sueloInvisible'];
          const entity = this.entityManager.getEntityByMesh(m);
          const type = entity?.type;

          const isValidShadowCaster = m.isVisible &&
            !ignoredNames.includes(m.name) &&
            !m.name.includes('proxyCol') &&
            !m.name.includes('gizmo') &&
            !m.name.includes('highlight') &&
            !m.name.startsWith('decal_') &&
            m.name !== 'centerDragPos' &&
            m.name !== 'debugCollider' &&
            m.name !== 'debugCamBox' &&
            m.name !== 'debugFogSphere' &&
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