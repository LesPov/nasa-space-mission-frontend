
import { PlayerActionKey } from './player-config.model';

export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export type CinematicInterpolation = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';

export type CinematicTrackType = 'camera' | 'actor' | 'dialogue' | 'event' | 'overlay' | 'text' | 'image' | 'object' | 'background';

export type CinematicOrientationMode = 'free' | 'lookAt';
export type CinematicMovementMode = 'linear' | 'hold' | 'orbit';
export type CinematicOrbitDirection = 'clockwise' | 'counter_clockwise';

export interface TransformValue {
  position?: Vector3State;
  rotation?: Vector3State;
  fov?: number;
  fadeMode?: 'none' | 'fadeIn' | 'fadeOut' | 'holdBlack'; 
  useLocalSpaceUid?: string;
  
  cameraId?: string; 
  targetUid?: string; 
  orientationMode?: CinematicOrientationMode;
  movementMode?: CinematicMovementMode;
  
  orbitTurns?: number;
  orbitDirection?: CinematicOrbitDirection;

  cameraTargetUid?: string; 
  orbitDegrees?: number; 
}

export interface ActorValue extends TransformValue {
  // Animación estática interpolada
  animationName?: string;
  
  // 🔥 FASE 2: Soporte para Locomoción Integrada (Action Steps)
  action?: PlayerActionKey;
  clipOverride?: string;
}

export interface DialogueValue {
  actorName?: string;
  text?: string;
  audioUrl?: string;
  durationMs?: number;
}

export interface EventValue {
  eventName?: string;
  eventPayload?: any;
}

export interface OverlayValue {
  title?: string;
  text?: string;
  assetId?: number;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  fitMode?: 'CONTAIN' | 'COVER' | 'STRETCH';
  tintColor?: string;
  durationMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  animIn?: 'INSTANT' | 'FADE_IN' | 'SLIDE_UP' | 'SLIDE_DOWN' | 'SLIDE_LEFT' | 'SLIDE_RIGHT' | 'SCALE_IN';
  animOut?: 'INSTANT' | 'FADE_OUT' | 'SLIDE_UP' | 'SLIDE_DOWN' | 'SLIDE_LEFT' | 'SLIDE_RIGHT' | 'SCALE_OUT' | 'ZOOM_THROUGH';
  contentDelayMs?: number;
  contentEarlyOutMs?: number; 
  contentFadeInMs?: number;
  contentFadeOutMs?: number;
  contentAnimIn?: 'INSTANT' | 'FADE_IN' | 'SLIDE_UP' | 'SLIDE_DOWN' | 'SLIDE_LEFT' | 'SLIDE_RIGHT' | 'SCALE_IN';
  contentAnimOut?: 'INSTANT' | 'FADE_OUT' | 'SLIDE_UP' | 'SLIDE_DOWN' | 'SLIDE_LEFT' | 'SLIDE_RIGHT' | 'SCALE_OUT' | 'ZOOM_THROUGH';
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'Normal' | 'Medium' | 'Bold' | 'Black';
  fontStyle?: 'Normal' | 'Italic';
  textAlign?: 'left' | 'center' | 'right';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  letterSpacing?: number;
  lineHeight?: number;
  color?: string;
  secondaryColor?: string;
  opacity?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  outlineEnabled?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  fullscreenBg?: boolean; 
  bgType?: 'NONE' | 'SOLID' | 'TRANSPARENT' | 'BORDER_ONLY' | 'RADIAL_GRADIENT' | 'GRADIENT';
  bgColor?: string;
  bgCenterOpacity?: number; 
  gradientColorB?: string;
  gradientDirection?: 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'RADIAL';
  bgOpacity?: number;
  bgRadius?: number; 
  bgCenterX?: number; 
  bgCenterY?: number; 
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  paddingX?: number;
  paddingY?: number;
  width?: number; 
  height?: number; 
  positionX?: number; 
  positionY?: number; 
  anchor?: 'TOP_LEFT' | 'TOP_CENTER' | 'TOP_RIGHT' | 'CENTER_LEFT' | 'CENTER' | 'CENTER_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_CENTER' | 'BOTTOM_RIGHT';
  zIndex?: number;
  scale?: number;
  rotation?: number; 
  subtitle?: string;
  icon?: string;
  logo?: string;
  fade?: 'fadeIn' | 'fadeOut' | 'none';
  align?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  position?: { x: number, y: number };
  visualStyle?: string;
}

export interface CinematicKeyframe<T = any> {
  id: string;
  timeMs: number;
  value: T;
  interpolation: CinematicInterpolation;
}

export interface CinematicTrack<T = any> {
  id: string;
  name: string;
  description?: string;
  type: CinematicTrackType;
  
  targetUid?: string; 
  cameraId?: string; 
  orientationMode?: 'free' | 'lookAt' | 'orbit';
  
  keyframes: CinematicKeyframe<T>[];
}

export interface CinematicSequence {
  id: string;
  name: string;
  durationMs: number;
  tracks: CinematicTrack[];
}