

// src/app/core/engine/runtime/controllers/npc.controller.ts
import { Injector } from '@angular/core';
import { BaseCharacterController } from './base-character.controller';
import { GameEntity } from '../../entities/game.entity';

/**
 * @deprecated Obsoleto bajo la nueva arquitectura ECS.
 * La lógica central de los NPCs ahora es administrada globalmente por
 * `CharacterKinematicsService`, `PlayerSequenceService` y `PlayerAnimationService`.
 */
export class NpcController extends BaseCharacterController {
  
  constructor(entity: GameEntity, injector: Injector) {
    super(entity, injector);
  }

  public start(): void {}
  public override destroy(): void {}
  public physicsUpdate(dtMs: number): void {}
  public update(dtMs: number): void {}
  public postUpdate(dtMs: number): void {}
}
