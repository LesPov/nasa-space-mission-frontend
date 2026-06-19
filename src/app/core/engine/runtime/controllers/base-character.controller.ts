// src/app/core/engine/runtime/controllers/base-character.controller.ts

import { Mesh } from '@babylonjs/core';
import { Injector } from '@angular/core';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { GameEntity, PlayerStateComponent } from '../../entities/game.entity';
import { LoopManagerService, IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EstadoFisico } from '../systems/player-physics.service';

export abstract class BaseCharacterController implements IUpdatable {
  public entity: GameEntity;
  public mesh: Mesh;
  public config: PlayerRuntimeConfig;
  protected injector: Injector;
  protected loopManager: LoopManagerService;
  protected loopId: string;

  constructor(entity: GameEntity, injector: Injector) {
    this.entity = entity;
    this.injector = injector;
    
    if (!entity.view || !(entity.view instanceof Mesh)) {
      throw new Error(`[BaseCharacterController] La entidad ${entity.name} no tiene un Mesh válido bindeado.`);
    }
    
    this.mesh = entity.view as Mesh;
    this.loopManager = this.injector.get(LoopManagerService);
    this.loopId = `ControllerLogic_${this.entity.uid}`;
    
    this.config = entity.playerConfig || cloneDefaultPlayerConfig();
  }

  // Identificador para el LoopManager
  public get id(): string { 
    return this.loopId; 
  }

  public get estadoFisico(): EstadoFisico {
    return this.entity.getComponent<PlayerStateComponent>('playerState')!.physicsState;
  }

  public abstract start(): void;

  public abstract physicsUpdate(dtMs: number): void;
  public abstract update(dtMs: number): void; // Lógica principal
  public abstract postUpdate(dtMs: number): void;

  public destroy(): void {
    // Al destruir, el controlador se da de baja del motor global
    this.loopManager.unregisterSystem(this.id);
  }

  public resetPhysicsState(): void {
    const state = this.estadoFisico;
    state.isMoving = false;
    state.isRunning = false;
    state.isGrounded = true;
    state.velocidadY = -0.1;
    state.highestY = -9999;
    state.isJumping = false;
    state.isFalling = false;
    state.isHardLanding = false;
    state.isRecoveringFromFall = false;
    state.landingFrame = 0;
    state.recoveryFrame = 0;
  }
}