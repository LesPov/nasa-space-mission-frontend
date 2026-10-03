// RUTA: src/app/core/engine/world/world-settings.model.ts
// ACCIÓN: MODIFICAR

import { Vector3Dto } from '../models/api-dto.model';

export type VisualMode = 'normal' | 'bw';

export type GravityPreset = 'earth' | 'mars' | 'moon' | 'zero_g' | 'custom';

export interface GravityDefinition {
  preset: GravityPreset;
  magnitude: number;
  direction: Vector3Dto;
  babylonScale: number;
}

export const GRAVITY_PRESETS: Record<GravityPreset, GravityDefinition> = {
  earth: {
    preset: 'earth',
    magnitude: 9.81,
    direction: { x: 0, y: -1, z: 0 },
    babylonScale: -0.25
  },
  mars: {
    preset: 'mars',
    magnitude: 3.71,
    direction: { x: 0, y: -1, z: 0 },
    babylonScale: -0.0945
  },
  moon: {
    preset: 'moon',
    magnitude: 1.62,
    direction: { x: 0, y: -1, z: 0 },
    babylonScale: -0.0413
  },
  zero_g: {
    preset: 'zero_g',
    magnitude: 0.0,
    direction: { x: 0, y: 0, z: 0 },
    babylonScale: 0.0
  },
  custom: {
    preset: 'custom',
    magnitude: 9.81,
    direction: { x: 0, y: -1, z: 0 },
    babylonScale: -0.25
  }
};

/**
 * Constantes de calibración de sensibilidad para la cámara del Editor 3D.
 * Centraliza los factores base de Babylon.js para desacoplarlos de valores mágicos.
 */
export const EDITOR_CAMERA_CALIBRATION = {
  // Órbita: Base de sensibilidad angular (Babylon: menor divisor = mayor rotación)
  ORBIT_BASE_DIVISOR: 2200,

  // Zoom: Rango dinámico de wheelPrecision adaptativo
  // Disminuido para permitir un desplazamiento longitudinal ágil sin fatiga de scroll
  ZOOM_MIN_PRECISION: 1.2,
  ZOOM_BASE_MULTIPLIER: 4.8,

  // Pan: Reducción de resistencia en px para acompañar el cursor
  PAN_MIN_SENSIBILITY: 8.0,
  PAN_BASE_SCALE: 48.0,

  // Límites globales de sliders
  SLIDER_MIN: 0.2,
  SLIDER_MAX: 10.0,
  SLIDER_STEP: 0.05
};

export interface EditorCameraSettings {
  orbitSensitivity: number;  // Multiplicador de rotación (Base 1.0)
  zoomSensitivity: number;   // Multiplicador de zoom por rueda (Base equilibrada)
  panSensitivity: number;    // Multiplicador de paneo con click derecho (Base equilibrada)
  navigationSpeed: number;   // Multiplicador de vuelo/desplazamiento general
  minDistance: number;       // Distancia mínima de acercamiento (zoom in)
  maxDistance: number;       // Distancia máxima de alejamiento (zoom out)
  inertia: number;           // Inercia de frenado (0.0 a 0.95)
}

export const DEFAULT_EDITOR_CAMERA_SETTINGS: EditorCameraSettings = {
  orbitSensitivity: 1.0,
  zoomSensitivity: 1.35,
  panSensitivity: 1.4,
  navigationSpeed: 1.0,
  minDistance: 0.5,
  maxDistance: 2500,
  inertia: 0.72
};

export interface WorldSettings {
  visualMode: VisualMode;
  clearColor: string;
  clearColorBW: string;
  gravityY: number;
  gravityPreset: GravityPreset;
  gravityMagnitude: number;
  gravityVector: Vector3Dto;
  ambientIntensity: number;
  ambientDiffuse: string;
  ambientGround: string;
  ambientDirX: number;
  ambientDirY: number;
  ambientDirZ: number;
  logicSettings?: any;
  editorCameraSettings?: EditorCameraSettings;
}

export interface MissionUiSettings {
  missionTitle: string;
  missionDescription: string;
  primaryColor: string;
  bgColor: string;
  bgOpacity: number;
  overlayColor: string;
  overlayOpacity: number;
  blurIntensity: number;
  borderRadius: number;
  textColor: string;
  loreQuote: string;
  loreAuthor: string;
  initialSequence: string;
  objetivos: string[];
  recompensas: string[];
  requisitos: string[];
}

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  visualMode: 'normal',
  clearColor: '#0d1729',
  clearColorBW: '#555555',
  gravityY: -0.25,
  gravityPreset: 'earth',
  gravityMagnitude: 9.81,
  gravityVector: { x: 0, y: -1, z: 0 },
  ambientIntensity: 0.6,
  ambientDiffuse: '#ffffff',
  ambientGround: '#333333',
  ambientDirX: 0,
  ambientDirY: 1,
  ambientDirZ: 0,
  editorCameraSettings: { ...DEFAULT_EDITOR_CAMERA_SETTINGS }
};

export const DEFAULT_MISSION_UI_SETTINGS: MissionUiSettings = {
  missionTitle: 'Operación Desconocida',
  missionDescription: 'Explora esta zona y descubre sus secretos.',
  primaryColor: '#ef4444',
  bgColor: '#0f172a',
  bgOpacity: 0.85,
  overlayColor: '#050508',
  overlayOpacity: 0.7,
  blurIntensity: 8,
  borderRadius: 12,
  textColor: '#cbd5e1',
  loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
  loreAuthor: 'Control de Misión',
  initialSequence: '',
  objetivos: [],
  recompensas: [],
  requisitos: []
};