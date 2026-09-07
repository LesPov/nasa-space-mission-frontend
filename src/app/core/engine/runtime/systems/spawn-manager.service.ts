
import { Injectable, inject, Injector } from '@angular/core';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../../entities/game.entity';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { Tags, MeshBuilder, Vector3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { GameStateService } from '../state/game-state.service';
import { GameContextService } from '../../session/game-context.service';
import { CoreSceneLoaderService } from '../../scene/utils/core-scene-loader.service';

@Injectable({ providedIn: 'root' })
export class SpawnManagerService {
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private gameState = inject(GameStateService);
  private context = inject(GameContextService);
  
  // 🔥 FIX ARQUITECTÓNICO (NG0200): Inyectamos el Injector en lugar del servicio estático
  // Esto rompe la dependencia circular (SpawnManager <-> SceneLoader) resolviendo el loader 
  // en tiempo de ejecución solo cuando se necesita.
  private injector = inject(Injector);

  public async resolvePlayerForSession(preferredEntity: GameEntity | null = null, isEditorPreview: boolean = false): Promise<GameEntity | null> {
    // 1. Teletransporte natural (Jugador persistente ya existe en memoria entre escenas)
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);
    if (persistentPlayer && !isEditorPreview) {
        this.handleSceneChangeSpawn(persistentPlayer);
        return persistentPlayer;
    }

    let targetEntity = preferredEntity;

    // 🔥 2. FASE 1: RESOLUCIÓN DE NARRATIVE ROLE CORRECTA (Prefab de Character + Spawn)
    if (!targetEntity) {
        const activeRoleUid = this.gameState.playerRole;
        if (activeRoleUid) {
            const currentEp = this.context.activeEpisode();
            const roles = currentEp?.narrativeRoles || [];
            const roleDef = roles.find((r: any) => r.uid === activeRoleUid);
            
            if (roleDef) {
                let charEntity: GameEntity | null = null;

                // 2.a Instanciar el modelo 3D oficial del Rol desde el Prefab configurado
                if (roleDef.characterPrefab) {
                    // 🔥 Lazy Injection para evitar dependencias circulares
                    const sceneLoader = this.injector.get(CoreSceneLoaderService);
                    
                    const mallas = await sceneLoader.instantiatePrefab(
                        roleDef.characterPrefab,
                        Vector3.Zero()
                    );
                    const rootMesh = Array.from(mallas.values())[0];
                    charEntity = this.entityManager.getEntityByMesh(rootMesh) || null;
                } 
                
                // 2.b Mover al punto de Spawn designado por el Rol para la escena actual
                let spawnEntity = roleDef.spawnSceneObjectUid ? this.entityManager.getEntityByUid(roleDef.spawnSceneObjectUid) : null;
                
                if (!spawnEntity) {
                    // Fallback to first available spawn point in the scene
                    spawnEntity = this.entityManager.getAllEntities().find(e => !e.isPersistent && e.rol === 'spawn_point') || null;
                }

                if (charEntity) {
                    if (spawnEntity && spawnEntity.view) {
                        charEntity.transform.position = { ...spawnEntity.transform.position };
                        
                        if (spawnEntity.view.rotationQuaternion) {
                            charEntity.view!.rotationQuaternion = spawnEntity.view.rotationQuaternion.clone();
                            charEntity.view!.rotation.set(0, 0, 0);
                            charEntity.transform.rotationQuaternion = { ...spawnEntity.transform.rotationQuaternion } as any;
                        } else {
                            charEntity.view!.rotation.copyFrom(spawnEntity.view.rotation);
                            charEntity.view!.rotationQuaternion = null;
                            charEntity.transform.rotation = { ...spawnEntity.transform.rotation };
                        }

                        if (!isEditorPreview) {
                            this.entityManager.removeEntity(spawnEntity.uid);
                        }
                    }

                    charEntity.view!.position.set(charEntity.transform.position.x, charEntity.transform.position.y, charEntity.transform.position.z);
                    charEntity.view!.computeWorldMatrix(true);
                    charEntity.syncTransformFromView();

                    targetEntity = this.upgradeToPlayer(charEntity);
                } else {
                    console.warn(`[SpawnManager] Rol '${roleDef.name}' no tiene Prefab de personaje. Evaluando fallbacks...`);
                }
            }
        }
    }

    // 3. Fallbacks Clásicos si no hay Rol (Compatibilidad con mapas que no usan el nuevo sistema)
    if (!targetEntity || (!targetEntity.hasComponent('characterConfig') && targetEntity.rol !== 'spawn_point')) {
       const characters = this.entityManager.getEntitiesWithComponent('characterConfig');
       targetEntity = characters.find(c => c.rol === 'player') || characters.find(c => c.characterConfig?.isPlayable) || null;
    }

    if (!targetEntity) {
        targetEntity = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point') || null;
    }

    // 🔥 PREVENCIÓN DE CUBO ROJO: Si el único "player" que hallamos es un spawn_point (un cubo estático), 
    // JAMÁS lo convertimos visualmente en el jugador. Instanciamos una cápsula genérica transparente.
    if (targetEntity && targetEntity.rol === 'spawn_point') {
        const spawnTransform = { 
            position: targetEntity.transform.position, 
            rotation: targetEntity.transform.rotation, 
            rotationQuaternion: targetEntity.view?.rotationQuaternion 
        };
        
        targetEntity = this.createTempPlayerFromSpawn(
            spawnTransform.position,
            spawnTransform.rotation,
            spawnTransform.rotationQuaternion
        );
    }

    // 4. Fallback extremo de TestLive Editor (Cámara flotante en la Posición actual si no hay ni spawn)
    if (!targetEntity && isEditorPreview) {
        const editorCam = this.motor3d.getEditorCamera();
        const targetPos = editorCam && typeof editorCam.getTarget === 'function' ? editorCam.getTarget() : new Vector3(0, 0, 0);
        targetEntity = this.createTempPlayerFromSpawn(
            { x: targetPos.x, y: targetPos.y + 1, z: targetPos.z },
            { x: 0, y: 0, z: 0 },
            null
        );
    }

    if (!targetEntity) {
        return null; 
    }

    // 5. Configurar persistencia transversal e Inercia
    targetEntity.isPersistent = true;
    if (targetEntity.view) {
        Tags.AddTagsTo(targetEntity.view, "persistent_player");
    }
    this.resetPhysicsInertia(targetEntity);

    return targetEntity;
  }

  private createTempPlayerFromSpawn(position: any, rotation: any, rotationQuat: any): GameEntity {
    const scene = this.motor3d.getScene();
    const tempMesh = MeshBuilder.CreateCapsule("TempPlayer_Fallback", { height: 1.8, radius: 0.4 }, scene);
    
    tempMesh.position.set(position.x, position.y + 0.9, position.z);

    if (rotationQuat) {
        tempMesh.rotationQuaternion = rotationQuat.clone();
    } else {
        tempMesh.rotation.set(rotation.x, rotation.y, rotation.z);
    }
    
    tempMesh.ellipsoid = new Vector3(0.4, 0.9, 0.4);
    tempMesh.ellipsoidOffset = new Vector3(0, 0.9, 0); 

    // 🔥 FIX: Lo hacemos visible pero transparente, para que el editor note que es el fallback
    tempMesh.isVisible = true; 
    tempMesh.visibility = 0.5; 
    tempMesh.isPickable = false;
    
    const playerEntity = new GameEntity(window.crypto.randomUUID(), 'Jugador_Fallback_Auto', 'model', 'player');
    playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEntity.playerConfig = cloneDefaultPlayerConfig();
    playerEntity.bindView(tempMesh);
    
    this.entityManager.addEntity(playerEntity);
    return playerEntity;
  }

  private upgradeToPlayer(entity: GameEntity): GameEntity {
    if (!entity.hasComponent('characterConfig')) {
        entity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    }
    if (!entity.hasComponent('playerRuntime')) {
        entity.addComponent('playerRuntime', new PlayerRuntimeComponent());
    }
    if (!entity.playerConfig) {
        entity.playerConfig = cloneDefaultPlayerConfig();
    }
    entity.rol = 'player';
    return entity;
  }

  private handleSceneChangeSpawn(persistentPlayer: GameEntity): void {
    if (!persistentPlayer || !persistentPlayer.view) return;

    // 🔥 Al cambiar de escena, buscamos si la nueva tiene un Spawn_Point
    let newSpawn = this.entityManager.getAllEntities().find(e => !e.isPersistent && e.rol === 'spawn_point');

    if (newSpawn && newSpawn.view) {
        persistentPlayer.transform.position = { ...newSpawn.transform.position };
        
        if (newSpawn.view.rotationQuaternion) {
            persistentPlayer.view.rotationQuaternion = newSpawn.view.rotationQuaternion.clone();
            persistentPlayer.view.rotation.set(0, 0, 0);
            persistentPlayer.transform.rotation = { ...newSpawn.transform.rotation };
        } else {
            persistentPlayer.view.rotation.copyFrom(newSpawn.view.rotation);
            persistentPlayer.view.rotationQuaternion = null;
            persistentPlayer.transform.rotation = { ...newSpawn.transform.rotation };
        }
        
        persistentPlayer.view.position.copyFrom(newSpawn.view.position);
        persistentPlayer.view.computeWorldMatrix(true);
        persistentPlayer.syncTransformFromView();
    } else {
        persistentPlayer.transform.position = { x: 0, y: 5, z: 0 };
        persistentPlayer.view.position.set(0, 5, 0);
        persistentPlayer.view.computeWorldMatrix(true);
    }

    this.resetPhysicsInertia(persistentPlayer);

    if (newSpawn) {
        this.entityManager.removeEntity(newSpawn.uid);
    }
  }

  public resetPhysicsInertia(player: GameEntity): void {
    if (!player || !player.playerRuntime) return;
    const state = player.playerRuntime.physicsState;
    
    state.velocidadY = 0;
    state.isMoving = false;
    state.isRunning = false;
    state.isJumping = false;
    state.isFalling = false;
    state.isHardLanding = false;
    state.isRecoveringFromFall = false;
    
    player.playerRuntime.intentions = {
        moveForward: false, moveBackward: false, moveLeft: false, 
        moveRight: false, run: false, jump: false
    };
  }
}