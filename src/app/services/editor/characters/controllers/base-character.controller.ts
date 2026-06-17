import { Mesh } from '@babylonjs/core';
import { mergePlayerConfig, PlayerRuntimeConfig } from '../../player-config.model';
import { EstadoFisico } from '../../playerservice/player-physics.service';
import { CharacterContext } from '../character-context.interface';
 
export abstract class BaseCharacterController {
  public mesh: Mesh;
  public config: PlayerRuntimeConfig;
  public estadoFisico: EstadoFisico;
  protected context: CharacterContext;

  constructor(mesh: Mesh, context: CharacterContext) {
    this.mesh = mesh;
    this.context = context;
    this.config = mergePlayerConfig(mesh.metadata?.playerConfig || null);
    
    // El estado Físico AHORA pertenece exclusivamente a la entidad.
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
   * Método principal que se ejecutará en el Game Loop.
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