
import { GameMode } from '../../session/game-mode.model';

export interface CameraBehaviorProfile {
  collisionsEnabled: boolean;
  inertia: number;
  panningInertia: number;
  angularSensibilityX: number;
  angularSensibilityY: number;
  fov: number;
  minZ: number;
}

export const CAMERA_BEHAVIOR_PROFILES: Record<GameMode, CameraBehaviorProfile> = {
  [GameMode.EDITOR]: {
    collisionsEnabled: false,
    inertia: 0.8,
    panningInertia: 0.8,
    angularSensibilityX: 2000,
    angularSensibilityY: 2000,
    fov: 0.8,
    minZ: 0.1
  },
  [GameMode.EDITING_IN_GAME]: {
    collisionsEnabled: false,
    inertia: 0.8,
    panningInertia: 0.8,
    angularSensibilityX: 2000,
    angularSensibilityY: 2000,
    fov: 0.8,
    minZ: 0.1
  },
  [GameMode.TEST_LIVE]: {
    collisionsEnabled: false, // Relajado para probar rápido en el editor
    inertia: 0.7,
    panningInertia: 0.7,
    angularSensibilityX: 2500,
    angularSensibilityY: 2500,
    fov: 1.0,
    minZ: 0.05
  },
  [GameMode.PREVIEW_ADMIN]: {
    collisionsEnabled: true, // Físicas estrictas como el juego real
    inertia: 0.9,
    panningInertia: 0.9,
    angularSensibilityX: 2000,
    angularSensibilityY: 2000,
    fov: 0.85,
    minZ: 0.05
  },
  [GameMode.FINAL_USER]: {
    collisionsEnabled: true, // Físicas estrictas para el usuario final
    inertia: 0.9,
    panningInertia: 0.9,
    angularSensibilityX: 2000,
    angularSensibilityY: 2000,
    fov: 0.85,
    minZ: 0.05
  }
};
