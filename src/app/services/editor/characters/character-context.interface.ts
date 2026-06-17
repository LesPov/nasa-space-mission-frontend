import { LoopManagerService } from "../../../core/engine/behaviors/services/loop-manager.service";
import { Motor3dService } from "../../motor-3d.service";
import { EditorStateService } from "../editor-state.service";
import { PlayerTriggerService } from "../player-trigger.service";
import { PlayerAnimationService } from "../playerservice/player-animation.service";
import { PlayerBubbleService } from "../playerservice/player-bubble";
import { PlayerCameraManagerService } from "../playerservice/player-camera.service";
import { PlayerInputService } from "../playerservice/player-input.service";
import { PlayerInteractionService } from "../playerservice/player-interaction.service";
import { PlayerPhysicsService } from "../playerservice/player-physics.service";
import { PlayerSequenceService } from "../playerservice/player-sequence.service";
  
/**
 * Agrupa todas las dependencias (Servicios "Stateless") que necesitan 
 * los controladores para operar, evitando tener 11 argumentos en el constructor.
 */
export interface CharacterContext {
  motor3d: Motor3dService;
  state: EditorStateService;
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