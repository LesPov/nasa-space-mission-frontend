// src/app/core/engine/controllers/character-context.interface.ts

import { LoopManagerService } from "../behaviors/services/loop-manager.service";
import { GameSession } from "../game-session";
import { Motor3dService } from "../../../services/motor-3d.service";
import { PlayerTriggerService } from "../systems/player-trigger.service";
import { PlayerAnimationService } from "../systems/player-animation.service";
import { PlayerBubbleService } from "../systems/player-bubble.service";
import { PlayerCameraManagerService } from "../systems/player-camera.service";
import { PlayerInputService } from "../systems/player-input.service";
import { PlayerInteractionService } from "../systems/player-interaction.service";
import { PlayerPhysicsService } from "../systems/player-physics.service";
import { PlayerSequenceService } from "../systems/player-sequence.service";
import { EntityManagerService } from "../entities/entity-manager.service";
import { CharacterKinematicsService } from "../systems/character-kinematics.service";

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
  kinematicsSvc: CharacterKinematicsService;
  sequenceSvc: PlayerSequenceService;
  inputSvc: PlayerInputService;
  cameraSvc: PlayerCameraManagerService;
  interactSvc: PlayerInteractionService;
  triggerSvc: PlayerTriggerService;
  bubbleSvc: PlayerBubbleService;
  loopManager: LoopManagerService;
}