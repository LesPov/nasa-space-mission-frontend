
export type CameraViewMode = 'FPS' | 'TPS';

export interface GameContextState {
  mode: import('./game-mode.model').GameMode;
  cameraView: CameraViewMode;
  isPointerLocked: boolean;
}
