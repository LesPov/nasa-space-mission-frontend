
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
import { CharacterConfigComponent, PlayerRuntimeComponent } from '../../entities/game.entity';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';

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
    const mode = this.gameContext.mode();
    const isPlaying = mode !== 'EDITOR' && mode !== 'EDITING_IN_GAME';
    
    // Identificar si venimos de otra plataforma conservando el player
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);

    const sceneData = dataBD.scene || dataBD;
    let envSettings: any = sceneData.environmentSettings || {};
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

    scene.cameras.forEach(cam => cam.maxZ = 10000);

    const objetosBD = dataBD.sceneObjects || dataBD.sceneObjectsDelta || [];
    const triggersBD = dataBD.triggers || dataBD.triggersDelta || [];

    const promesasCarga: any[] = [];
    const mallasCreadas = new Map<string, Mesh>();

    objetosBD.forEach((obj: any) => {
      const isModel = obj.type === 'model';
      const isLight = obj.type?.startsWith('light_');
      const objRol = obj.properties?.rol || obj.rol || 'prop';

      // Si estamos jugando y YA tenemos un jugador persistente, 
      // ignoramos por completo cualquier jugador que venga guardado en la base de datos de esta escena.
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

    // LÓGICA ROBUSTA DE SPAWN / TRANSICIÓN ENTRE PLATAFORMAS
    if (isPlaying) {
        if (persistentPlayer && persistentPlayer.view) {
            // Buscamos el punto de aparición real de esta nueva escena
            const newSpawn = this.entityManager.getAllEntities().find(e => !e.isPersistent && e.rol === 'spawn_point');

            if (newSpawn && newSpawn.view) {
                // Teletransportamos al jugador persistente EXACTAMENTE al spawn point
                persistentPlayer.transform.position = { ...newSpawn.transform.position };
                
                if (newSpawn.view.rotationQuaternion) {
                    persistentPlayer.view.rotationQuaternion = newSpawn.view.rotationQuaternion.clone();
                    persistentPlayer.view.rotation.set(0,0,0);
                    const euler = newSpawn.transform.rotation;
                    persistentPlayer.transform.rotation = { ...euler };
                } else {
                    persistentPlayer.view.rotation.copyFrom(newSpawn.view.rotation);
                    persistentPlayer.view.rotationQuaternion = null;
                    persistentPlayer.transform.rotation = { ...newSpawn.transform.rotation };
                }
                
                // Forzamos actualización física inmediata
                persistentPlayer.view.position.copyFrom(newSpawn.view.position);
                persistentPlayer.view.computeWorldMatrix(true);
                persistentPlayer.syncTransformFromView();
            } else {
                // Si la escena no tiene spawn point, lo mandamos a un punto seguro alto para evitar caer al vacío
                persistentPlayer.transform.position = { x: 0, y: 5, z: 0 };
                persistentPlayer.view.position.set(0, 5, 0);
                persistentPlayer.view.computeWorldMatrix(true);
            }

            // Eliminamos la inercia del frame anterior para evitar rebotes en triggers
            if (persistentPlayer.playerRuntime) {
                const state = persistentPlayer.playerRuntime.physicsState;
                state.velocidadY = 0;
                state.isMoving = false;
                state.isRunning = false;
                state.isJumping = false;
                state.isFalling = false;
                state.isHardLanding = false;
                state.isRecoveringFromFall = false;
                persistentPlayer.playerRuntime.intentions = {
                    moveForward: false, moveBackward: false, moveLeft: false, 
                    moveRight: false, run: false, jump: false
                };
            }

            // Borramos el objeto spawn point de la memoria para que no estorbe
            if (newSpawn) {
                this.entityManager.removeEntity(newSpawn.uid);
            }

        } else {
            // Primer load del episodio: Convertimos el spawn o el player de la BD en el Persistent Player
            let playerEntity = this.entityManager.getAllEntities().find(e => e.rol === 'player');
            let spawnPoint = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point');
            
            if (!playerEntity && spawnPoint) {
                spawnPoint.addComponent('characterConfig', new CharacterConfigComponent('player', true));
                spawnPoint.addComponent('playerRuntime', new PlayerRuntimeComponent());
                spawnPoint.playerConfig = cloneDefaultPlayerConfig();
                spawnPoint.rol = 'player';
                playerEntity = spawnPoint;
            } else if (playerEntity && spawnPoint && playerEntity.view && spawnPoint.view) {
                playerEntity.view.position.copyFrom(spawnPoint.view.position);
                if (spawnPoint.view.rotationQuaternion) {
                    playerEntity.view.rotationQuaternion = spawnPoint.view.rotationQuaternion.clone();
                    playerEntity.view.rotation.set(0,0,0);
                } else {
                    playerEntity.view.rotation.copyFrom(spawnPoint.view.rotation);
                    playerEntity.view.rotationQuaternion = null;
                }
                playerEntity.syncTransformFromView();
                this.entityManager.removeEntity(spawnPoint.uid);
            }

            if (playerEntity) {
                playerEntity.isPersistent = true;
                if (playerEntity.view) Tags.AddTagsTo(playerEntity.view, "persistent_player");
            }
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