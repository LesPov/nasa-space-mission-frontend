

// src/app/core/engine/runtime/controllers/player.controller.ts
import { Injector } from '@angular/core';
import { BaseCharacterController } from './base-character.controller';
import { GameEntity } from '../../entities/game.entity';

/**
 * @deprecated Obsoleto bajo la nueva arquitectura ECS.
 * Toda la lógica central (Movimiento, Entradas, Interacciones, Cámara y Animaciones)
 * ha sido migrada con éxito a los Systems en `src/app/core/engine/runtime/systems/`.
 */
export class PlayerController extends BaseCharacterController {
  
  constructor(entity: GameEntity, injector: Injector) {
    super(entity, injector);
  }

  public start(): void {}
  public override destroy(): void {}
  public physicsUpdate(dtMs: number): void {}
  public update(dtMs: number): void {}
  public postUpdate(dtMs: number): void {}
}

