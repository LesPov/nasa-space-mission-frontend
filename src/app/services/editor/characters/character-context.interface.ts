// src/app/services/editor/characters/character-context.interface.ts

import { LoopManagerService } from "../../../core/engine/behaviors/services/loop-manager.service";
import { GameSession } from "../../../core/engine/game-session";
import { Motor3dService } from "../../motor-3d.service";
import { PlayerTriggerService } from "../../../core/engine/systems/player-trigger.service";
import { PlayerAnimationService } from "../../../core/engine/systems/player-animation.service";
import { PlayerBubbleService } from "../../../core/engine/systems/player-bubble.service";
import { PlayerCameraManagerService } from "../../../core/engine/systems/player-camera.service";
import { PlayerInputService } from "../../../core/engine/systems/player-input.service";
import { PlayerInteractionService } from "../../../core/engine/systems/player-interaction.service";
import { PlayerPhysicsService } from "../../../core/engine/systems/player-physics.service";
import { PlayerSequenceService } from "../../../core/engine/systems/player-sequence.service";
import { EntityManagerService } from "../../../core/engine/entities/entity-manager.service";

/**
 * Agrupa todas las dependencias (Servicios "Stateless") que necesitan 
 * los controladores para operar.
 */
export interface CharacterContext {
  motor3d: Motor3dService;
  session: GameSession; 
  entityManager: EntityManagerService;
  animSvc: PlayerAnimationService;
  physicsSvc: PlayerPhysicsService;
  sequenceSvc: PlayerSequenceService;
  inputSvc: PlayerInputService;
  cameraSvc: PlayerCameraManagerService;
  interactSvc: PlayerInteractionService;
  triggerSvc: PlayerTriggerService;
  bubbleSvc: PlayerBubbleService;
  loopManager: LoopManagerService;
}