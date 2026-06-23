import { Injectable, inject } from '@angular/core';
import { Mesh, Vector3, MeshBuilder, Tags, Quaternion } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { CoreSceneShadowsService } from './core-scene-shadows.service';
import { CoreSceneUtilsService } from './core-scene-utils.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { CoreModelLoaderService } from './core-model-loader.service';
import { CorePrimitiveLoaderService } from './core-primitive-loader.service';
import { CoreTriggerLoaderService } from './core-trigger-loader.service';
import { CoreSceneProjectionService } from './core-scene-projection.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { SpawnManagerService } from '../../runtime/systems/spawn-manager.service';
import { EditorCinematicService } from '../../../../services/editor/editor-cinematic.service';

@Injectable({ providedIn: 'root' })
export class CoreSceneLoaderService {
  private motor3d = inject(Motor3dService);
  private shadowsSvc = inject(CoreSceneShadowsService);
  private utilsSvc = inject(CoreSceneUtilsService);
  private entityManager = inject(EntityManagerService);
  private loaderModelSvc = inject(CoreModelLoaderService);
  private loaderPrimitiveSvc = inject(CorePrimitiveLoaderService);
  private loaderTriggerSvc = inject(CoreTriggerLoaderService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private gameContext = inject(GameContextService);
  private spawnManager = inject(SpawnManagerService);
  private cinematicSvc = inject(EditorCinematicService); // 🔥 AÑADIDO

  public createInvisibleFloor(scene: any): void {
    const old = scene.getMeshByName('sueloInvisible');
    if (old) old.dispose();

    const suelo = MeshBuilder.CreateBox('sueloInvisible', { width: 200, depth: 200, height: 1 }, scene);
    suelo.position.y = -0.5;
    suelo.checkCollisions = true;
    suelo.isVisible = false;
    suelo.isPickable = true;
    suelo.receiveShadows = true;
    Tags.AddTagsTo(suelo, "system_element invisible_floor ignore_raycast");
  }

  public async loadSceneFromData(dataBD: any): Promise<void> {
    if (!dataBD) return;

    const scene = this.motor3d.scene;
    const isPlaying = this.gameContext.isPlaying();
    
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);

    let envSettings: any = dataBD.scene?.environmentSettings || dataBD.environmentSettings || {};
    if (typeof envSettings === 'string') { try { envSettings = JSON.parse(envSettings); } catch (e) {} }

    let uiSettingsRaw = dataBD.uiSettings || {};
    let uiSettings = {};
    if (typeof uiSettingsRaw === 'string') { 
        try { uiSettings = JSON.parse(uiSettingsRaw); } catch (e) { uiSettings = {}; } 
    } else {
        uiSettings = uiSettingsRaw;
    }

    this.worldSettingsSvc.loadFromDb(envSettings, uiSettings);
    this.worldSettingsSvc.applyToScene(scene, (m) => this.motor3d.setVisualMode(m));

    // 🔥 FIX: Cargamos las cinemáticas en su propio servicio de estado
    this.cinematicSvc.loadFromData(dataBD.cinematics || []);

    scene.cameras.forEach(cam => cam.maxZ = 10000);

    const objetosBD = dataBD.sceneObjects || dataBD.sceneObjectsDelta || [];
    const triggersBD = dataBD.triggers || dataBD.triggersDelta || [];

    const promesasCarga: any[] = [];
    const mallasCreadas = new Map<string, Mesh>();

    objetosBD.forEach((obj: any) => {
      const isModel = obj.type === 'model';
      const isLight = obj.type?.startsWith('light_');
      const objRol = obj.properties?.rol || obj.rol || 'prop';

      if (isPlaying && persistentPlayer && objRol === 'player') {
          return;
      }

      if (isModel || (isLight && obj.assetId)) {
        promesasCarga.push(this.loaderModelSvc.cargarModeloAsync(obj, mallasCreadas));
      } else {
        this.loaderPrimitiveSvc.cargarPrimitiva(obj, mallasCreadas);
      }
    });

    triggersBD.forEach((trigger: any) => {
      this.loaderTriggerSvc.cargarTrigger(trigger, mallasCreadas);
    });

    await Promise.all(promesasCarga);

    mallasCreadas.forEach((mesh, uid) => {
      const entity = this.entityManager.getEntityByUid(uid);
      if (entity && entity.parentId) {
        const parentNode = mallasCreadas.get(entity.parentId) || scene.getMeshByName(entity.parentId);
        if (parentNode) mesh.parent = parentNode;
      }
    });

    if (isPlaying) {
        if (persistentPlayer) {
            this.spawnManager.handleSceneChangeSpawn(persistentPlayer);
        } else {
            this.spawnManager.setupInitialPlayer();
        }
    }

    setTimeout(() => {
      mallasCreadas.forEach((mesh) => {
        const entity = this.entityManager.getEntityByMesh(mesh);
        if (entity?.type === 'image_plane') {
          this.projectionSvc.actualizarProyeccion(mesh);
        }
      });
    }, 150);

    this.shadowsSvc.asignarObjetosASombrasDeLuces();
  }

  public async instantiatePrefab(prefabData: any, positionTarget: Vector3): Promise<Map<string, Mesh>> {
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
      this.loaderPrimitiveSvc.cargarPrimitiva(mockDbObject, mallasCreadas);
    }
    
    this.shadowsSvc.asignarObjetosASombrasDeLuces();
    return mallasCreadas;
  }
}