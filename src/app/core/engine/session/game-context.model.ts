
// src/app/core/engine/session/game-context.model.ts

import { AuthorityProfile } from './authority-profile.model';
import { GameMode } from './game-mode.model';

export type CameraViewMode = 'FPS' | 'TPS';
export type ToolModeContext = 'select' | 'translate' | 'rotate' | 'scale';

export type ExecutionContext = 'PLAYER_PREVIEW' | 'ADMIN_PREVIEW' | 'EDITOR';
export type EditorSubmode = 'EDITING' | 'PLAYTEST_FPS' | 'PLAYTEST_TPS' | 'EDITING_IN_GAME';

export type AppMode = 'EDITOR' | 'PLAYER';
export type EngineState = 'STOPPED' | 'PLAYING' | 'PAUSED' | 'TRANSITIONING';

export type RuntimeReadyStage = 
  | 'IDLE' 
  | 'LOADING_SCENE'
  | 'RESOLVING_HIERARCHY'
  | 'RESOLVING_PLAYER'
  | 'BUILDING_SPATIAL_GROUPS'
  | 'PREPARING_RESOURCES' 
  | 'PREPARING_FOG'
  | 'PREPARING_LIGHTS'
  | 'PREPARING_CONTAINMENT'
  | 'PREPARING_SHADOWS'
  | 'PREWARMING_MATERIALS'
  | 'COMPILING_SHADERS'
  | 'WARMING_RENDER'
  | 'CHECKING_STABILITY' 
  | 'READY' 
  | 'FAILED_FALLBACK';

export type InputContext = 
  | 'UI'
  | 'GAMEPLAY'
  | 'ADMIN_PREVIEW'
  | 'EDITOR_EDITING'
  | 'EDITOR_PLAYTEST';

export interface GameContextState {
  executionContext: ExecutionContext;
  editorSubmode: EditorSubmode | null;
  mode: GameMode;
  appMode: AppMode;
  engineState: EngineState;
  inputContext: InputContext;
  authorityProfile: AuthorityProfile;
  cameraView: CameraViewMode;
  isPointerLocked: boolean;
  runtimeReadyStage: RuntimeReadyStage;
}