

import { GameMode } from '../../session/game-mode.model';

export type CameraType = 'EDITOR' | 'FPS' | 'TPS' | 'ADMIN_FREE' | 'CINEMATIC';

export interface CameraProfile {
  mode: GameMode;
  allowedCameras: CameraType[];
  initialCamera: CameraType;
}

export const CAMERA_PROFILES: Record<GameMode, CameraProfile> = {
  [GameMode.EDITOR]: {
    mode: GameMode.EDITOR,
    allowedCameras: ['EDITOR', 'FPS', 'TPS', 'CINEMATIC'],
    initialCamera: 'EDITOR'
  },
  [GameMode.EDITING_IN_GAME]: {
    mode: GameMode.EDITING_IN_GAME,
    allowedCameras: ['EDITOR', 'FPS', 'TPS', 'ADMIN_FREE', 'CINEMATIC'],
    initialCamera: 'EDITOR'
  },
  [GameMode.TEST_LIVE]: {
    mode: GameMode.TEST_LIVE,
    allowedCameras: ['EDITOR', 'FPS', 'TPS', 'ADMIN_FREE', 'CINEMATIC'],
    initialCamera: 'FPS'
  },
  [GameMode.PREVIEW_ADMIN]: {
    mode: GameMode.PREVIEW_ADMIN,
    allowedCameras: ['FPS', 'TPS', 'ADMIN_FREE', 'CINEMATIC'],
    initialCamera: 'FPS'
  },
  [GameMode.FINAL_USER]: {
    mode: GameMode.FINAL_USER,
    allowedCameras: ['FPS', 'TPS', 'CINEMATIC'],
    initialCamera: 'FPS'
  }
};
