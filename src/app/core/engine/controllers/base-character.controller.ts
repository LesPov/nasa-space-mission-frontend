// src/app/core/engine/controllers/base-character.controller.ts

import { Mesh } from '@babylonjs/core';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../models/player-config.model';
import { EstadoFisico } from '../systems/player-physics.service';
 import { GameEntity } from '../entities/game.entity';
import { CharacterContext } from './character-context.interface';
 
export abstract class BaseCharacterController {
  public entity: GameEntity;
  public mesh: Mesh;
  public config: PlayerRuntimeConfig;
  public estadoFisico: EstadoFisico;
  protected context: CharacterContext;
  protected loopId: string;

  constructor(entity: GameEntity, context: CharacterContext) {
    this.entity = entity;
    
    if (!entity.view || !(entity.view instanceof Mesh)) {
      throw new Error(`[BaseCharacterController] La entidad ${entity.name} no tiene un Mesh válido bindeado.`);
    }
    
    this.mesh = entity.view as Mesh;
    this.context = context;
    this.loopId = `ControllerLogic_${this.entity.uid}`;
    
    this.config = entity.playerConfig || cloneDefaultPlayerConfig();
    
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

  public abstract start(): void;

  protected abstract physicsUpdate(dtMs: number): void;
  protected abstract logicUpdate(dtMs: number): void;
  protected abstract postUpdate(dtMs: number): void;

  public destroy(): void {
    this.context.loopManager.unregister(this.loopId + '_PHYSICS');
    this.context.loopManager.unregister(this.loopId + '_LOGIC');
    this.context.loopManager.unregister(this.loopId + '_POST');
    this.context.animSvc.detenerTodas(this.entity);
  }

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