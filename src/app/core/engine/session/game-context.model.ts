
export enum GameMode {
  EDITOR = 'EDITOR',               // El usuario está construyendo el mapa (Gizmos, Drag&Drop)
  TEST_LIVE = 'TEST_LIVE',         // El creador presionó "Jugar Preview" dentro del Editor
  PREVIEW_ADMIN = 'PREVIEW_ADMIN', // El creador entró a la ruta de juego final (con privilegios)
  FINAL_USER = 'FINAL_USER'        // El jugador real jugando la experiencia terminada
}

export type CameraViewMode = 'FPS' | 'TPS';

export interface GameContextState {
  mode: GameMode;
  cameraView: CameraViewMode;
  isPointerLocked: boolean;
}