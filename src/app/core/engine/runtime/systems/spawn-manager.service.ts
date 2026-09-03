
import { Injectable, inject } from '@angular/core';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../../entities/game.entity';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { Tags, MeshBuilder, Vector3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';

@Injectable({ providedIn: 'root' })
export class SpawnManagerService {
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  public resolvePlayerForSession(preferredEntity: GameEntity | null = null, isEditorPreview: boolean = false): GameEntity | null {
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);
    if (persistentPlayer && !isEditorPreview) {
        this.handleSceneChangeSpawn(persistentPlayer);
        return persistentPlayer;
    }

    let targetEntity = preferredEntity;

    if (!targetEntity || (!targetEntity.hasComponent('characterConfig') && targetEntity.rol !== 'spawn_point')) {
       const characters = this.entityManager.getEntitiesWithComponent('characterConfig');
       targetEntity = characters.find(c => c.rol === 'player') || characters.find(c => c.characterConfig?.isPlayable) || null;
    }

    if (!targetEntity) {
        targetEntity = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point') || null;
    }

    if (!targetEntity && isEditorPreview) {
        const editorCam = this.motor3d.getEditorCamera();
        const targetPos = editorCam && typeof editorCam.getTarget === 'function' ? editorCam.getTarget() : new Vector3(0, 0, 0);
        targetEntity = this.createTempPlayerFromSpawn(
            { x: targetPos.x, y: targetPos.y + 1, z: targetPos.z },
            { x: 0, y: 0, z: 0 },
            null
        );
        if (targetEntity) {
            targetEntity.isPersistent = true;
            if (targetEntity.view) Tags.AddTagsTo(targetEntity.view, "persistent_player");
            this.resetPhysicsInertia(targetEntity);
            return targetEntity;
        }
    }

    if (!targetEntity) {
        return null; 
    }

    if (targetEntity.rol === 'spawn_point') {
        if (isEditorPreview) {
            targetEntity = this.createTempPlayerFromSpawn(
                targetEntity.transform.position,
                targetEntity.transform.rotation,
                targetEntity.view?.rotationQuaternion
            );
        } else {
            targetEntity = this.upgradeSpawnToPlayer(targetEntity);
        }
    } else {
        if (!isEditorPreview) {
            const spawnPoint = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point' && e.uid !== targetEntity!.uid);
            if (spawnPoint && spawnPoint.view && targetEntity.view) {
               targetEntity.view.position.copyFrom(spawnPoint.view.position);
               if (spawnPoint.view.rotationQuaternion) {
                   targetEntity.view.rotationQuaternion = spawnPoint.view.rotationQuaternion.clone();
                   targetEntity.view.rotation.set(0, 0, 0);
               } else {
                   targetEntity.view.rotation.copyFrom(spawnPoint.view.rotation);
                   targetEntity.view.rotationQuaternion = null;
               }
               targetEntity.syncTransformFromView();
               this.entityManager.removeEntity(spawnPoint.uid);
            }
        }
    }

    if (targetEntity) {
        targetEntity.isPersistent = true;
        if (targetEntity.view) {
            Tags.AddTagsTo(targetEntity.view, "persistent_player");
        }
        this.resetPhysicsInertia(targetEntity);
    }

    return targetEntity;
  }

  private createTempPlayerFromSpawn(position: any, rotation: any, rotationQuat: any): GameEntity {
    const scene = this.motor3d.getScene();
    const tempMesh = MeshBuilder.CreateCapsule("TempPlayer_TestLive", { height: 1.8, radius: 0.4 }, scene);
    
    tempMesh.position.set(position.x, position.y, position.z);

    if (rotationQuat) {
        tempMesh.rotationQuaternion = rotationQuat.clone();
    } else {
        tempMesh.rotation.set(rotation.x, rotation.y, rotation.z);
    }
    
    // 🔥 FIX PLAYER SHADOWS: Para proyectar sombra, en vez de isVisible = false,
    // inyectamos la opacidad absoluta 0. Esto permite que entre a los Arrays de render de sombras.
    tempMesh.isVisible = true;
    tempMesh.visibility = 0.0001; 
    
    const playerEntity = new GameEntity(window.crypto.randomUUID(), 'Jugador_Prueba', 'model', 'player');
    playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEntity.playerConfig = cloneDefaultPlayerConfig();
    playerEntity.bindView(tempMesh);
    
    this.entityManager.addEntity(playerEntity);
    return playerEntity;
  }

  private upgradeSpawnToPlayer(spawnEntity: GameEntity): GameEntity {
    if (!spawnEntity.hasComponent('characterConfig')) {
        spawnEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
        spawnEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
        spawnEntity.playerConfig = cloneDefaultPlayerConfig();
    }
    spawnEntity.rol = 'player';
    return spawnEntity;
  }

  private handleSceneChangeSpawn(persistentPlayer: GameEntity): void {
    if (!persistentPlayer || !persistentPlayer.view) return;

    const newSpawn = this.entityManager.getAllEntities().find(e => !e.isPersistent && e.rol === 'spawn_point');

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