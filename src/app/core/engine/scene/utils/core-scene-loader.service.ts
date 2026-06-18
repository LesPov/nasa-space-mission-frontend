
import { Injectable, inject } from '@angular/core';
import { Color4, Mesh, Vector3, HemisphericLight, Color3, Scene, MeshBuilder } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { CoreSceneShadowsService } from './core-scene-shadows.service';
import { CoreSceneUtilsService } from './core-scene-utils.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { CoreModelLoaderService } from './core-model-loader.service';
import { CorePrimitiveLoaderService } from './core-primitive-loader.service';
import { CoreTriggerLoaderService } from './core-trigger-loader.service';

@Injectable({ providedIn: 'root' })
export class CoreSceneLoaderService {
  private motor3d = inject(Motor3dService);
  private shadowsSvc = inject(CoreSceneShadowsService);
  private utilsSvc = inject(CoreSceneUtilsService);
  private entityManager = inject(EntityManagerService);
  private loaderModelSvc = inject(CoreModelLoaderService);
  private loaderPrimitiveSvc = inject(CorePrimitiveLoaderService);
  private loaderTriggerSvc = inject(CoreTriggerLoaderService);

  public createInvisibleFloor(scene: Scene): void {
    const suelo = MeshBuilder.CreateBox('sueloInvisible', { width: 200, depth: 200, height: 1 }, scene);
    suelo.position.y = -0.5;
    suelo.checkCollisions = true;
    suelo.isVisible = false;
    suelo.isPickable = true;
    suelo.receiveShadows = true;
  }

  public setupGlobalEnvironment(w: any, scene: Scene): void {
    let ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;
    if (!ambient) {
      ambient = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
    }
    ambient.direction = new Vector3(w.ambientDirX ?? 0, w.ambientDirY ?? 1, w.ambientDirZ ?? 0);
    ambient.intensity = w.ambientIntensity ?? 0.6;
    ambient.diffuse = Color3.FromHexString(w.ambientDiffuse || '#ffffff');
    ambient.groundColor = Color3.FromHexString(w.ambientGround || '#333333');
    ambient.specular = new Color3(0, 0, 0);

    if (!scene.environmentTexture) {
      scene.createDefaultEnvironment({ createSkybox: false, createGround: false, enableGroundShadow: false, setupImageProcessing: false });
    }

    const oldGlobal = scene.lights.find(l => l.name === 'globalLight');
    if (oldGlobal) oldGlobal.dispose();
    const oldSun = scene.lights.find(l => l.name === 'sunLight');
    if (oldSun) oldSun.dispose();
  }

  public async loadSceneFromData(dataBD: any, isAdmin: boolean): Promise<void> {
    if (!dataBD) return;

    const scene = this.motor3d.scene;
    let w: any = dataBD.worldSettings;
    if (typeof w === 'string') { try { w = JSON.parse(w); } catch (e) {} }

    if (w) {
      const clearHex = w.clearColor?.length >= 7 ? w.clearColor.substring(0, 7) : '#0d1729';
      const clearHexBW = w.clearColorBW?.length >= 7 ? w.clearColorBW.substring(0, 7) : '#555555';

      this.setupGlobalEnvironment(w, scene);
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

    await Promise.all(promesasCarga);

    mallasCreadas.forEach((mesh, uid) => {
      const entity = this.entityManager.getEntityByUid(uid);
      if (entity && entity.parentId) {
        const parentNode = mallasCreadas.get(entity.parentId) || scene.getMeshByName(entity.parentId);
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
  }

  public async instantiatePrefab(prefabData: any, positionTarget: Vector3, isAdmin: boolean): Promise<Map<string, Mesh>> {
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
      await this.loaderModelSvc.cargarModeloAsync(mockDbObject, mallasCreadas);
    } else {
      this.loaderPrimitiveSvc.cargarPrimitiva(mockDbObject, mallasCreadas, isAdmin);
    }
    
    this.shadowsSvc.asignarObjetosASombrasDeLuces();
    return mallasCreadas;
  }
}