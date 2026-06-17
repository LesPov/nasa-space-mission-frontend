import { Mesh } from '@babylonjs/core';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../../player-config.model';
import { EstadoFisico } from '../../playerservice/player-physics.service';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export abstract class BaseCharacterController {
  public entity: GameEntity;
  public mesh: Mesh;
  public config: PlayerRuntimeConfig;
  public estadoFisico: EstadoFisico;
  protected context: CharacterContext;

  constructor(entity: GameEntity, context: CharacterContext) {
    this.entity = entity;
    
    // Verificamos que la entidad tenga su vista bindeada
    if (!entity.view || !(entity.view instanceof Mesh)) {
      throw new Error(`[BaseCharacterController] La entidad ${entity.name} no tiene un Mesh válido bindeado.`);
    }
    
    this.mesh = entity.view as Mesh;
    this.context = context;
    
    // 🔥 LECTURA DESDE LA ENTIDAD, NO DESDE METADATA
    this.config = entity.playerConfig || cloneDefaultPlayerConfig();
    
    // El estado Físico pertenece exclusivamente al controlador en runtime
    this.estadoFisico = {
      isMoving: false,
      isRunning: false,
      isGrounded: true,
      isJumping: false,
      isFalling: false,
      isHardLanding: false,
      isRecoveringFromFall: false,
      landingFrame: 0,
      recoveryFrame: 0,
      velocidadY: -0.1,
      highestY: -9999
    };
  }

  /**
   * Método principal que se ejecutará en el Game Loop mediante el LoopManager.
   */
  public abstract update(dtMs: number): void;

  /**
   * Resetea el estado físico propio de este actor (Ej. al reiniciar el mapa o hacer respawn).
   */
  public resetPhysicsState(): void {
    this.estadoFisico.isMoving = false;
    this.estadoFisico.isRunning = false;
    this.estadoFisico.isGrounded = true;
    this.estadoFisico.velocidadY = -0.1;
    this.estadoFisico.highestY = -9999;
    this.estadoFisico.isJumping = false;
    this.estadoFisico.isFalling = false;
    this.estadoFisico.isHardLanding = false;
    this.estadoFisico.isRecoveringFromFall = false;
    this.estadoFisico.landingFrame = 0;
    this.estadoFisico.recoveryFrame = 0;
  }
}