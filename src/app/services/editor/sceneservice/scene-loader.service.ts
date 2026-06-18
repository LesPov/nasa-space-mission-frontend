
import { Injectable, inject } from '@angular/core';
import { Color4, Mesh, Vector3 } from '@babylonjs/core';

import { Motor3dService } from '../../motor-3d.service';
import { SceneShadowsService } from './scene-shadows.service';
import { SceneEnvironmentService } from './scene-environment.service';
import { SceneUtilsService } from './scene-utils.service';

import { LoaderModelService } from './loaders/loader-model.service';
import { LoaderPrimitiveService } from './loaders/loader-primitive.service';
import { LoaderTriggerService } from './loaders/loader-trigger.service';

@Injectable({ providedIn: 'root' })
export class SceneLoaderService {
  private motor3d = inject(Motor3dService);
  private envSvc = inject(SceneEnvironmentService);
  private shadowsSvc = inject(SceneShadowsService);
  private utilsSvc = inject(SceneUtilsService);

  private loaderModelSvc = inject(LoaderModelService);
  private loaderPrimitiveSvc = inject(LoaderPrimitiveService);
  private loaderTriggerSvc = inject(LoaderTriggerService);

  public cargarEscenaDesdeDatos(dataBD: any, isAdmin: boolean): Promise<void> {
    return new Promise((resolve) => {
      if (!dataBD) return resolve();

      const scene = this.motor3d.scene;
      
      let w: any = dataBD.worldSettings;
      if (typeof w === 'string') {
        try { w = JSON.parse(w); } catch (e) {}
      }

      if (w) {
        const clearHex = w.clearColor?.length >= 7 ? w.clearColor.substring(0, 7) : '#0d1729';
        const clearHexBW = w.clearColorBW?.length >= 7 ? w.clearColorBW.substring(0, 7) : '#555555';

        this.envSvc.configurarAmbienteGlobal(scene, w);
        const loadedMode = w.visualMode === 'bw' ? 'bw' : 'normal';
        const activeClear = loadedMode === 'bw' ? clearHexBW : clearHex;
        
        scene.clearColor = Color4.FromHexString(activeClear + 'ff');
        scene.metadata = { ...scene.metadata, globalClearColor: clearHex, globalClearColorBW: clearHexBW, globalVisualMode: loadedMode };
        this.motor3d.setVisualMode(loadedMode);
        scene.gravity = new Vector3(0, w.gravityY ?? -0.25, 0);
      }

      scene.cameras.forEach(cam => cam.maxZ = 10000);

      const objetosBD = Array.isArray(dataBD) ? dataBD : (dataBD.sceneObjects || []);
      const triggersBD = Array.isArray(dataBD) ? [] : (dataBD.triggers || []);

      const promesasCarga: any[] = [];
      const mallasCreadas = new Map<string, Mesh>();

      objetosBD.forEach((obj: any) => {
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');

        if (isModel || (isLight && obj.assetId)) {
          promesasCarga.push(this.loaderModelSvc.cargarModeloAsync(obj, mallasCreadas));
        } else {
          this.loaderPrimitiveSvc.cargarPrimitiva(obj, mallasCreadas, isAdmin);
        }
      });

      triggersBD.forEach((trigger: any) => {
        this.loaderTriggerSvc.cargarTrigger(trigger, mallasCreadas, isAdmin);
      });

      Promise.all(promesasCarga).then(() => {
        mallasCreadas.forEach((mesh) => {
          if (mesh.metadata?.parentId) {
            const parentNode = mallasCreadas.get(mesh.metadata.parentId) || scene.getMeshByName(mesh.metadata.parentId);
            if (parentNode) mesh.parent = parentNode;
          }
        });

        setTimeout(() => {
          mallasCreadas.forEach((mesh) => {
            if (mesh.metadata?.type === 'image_plane' && mesh.metadata.updateDecal) {
              mesh.metadata.updateDecal();
            }
          });
        }, 150);

        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        resolve();
      });
    });
  }

  public instanciarObjetoDesdePrefab(prefabData: any, positionTarget: Vector3, isAdmin: boolean): Promise<Map<string, Mesh>> {
    return new Promise((resolve) => {
      const mallasCreadas = new Map<string, Mesh>();
      const propertiesClone = JSON.parse(JSON.stringify(prefabData.properties || {}));
      this.utilsSvc.renovarIdsDeSecuencias(propertiesClone);

      const mockDbObject = {
        uid: window.crypto.randomUUID(), 
        type: prefabData.type,
        name: prefabData.name + '_' + Math.floor(Math.random() * 1000),
        position: { x: positionTarget.x, y: positionTarget.y, z: positionTarget.z },
        rotation: propertiesClone.rotation || { x: 0, y: 0, z: 0 },
        scale: propertiesClone.scale || { x: 1, y: 1, z: 1 },
        properties: propertiesClone,
        assetId: prefabData.assetId,
        asset: { path: propertiesClone.path }
      };

      const isModel = mockDbObject.type === 'model';
      const isLight = mockDbObject.type?.startsWith('light_');

      if (isModel || (isLight && mockDbObject.assetId)) {
        this.loaderModelSvc.cargarModeloAsync(mockDbObject, mallasCreadas).then(() => {
          this.shadowsSvc.asignarObjetosASombrasDeLuces();
          resolve(mallasCreadas);
        });
      } else {
        this.loaderPrimitiveSvc.cargarPrimitiva(mockDbObject, mallasCreadas, isAdmin);
        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        resolve(mallasCreadas);
      }
    });
  }
}