import { Injectable, inject } from '@angular/core';
import { Color4, Mesh, Vector3 } from '@babylonjs/core';

import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { SceneShadowsService } from './scene-shadows.service';
import { SceneNodesService } from './scene-nodes.service';
import { SceneEnvironmentService } from './scene-environment.service';

// 🔥 IMPORTAMOS LOS NUEVOS LOADERS
import { LoaderModelService } from './loaders/loader-model.service';
import { LoaderPrimitiveService } from './loaders/loader-primitive.service';
import { LoaderTriggerService } from './loaders/loader-trigger.service';

@Injectable({ providedIn: 'root' })
export class SceneLoaderService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private envSvc = inject(SceneEnvironmentService);
  private shadowsSvc = inject(SceneShadowsService);
  private nodesSvc = inject(SceneNodesService);

  private loaderModelSvc = inject(LoaderModelService);
  private loaderPrimitiveSvc = inject(LoaderPrimitiveService);
  private loaderTriggerSvc = inject(LoaderTriggerService);

  public cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
    return new Promise((resolve) => {
      if (!dataBD) return resolve();

      const scene = this.motor3d.scene;
      
      // 1. Configurar Entorno Global (Cielo y Físicas)
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
      } else {
        const clearHex = '#0d1729';
        this.envSvc.configurarAmbienteGlobal(scene, { ambientIntensity: 0.6, ambientDiffuse: '#ffffff', ambientGround: '#333333', ambientDirX: 0, ambientDirY: 1, ambientDirZ: 0 });
        scene.clearColor = Color4.FromHexString(clearHex + 'ff');
        scene.metadata = { ...scene.metadata, globalClearColor: clearHex, globalClearColorBW: '#555555', globalVisualMode: 'normal' };
        this.motor3d.setVisualMode('normal');
      }

      scene.cameras.forEach(cam => cam.maxZ = 10000);

      const objetosBD = Array.isArray(dataBD) ? dataBD : (dataBD.sceneObjects || []);
      const triggersBD = Array.isArray(dataBD) ? [] : (dataBD.triggers || []);

      const promesasCarga: any[] = [];
      const mallasCreadas = new Map<string, Mesh>();

      // 2. Cargar Objetos 3D
      objetosBD.forEach((obj: any) => {
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');

        if ((isLight && obj.assetId) || isModel) {
          // Modelos GLB que requieren carga asíncrona
          promesasCarga.push(this.loaderModelSvc.cargarModeloAsync(obj, mallasCreadas));
        } else {
          // Primitivas, Luces Simples y Hologramas sincrónicos
          this.loaderPrimitiveSvc.cargarPrimitiva(obj, mallasCreadas);
        }
      });

      // 3. Cargar Triggers
      triggersBD.forEach((trigger: any) => {
        this.loaderTriggerSvc.cargarTrigger(trigger, mallasCreadas);
      });

      // 4. Finalizar Ensamblaje cuando los modelos asíncronos descarguen
      Promise.all(promesasCarga).then(() => {
        mallasCreadas.forEach((mesh) => {
          if (mesh.metadata?.parentId) {
            const parentNode = mallasCreadas.get(mesh.metadata.parentId) || scene.getMeshByName(mesh.metadata.parentId);
            if (parentNode) mesh.parent = parentNode;
          }
        });

        // Forzamos actualización de los Decals (Hologramas) para que se peguen bien a las paredes recién cargadas
        setTimeout(() => {
          mallasCreadas.forEach((mesh) => {
            if (mesh.metadata?.type === 'image_plane' && mesh.metadata.updateDecal) {
              mesh.metadata.updateDecal();
            }
          });
        }, 150);

        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        this.nodesSvc.actualizarListaNodos();
        resolve();
      });
    });
  }
}