import { Vector3Dto } from '../models/api-dto.model';

export type VisualMode = 'normal' | 'bw';

export type GravityPreset = 'earth' | 'mars' | 'moon' | 'zero_g' | 'custom';

export interface GravityDefinition {
  preset: GravityPreset;
  magnitude: number; // En m/s² (Tierra = 9.81, Marte = 3.71, Luna = 1.62, 0G = 0.0)
  direction: Vector3Dto;
  babylonScale: number; // Factor de conversión a unidades Babylon
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

export interface WorldSettings {
  visualMode: VisualMode;
  clearColor: string;
  clearColorBW: string;
  gravityY: number; // Compatibilidad legacy Babylon
  gravityPreset: GravityPreset;
  gravityMagnitude: number; // m/s²
  gravityVector: Vector3Dto;
  ambientIntensity: number;
  ambientDiffuse: string;
  ambientGround: string;
  ambientDirX: number;
  ambientDirY: number;
  ambientDirZ: number;
  logicSettings?: any;
}

export interface MissionUiSettings {
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
  ambientDirZ: 0
};

export const DEFAULT_MISSION_UI_SETTINGS: MissionUiSettings = {
  primaryColor: '#ef4444',
  bgColor: '#0f172a',
  bgOpacity: 0.85,
  overlayColor: '#050508',
  overlayOpacity: 0.7,
  blurIntensity: 8,
  borderRadius: 12,
  textColor: '#cbd5e1',
  loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
  loreAuthor: 'Anónimo',
  initialSequence: '',
  objetivos: [],
  recompensas: [],
  requisitos: []
};