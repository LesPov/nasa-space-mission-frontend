
export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export type CinematicEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface CinematicClip {
  id: string;
  startTimeMs: number;
  durationMs: number;
  easing: CinematicEasing;

  // Propiedades para pistas de Cámara y Actor
  startPosition?: Vector3State;
  endPosition?: Vector3State;
  startRotation?: Vector3State; // Euler degrees
  endRotation?: Vector3State;   // Euler degrees
  startFov?: number;
  endFov?: number;

  // 🔥 NUEVO: Orbit y Follow
  cameraTargetUid?: string; // Si se establece, la cámara mirará fijo a este actor
  useLocalSpaceUid?: string; // Si se establece, las coordenadas se calculan relativas a la rotación/posición de este actor
  fadeMode?: 'none' | 'fadeIn' | 'fadeOut' | 'holdBlack'; // Controla el Screen Fade

  // Propiedades para pistas de Diálogo / Animación
  animationName?: string; // 🔥 NUEVO: Animación para el Actor (walk, run, etc.)
  actorName?: string;
  text?: string;
  audioUrl?: string;

  // Propiedades para eventos
  eventName?: string;
  eventPayload?: any;
}

export type CinematicTrackType = 'camera' | 'actor' | 'dialogue' | 'event';

export interface CinematicTrack {
  id: string;
  name: string;
  type: CinematicTrackType;
  targetUid?: string; // UID del actor si es tipo 'actor'
  clips: CinematicClip[];
}

export interface CinematicSequence {
  id: string;
  name: string;
  durationMs: number;
  tracks: CinematicTrack[];
}