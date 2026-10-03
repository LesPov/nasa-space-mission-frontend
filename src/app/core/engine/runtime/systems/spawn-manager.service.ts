import { Injectable, inject, Injector } from '@angular/core';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../../entities/game.entity';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { Tags, MeshBuilder, Vector3, AbstractMesh } from '@babylonjs/core';
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
  private injector = inject(Injector);

  public async resolvePlayerForSession(preferredEntity: GameEntity | null = null, isEditorPreview: boolean = false): Promise<GameEntity | null> {
    // 1. Jugador persistente existente (transición entre plataformas)
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);
    if (persistentPlayer && !isEditorPreview) {
        this.handleSceneChangeSpawn(persistentPlayer);
        return persistentPlayer;
    }

    let targetEntity = preferredEntity;
    let isDynamicallySpawned = false; // 🔥 MARCADOR DE PROCEDENCIA

    // 2. Resolución de Rol Narrativo (Prefab de Character + Spawn Point)
    if (!targetEntity) {
        const activeRoleUid = this.gameState.playerRole;
        if (activeRoleUid) {
            const currentEp = this.context.activeEpisode();
            const roles = currentEp?.narrativeRoles || [];
            const roleDef = roles.find((r: any) => r.uid === activeRoleUid);
            
            if (roleDef) {
                let charEntity: GameEntity | null = null;

                if (roleDef.characterPrefab) {
                    const sceneLoader = this.injector.get(CoreSceneLoaderService);
                    const mallas = await sceneLoader.instantiatePrefab(
                        roleDef.characterPrefab,
                        Vector3.Zero()
                    );
                    const rootMesh = Array.from(mallas.values())[0];
                    charEntity = this.entityManager.getEntityByMesh(rootMesh) || null;
                    isDynamicallySpawned = true; // Fue creado al vuelo para Test Live
                } 
                
                let spawnEntity = roleDef.spawnSceneObjectUid ? this.entityManager.getEntityByUid(roleDef.spawnSceneObjectUid) : null;
                if (!spawnEntity) {
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
                }
            }
        }
    }

    // 3. Fallbacks de búsqueda en la escena
    if (!targetEntity || (!targetEntity.hasComponent('characterConfig') && targetEntity.rol !== 'spawn_point')) {
       const characters = this.entityManager.getEntitiesWithComponent('characterConfig');
       targetEntity = characters.find(c => c.rol === 'player') || characters.find(c => c.characterConfig?.isPlayable) || null;
       // Aquí NO ES dinámico, la entidad ya pertenecía a la memoria del Editor.
    }

    if (!targetEntity) {
        targetEntity = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point') || null;
    }

    // 4. Si el objetivo es solo un spawn_point, instanciar cápsula transparente (invisible en producción)
    if (targetEntity && targetEntity.rol === 'spawn_point') {
        const spawnTransform = { 
            position: targetEntity.transform.position, 
            rotation: targetEntity.transform.rotation, 
            rotationQuaternion: targetEntity.view?.rotationQuaternion 
        };
        
        targetEntity = this.createTempPlayerFromSpawn(
            spawnTransform.position,
            spawnTransform.rotation,
            spawnTransform.rotationQuaternion,
            isEditorPreview
        );
        isDynamicallySpawned = true; // Fue creado al vuelo
    }

    // 5. Fallback absoluto para editor sin spawn point
    if (!targetEntity && isEditorPreview) {
        const editorCam = this.motor3d.getEditorCamera();
        const targetPos = editorCam && typeof editorCam.getTarget === 'function' ? editorCam.getTarget() : new Vector3(0, 0, 0);
        targetEntity = this.createTempPlayerFromSpawn(
            { x: targetPos.x, y: targetPos.y + 1, z: targetPos.z },
            { x: 0, y: 0, z: 0 },
            null,
            true
        );
        isDynamicallySpawned = true; // Fue creado al vuelo
    }

    if (!targetEntity) return null;

    // 🔥 FIX BUG 2: SOLO ES RUNTIME_ONLY (se descarta y destruye al salir) SI FUE INSTANCIADO DINÁMICAMENTE.
    // Si era un objeto del editor, debe conservarse intacto.
    if (isDynamicallySpawned && isEditorPreview) {
        targetEntity.isRuntimeOnly = true;
        
        if (targetEntity.view) {
            targetEntity.view.getDescendants(false).forEach((child) => {
                const childEntity = this.entityManager.getEntityByMesh(child as AbstractMesh);
                if (childEntity) {
                    childEntity.isRuntimeOnly = true;
                }
            });
        }
    }

    // isPersistent solo es válido para la producción (transición entre niveles)
    targetEntity.isPersistent = !isEditorPreview;
    if (targetEntity.view) {
        Tags.AddTagsTo(targetEntity.view, "persistent_player");
    }
    
    this.resetPhysicsInertia(targetEntity);

    return targetEntity;
  }

  private createTempPlayerFromSpawn(position: any, rotation: any, rotationQuat: any, isEditorPreview: boolean): GameEntity {
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

    tempMesh.isVisible = isEditorPreview; 
    tempMesh.visibility = isEditorPreview ? 0.4 : 0.0; 
    tempMesh.isPickable = false;
    
    const playerEntity = new GameEntity(window.crypto.randomUUID(), 'Jugador_Fallback_Auto', 'model', 'player');
    playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEntity.playerConfig = cloneDefaultPlayerConfig();
    playerEntity.bindView(tempMesh);
    
    // Al ser generado por el código, su naturaleza es estrictamente volátil
    playerEntity.isRuntimeOnly = true;
    
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

    let newSpawn = this.entityManager.getAllEntities().find(e => !e.isPersistent && e.rol === 'spawn_point');

    if (newSpawn && newSpawn.view) {
        persistentPlayer.transform.position = { ...newSpawn.transform.position };
        
        if (newSpawn.view.rotationQuaternion) {
            persistentPlayer.view.rotationQuaternion = newSpawn.view.rotationQuaternion.clone();
            persistentPlayer.view.rotation.set(0, 0, 0);
            persistentPlayer.transform.rotationQuaternion = { ...newSpawn.transform.rotationQuaternion } as any;
        } else {
            persistentPlayer.view.rotation.copyFrom(newSpawn.view.rotation);
            persistentPlayer.view.rotationQuaternion = null;
            persistentPlayer.transform.rotation = { ...newSpawn.transform.rotation };
        }
        
        persistentPlayer.view.position.copyFrom(newSpawn.view.position);
        persistentPlayer.view.computeWorldMatrix(true);
        persistentPlayer.syncTransformFromView();
    } else {
        persistentPlayer.transform.position = { x: 0, y: 1.5, z: 0 };
        persistentPlayer.view.position.set(0, 1.5, 0);
        persistentPlayer.view.computeWorldMatrix(true);
    }

    this.resetPhysicsInertia(persistentPlayer);

    // En producción eliminamos el spawn marker para siempre de este nivel
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
    
    if (player.view) {
      state.currentPosition.copyFrom(player.view.position);
      state.previousPosition.copyFrom(player.view.position);
    }

    player.playerRuntime.intentions = {
        moveForward: false, moveBackward: false, moveLeft: false, 
        moveRight: false, run: false, jump: false
    };
  }
}