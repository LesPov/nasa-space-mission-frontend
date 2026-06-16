export type AnimBinding = string | string[] | null;

export type PlayerActionKey =
  | 'idle' | 'walk' | 'run' | 'jumpStart' | 'jumpLoop' | 'fall' | 'landSoft' | 'landHard'
  | 'climbUp' | 'climbFinish' | 'hangIdle' | 'vault' | 'stepUp' | 'recover' | 'lightOn'
  | 'lightOff' | 'lightPulse' | 'lightFlicker' | 'playVideo' | 'pauseVideo' | 'stopVideo'
  | 'stopBaked' | 'procMove' | 'procRotate';

export interface PlayerSequenceStep {
  id: string;
  action: PlayerActionKey;
  clipOverride: string | null;
  durationMs: number;
  speedRatio: number;
  blend: number;
  loop: boolean;
  allowMovement: boolean;
  lockInput: boolean;
  offsetY: number;
  offsetForward: number;
  procX: number;
  procY: number;
  procZ: number;
}

export interface PlayerClipSequence {
  id: string;
  name: string;
  enabled: boolean;
  repeat: boolean;
  autoPlay?: boolean;
  steps: PlayerSequenceStep[];
}

export interface PlayerAnimationBindings {
  idle: AnimBinding; walk: AnimBinding; run: AnimBinding; jumpStart: AnimBinding;
  jumpLoop: AnimBinding; fall: AnimBinding; landSoft: AnimBinding; landHard: AnimBinding;
  climbUp: AnimBinding; climbFinish: AnimBinding; hangIdle: AnimBinding; vault: AnimBinding;
  stepUp: AnimBinding; recover: AnimBinding; lightOn: AnimBinding; lightOff: AnimBinding;
  lightPulse: AnimBinding; lightFlicker: AnimBinding; playVideo: AnimBinding;
  pauseVideo: AnimBinding; stopVideo: AnimBinding;
  stopBaked: AnimBinding; procMove: AnimBinding; procRotate: AnimBinding;
}

export interface PlayerAnimationEnabled {
  idle: boolean; walk: boolean; run: boolean; jumpStart: boolean; jumpLoop: boolean;
  fall: boolean; landSoft: boolean; landHard: boolean; climbUp: boolean; climbFinish: boolean;
  hangIdle: boolean; vault: boolean; stepUp: boolean; recover: boolean; lightOn: boolean;
  lightOff: boolean; lightPulse: boolean; lightFlicker: boolean; playVideo: boolean;
  pauseVideo: boolean; stopVideo: boolean;
  stopBaked: boolean; procMove: boolean; procRotate: boolean;
}

export interface PlayerMovementConfig {
  walkSpeed: number; runSpeed: number; acceleration: number; rotationSpeed: number;
}

export interface PlayerJumpConfig {
  force: number; gravity: number; maxFallSpeed: number; coyoteTime: number;
  jumpRiseTime: number; jumpFallMultiplier: number;
}

export interface PlayerCameraConfig {
  fpsEyeLevel: number; 
  tpsPivotY: number; 
  tpsRadius: number; 
  tpsMinRadius: number; 
  tpsMaxRadius: number;
  headFollow: boolean;
}

export interface PlayerBlendConfig {
  defaultBlend: number; fastBlend: number; slowBlend: number; noBlend: number;
}

export interface PlayerPhysicsConfig {
  hardLandingThreshold: number; landingRecoveryFrames: number;
}

export interface PlayerDebugConfig {
  showRays: boolean; showCollider: boolean; showState: boolean;
}

// 🔥 NUEVA INTERFAZ PARA LOS MUROS DE NIEBLA VOLUMÉTRICA
export interface FogLevel {
  distance: number;
  height: number;
  opacity: number;
}

export interface PlayerFogConfig {
  enabled: boolean;
  fogMode: 'linear' | 'exp' | 'exp2';
  color: string;
  colorBW: string;

  // Global Background Render Distances
  renderDistanceFPS: number;
  renderDistanceTPS: number;
  renderDistanceFpsBW: number;
  renderDistanceTpsBW: number;

  // 🔥 LOS 5 NIVELES CONFIGURABLES (Muros)
  levelsFPS: FogLevel[];
  levelsTPS: FogLevel[];
  levelsFpsBW: FogLevel[];
  levelsTpsBW: FogLevel[];

  // Compatibilidad antigua (se mantendrán para no romper mapas viejos)
  startFPS?: number; endFPS?: number; startTPS?: number; endTPS?: number;
  densityStartFPS?: number; densityEndFPS?: number; densityStartTPS?: number; densityEndTPS?: number;
  startFpsBW?: number; endFpsBW?: number; startTpsBW?: number; endTpsBW?: number;
  densityStartFpsBW?: number; densityEndFpsBW?: number; densityStartTpsBW?: number; densityEndTpsBW?: number;
}

// Inicialización de los 5 niveles por defecto para que luzca épico desde cero
const defaultFogLevels: FogLevel[] = [
  { distance: 20, height: 10, opacity: 80 },  // Muro cercano (muy denso y bajo)
  { distance: 50, height: 15, opacity: 60 },  // Muro medio
  { distance: 100, height: 25, opacity: 40 }, // Muro lejano
  { distance: 200, height: 40, opacity: 20 }, // Montañas
  { distance: 400, height: 60, opacity: 10 }  // Horizonte
];

export interface PlayerRuntimeConfig {
  movement: PlayerMovementConfig;
  jump: PlayerJumpConfig;
  camera: PlayerCameraConfig;
  blend: PlayerBlendConfig;
  physics: PlayerPhysicsConfig;
  animations: PlayerAnimationBindings;
  animationEnabled: PlayerAnimationEnabled;
  sequences: PlayerClipSequence[];
  debug: PlayerDebugConfig;
  fog: PlayerFogConfig;
}

export const DEFAULT_PLAYER_CONFIG: PlayerRuntimeConfig = {
  movement: { walkSpeed: 0.045, runSpeed: 0.09, acceleration: 0.1, rotationSpeed: 0.1 },
  jump: { force: 0.16, gravity: 0.018, maxFallSpeed: 0.8, coyoteTime: 0.1, jumpRiseTime: 0.18, jumpFallMultiplier: 1.0 },
  camera: { fpsEyeLevel: 1.6, tpsPivotY: 1.5, tpsRadius: 5, tpsMinRadius: 1.5, tpsMaxRadius: 15, headFollow: true },
  blend: { defaultBlend: 0.1, fastBlend: 0.05, slowBlend: 0.15, noBlend: 0 },
  physics: { hardLandingThreshold: 2.5, landingRecoveryFrames: 60 },
  animations: {
    idle: ['idle'], walk: ['walk'], run: ['run'], jumpStart: ['jump start', 'jump'], jumpLoop: ['jump loop', 'jump'],
    fall: ['falling', 'fall'], landSoft: ['land', 'soft landing'], landHard: ['hard landing'], climbUp: ['climb up', 'climb'],
    climbFinish: ['climb finish', 'pull up'], hangIdle: ['hang idle', 'hang'], vault: ['vault'], stepUp: ['step up', 'step'],
    recover: ['recover', 'recovery'], lightOn: null, lightOff: null, lightPulse: null, lightFlicker: null,
    playVideo: null, pauseVideo: null, stopVideo: null,
    stopBaked: null, procMove: null, procRotate: null
  },
  animationEnabled: {
    idle: true, walk: true, run: true, jumpStart: true, jumpLoop: true, fall: true, landSoft: true, landHard: true,
    climbUp: true, climbFinish: true, hangIdle: true, vault: true, stepUp: true, recover: true, lightOn: true,
    lightOff: true, lightPulse: true, lightFlicker: true, playVideo: true, pauseVideo: true, stopVideo: true,
    stopBaked: true, procMove: true, procRotate: true
  },
  sequences: [],
  debug: { showRays: false, showCollider: false, showState: false },
  fog: {
    enabled: false, fogMode: 'linear', color: '#0d1729', colorBW: '#555555',
    renderDistanceFPS: 100000, renderDistanceTPS: 100000,
    renderDistanceFpsBW: 100000, renderDistanceTpsBW: 100000,
    levelsFPS: structuredClone(defaultFogLevels),
    levelsTPS: structuredClone(defaultFogLevels),
    levelsFpsBW: structuredClone(defaultFogLevels),
    levelsTpsBW: structuredClone(defaultFogLevels)
  }
};

export function cloneDefaultPlayerConfig(): PlayerRuntimeConfig {
  return structuredClone(DEFAULT_PLAYER_CONFIG);
}

export function mergePlayerConfig(partial?: Partial<PlayerRuntimeConfig> | null): PlayerRuntimeConfig {
  const base = cloneDefaultPlayerConfig();
  if (!partial) return base;
  return {
    movement: { ...base.movement, ...(partial.movement || {}) },
    jump: { ...base.jump, ...(partial.jump || {}) },
    camera: { 
      ...base.camera, 
      ...(partial.camera || {}),
      tpsMinRadius: partial.camera?.tpsMinRadius ?? base.camera.tpsMinRadius,
      tpsMaxRadius: partial.camera?.tpsMaxRadius ?? base.camera.tpsMaxRadius
    },
    blend: { ...base.blend, ...(partial.blend || {}) },
    physics: { ...base.physics, ...(partial.physics || {}) },
    animations: { ...base.animations, ...(partial.animations || {}) },
    animationEnabled: { ...base.animationEnabled, ...(partial.animationEnabled || {}) },
    sequences: Array.isArray(partial.sequences) ? structuredClone(partial.sequences) : [],
    debug: { ...base.debug, ...(partial.debug || {}) },
    fog: { ...base.fog, ...(partial.fog || {}) }
  };
}

export function normalizeAnimBinding(binding: AnimBinding): string[] {
  if (!binding) return [];
  if (Array.isArray(binding)) return binding.map(v => String(v).trim()).filter(Boolean);
  return [String(binding).trim()].filter(Boolean);
}

function generarIdCorto(): string {
  return 'seq_' + Math.random().toString(36).substring(2, 8);
}

export function createSequenceStep(action: PlayerActionKey = 'idle'): PlayerSequenceStep {
  const isCinematic = action !== 'idle' && action !== 'walk' && action !== 'run' && action !== 'fall';
  return {
    id: generarIdCorto(),
    action, clipOverride: null, durationMs: 1000, speedRatio: 1, blend: 0.08,
    loop: !isCinematic, allowMovement: !isCinematic, lockInput: isCinematic,
    offsetY: 0, offsetForward: 0, procX: 0, procY: 0, procZ: 0
  };
}

export function createPlayerSequence(name = 'Nueva secuencia'): PlayerClipSequence {
  return { id: generarIdCorto(), name, enabled: true, repeat: true, autoPlay: false, steps: [createSequenceStep('idle')] };
}