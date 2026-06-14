import { Injectable, inject } from '@angular/core';
import { Color4, Mesh, Vector3 } from '@babylonjs/core';

import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { SceneShadowsService } from './scene-shadows.service';
import { SceneNodesService } from './scene-nodes.service';
import { SceneEnvironmentService } from './scene-environment.service';
import { SceneUtilsService } from './scene-utils.service';

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
  private utilsSvc = inject(SceneUtilsService);

  private loaderModelSvc = inject(LoaderModelService);
  private loaderPrimitiveSvc = inject(LoaderPrimitiveService);
  private loaderTriggerSvc = inject(LoaderTriggerService);

  public cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
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

      objetosBD.forEach((obj: any) => {
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');
        // 🔥 FIX ANTICRASHEOS: Verificamos si realmente existe la ruta del asset antes de intentar cargarlo
        const hasPath = !!(obj.properties?.path || obj.asset?.path);

        if ((isLight && obj.assetId && hasPath) || (isModel && hasPath)) {
          promesasCarga.push(this.loaderModelSvc.cargarModeloAsync(obj, mallasCreadas));
        } else {
          this.loaderPrimitiveSvc.cargarPrimitiva(obj, mallasCreadas);
        }
      });

      triggersBD.forEach((trigger: any) => {
        this.loaderTriggerSvc.cargarTrigger(trigger, mallasCreadas);
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
        this.nodesSvc.actualizarListaNodos();
        resolve();
      });
    });
  }

  // 🔥 LÓGICA VITAL: Instanciar el prefab rescatando toda la estructura
  public instanciarObjetoDesdePrefab(prefabData: any, positionTarget: Vector3): Promise<void> {
    return new Promise((resolve) => {
      const mallasCreadas = new Map<string, Mesh>();
      
      const propertiesClone = JSON.parse(JSON.stringify(prefabData.properties || {}));
      
      // Renovamos IDs de secuencias para que el clon sea independiente
      this.utilsSvc.renovarIdsDeSecuencias(propertiesClone);

      // Simulamos que el Prefab viene de la Base de Datos
      const mockDbObject = {
        uid: window.crypto.randomUUID(), 
        type: prefabData.type,
        name: prefabData.name + '_' + Math.floor(Math.random() * 1000),
        position: { x: positionTarget.x, y: positionTarget.y, z: positionTarget.z },
        
        // 🔥 RESCATAMOS LA ROTACIÓN Y ESCALA ORIGINAL DEL PREFAB DESDE LAS PROPIEDADES
        rotation: propertiesClone.rotation || { x: 0, y: 0, z: 0 },
        scale: propertiesClone.scale || { x: 1, y: 1, z: 1 },
        
        properties: propertiesClone,
        assetId: prefabData.assetId,
        asset: { path: propertiesClone.path }
      };

      const isModel = mockDbObject.type === 'model';
      const isLight = mockDbObject.type?.startsWith('light_');
      
      // 🔥 CRÍTICO: Prevenimos el error "undefined" comprobando la ruta de forma segura
      const hasPath = !!(mockDbObject.properties?.path || mockDbObject.asset?.path);

      if ((isLight && mockDbObject.assetId && hasPath) || (isModel && hasPath)) {
        this.loaderModelSvc.cargarModeloAsync(mockDbObject, mallasCreadas).then(() => {
          this.finalizarPrefab(mallasCreadas);
          resolve();
        });
      } else {
        this.loaderPrimitiveSvc.cargarPrimitiva(mockDbObject, mallasCreadas);
        this.finalizarPrefab(mallasCreadas);
        resolve();
      }
    });
  }

  private finalizarPrefab(mallasCreadas: Map<string, Mesh>) {
    this.shadowsSvc.asignarObjetosASombrasDeLuces();
    this.nodesSvc.actualizarListaNodos();
    
    // Seleccionar automáticamente el prefab recién clonado para que el usuario pueda moverlo de inmediato
    const iter = mallasCreadas.values().next();
    if (!iter.done) {
       this.state.objetoSeleccionado.set(iter.value);
       this.state.triggerUpdate();
    }
  }
}