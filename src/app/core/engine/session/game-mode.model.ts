
/**
 * Modelo unificado de los Modos de Juego y Estados de Reproducción.
 * Centraliza la definición de transiciones para todo el motor.
 */

export enum GameMode {
  EDITOR = 'EDITOR',               // El usuario está construyendo el mapa (Gizmos, Drag&Drop)
  TEST_LIVE = 'TEST_LIVE',         // El creador presionó "Jugar Preview" dentro del Editor
  EDITING_IN_GAME = 'EDITING_IN_GAME', // El creador pausó TEST_LIVE para mover un objeto con Gizmos
  PREVIEW_ADMIN = 'PREVIEW_ADMIN', // El creador entró a la ruta de juego final (con privilegios de Admin)
  FINAL_USER = 'FINAL_USER'        // El jugador real jugando la experiencia terminada
}

// PlayState se mantiene para compatibilidad estricta con la UI del Editor (Inspector, Timeline, etc.)
export type PlayState = 'EDITOR' | 'PLAYING' | 'EDITING_IN_GAME' | 'TRANSITIONING' | 'INTERACTING';
