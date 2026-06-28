

export type VisualMode = 'normal' | 'bw';

export interface WorldSettings {
  visualMode: VisualMode;
  clearColor: string;
  clearColorBW: string;
  gravityY: number;
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
  requisitos: string[]; // 🔥 ADDED: Permisos para entrar
}

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  visualMode: 'normal',
  clearColor: '#0d1729',
  clearColorBW: '#555555',
  gravityY: -0.25,
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
  requisitos: [] // 🔥 ADDED
};
