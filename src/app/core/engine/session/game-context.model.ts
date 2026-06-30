
export type CameraViewMode = 'FPS' | 'TPS';
export type ToolModeContext = 'select' | 'translate' | 'rotate' | 'scale';

export interface GameContextState {
  mode: import('./game-mode.model').GameMode;
  cameraView: CameraViewMode;
  isPointerLocked: boolean;
}