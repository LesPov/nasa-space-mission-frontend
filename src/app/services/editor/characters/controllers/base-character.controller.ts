
import { Mesh } from '@babylonjs/core';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../../../../core/engine/models/player-config.model';
import { EstadoFisico } from '../../../../core/engine/systems/player-physics.service';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export abstract class BaseCharacterController {
  public entity: GameEntity;
  public mesh: Mesh;
  public config: PlayerRuntimeConfig;
  public estadoFisico: EstadoFisico;
  protected context: CharacterContext;
  protected loopId: string;

  constructor(entity: GameEntity, context: CharacterContext) {
    this.entity = entity;
    
    // Verificamos que la entidad tenga su vista bindeada
    if (!entity.view || !(entity.view instanceof Mesh)) {
      throw new Error(`[BaseCharacterController] La entidad ${entity.name} no tiene un Mesh válido bindeado.`);
    }
    
    this.mesh = entity.view as Mesh;
    this.context = context;
    this.loopId = `ControllerLogic_${this.entity.uid}`;
    
    // LECTURA DESDE LA ENTIDAD, NO DESDE METADATA
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
   * Conecta el controlador al Motor de Juego.
   */
  public abstract start(): void;

  /**
   * Fases estructurales obligatorias del ECS.
   */
  protected abstract physicsUpdate(dtMs: number): void;
  protected abstract logicUpdate(dtMs: number): void;
  protected abstract postUpdate(dtMs: number): void;

  /**
   * Desconecta el controlador y limpia memoria.
   */
  public destroy(): void {
    this.context.loopManager.unregister(this.loopId + '_PHYSICS');
    this.context.loopManager.unregister(this.loopId + '_LOGIC');
    this.context.loopManager.unregister(this.loopId + '_POST');
    this.context.animSvc.detenerTodas(this.entity);
  }

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