
import { Injectable, inject } from '@angular/core';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../../entities/game.entity';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { Tags } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class SpawnManagerService {
  private entityManager = inject(EntityManagerService);

  /**
   * Resetea todas las inercias y estados de salto/caída de un jugador
   * para evitar que herede la velocidad de la plataforma anterior al teletransportarse.
   */
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

  /**
   * Encuentra el punto de aparición, teletransporta al jugador persistente allí,
   * y se deshace del objeto marcador de spawn.
   */
  public handleSceneChangeSpawn(persistentPlayer: GameEntity): void {
    if (!persistentPlayer || !persistentPlayer.view) return;

    const newSpawn = this.entityManager.getAllEntities().find(e => !e.isPersistent && e.rol === 'spawn_point');

    if (newSpawn && newSpawn.view) {
        // Teletransportamos al jugador persistente EXACTAMENTE al spawn point
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
        
        // Forzamos actualización física inmediata
        persistentPlayer.view.position.copyFrom(newSpawn.view.position);
        persistentPlayer.view.computeWorldMatrix(true);
        persistentPlayer.syncTransformFromView();
    } else {
        // Fallback seguro si la plataforma no tiene spawn
        persistentPlayer.transform.position = { x: 0, y: 5, z: 0 };
        persistentPlayer.view.position.set(0, 5, 0);
        persistentPlayer.view.computeWorldMatrix(true);
    }

    this.resetPhysicsInertia(persistentPlayer);

    // Borramos el objeto spawn point de la memoria para que no estorbe
    if (newSpawn) {
        this.entityManager.removeEntity(newSpawn.uid);
    }
  }

  /**
   * Ejecutado al arrancar el juego por primera vez (Sin persistencia previa).
   * Busca al jugador configurado, o convierte el spawn_point en el jugador principal.
   */
  public setupInitialPlayer(): GameEntity | null {
    let playerEntity = this.entityManager.getEntitiesWithComponent('characterConfig')
      .find(c => c.rol === 'player' || c.characterConfig?.isPlayable);

    // Si no hay jugador explícito, usamos el spawn_point
    if (!playerEntity) {
       playerEntity = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point');
       
       if (playerEntity) {
           if (!playerEntity.hasComponent('characterConfig')) {
               playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
               playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
               playerEntity.playerConfig = cloneDefaultPlayerConfig();
           }
           playerEntity.rol = 'player';
       }
    } else {
       // Si el jugador y el spawn_point existen, alineamos al jugador con el spawn y borramos el marcador
       const spawnPoint = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point' && e.uid !== playerEntity!.uid);
       if (spawnPoint && spawnPoint.view && playerEntity.view) {
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
    }

    if (playerEntity) {
        playerEntity.isPersistent = true;
        if (playerEntity.view) {
            Tags.AddTagsTo(playerEntity.view, "persistent_player");
        }
        this.resetPhysicsInertia(playerEntity);
    }

    return playerEntity || null;
  }
}