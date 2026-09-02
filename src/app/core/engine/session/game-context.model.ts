import { AuthorityProfile } from './authority-profile.model';

export type CameraViewMode = 'FPS' | 'TPS';
export type ToolModeContext = 'select' | 'translate' | 'rotate' | 'scale';

export type AppMode = 'EDITOR' | 'PLAYER';
export type EngineState = 'STOPPED' | 'PLAYING' | 'PAUSED' | 'TRANSITIONING';
export type InputContext = 'UI' | 'PLAYER' | 'ADMIN_FREE_CAM';

export interface GameContextState {
  mode: import('./game-mode.model').GameMode; // Legacy
  appMode: AppMode;
  engineState: EngineState;
  inputContext: InputContext;
  authorityProfile: AuthorityProfile;
  cameraView: CameraViewMode;
  isPointerLocked: boolean;
}