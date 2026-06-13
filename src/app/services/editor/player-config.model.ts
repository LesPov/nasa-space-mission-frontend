export type AnimBinding = string | string[] | null;

export type PlayerActionKey =
  | 'idle' | 'walk' | 'run' | 'jumpStart' | 'jumpLoop' | 'fall' | 'landSoft' | 'landHard'
  | 'climbUp' | 'climbFinish' | 'hangIdle' | 'vault' | 'stepUp' | 'recover' | 'lightOn'
  | 'lightOff' | 'lightPulse' | 'lightFlicker' | 'playVideo' | 'pauseVideo' | 'stopVideo';

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
}

export interface PlayerClipSequence {
  id: string;
  name: string;
  enabled: boolean;
  repeat: boolean;
  steps: PlayerSequenceStep[];
}

export interface PlayerAnimationBindings {
  idle: AnimBinding; walk: AnimBinding; run: AnimBinding; jumpStart: AnimBinding;
  jumpLoop: AnimBinding; fall: AnimBinding; landSoft: AnimBinding; landHard: AnimBinding;
  climbUp: AnimBinding; climbFinish: AnimBinding; hangIdle: AnimBinding; vault: AnimBinding;
  stepUp: AnimBinding; recover: AnimBinding; lightOn: AnimBinding; lightOff: AnimBinding;
  lightPulse: AnimBinding; lightFlicker: AnimBinding; playVideo: AnimBinding;
  pauseVideo: AnimBinding; stopVideo: AnimBinding;
}

export interface PlayerAnimationEnabled {
  idle: boolean; walk: boolean; run: boolean; jumpStart: boolean; jumpLoop: boolean;
  fall: boolean; landSoft: boolean; landHard: boolean; climbUp: boolean; climbFinish: boolean;
  hangIdle: boolean; vault: boolean; stepUp: boolean; recover: boolean; lightOn: boolean;
  lightOff: boolean; lightPulse: boolean; lightFlicker: boolean; playVideo: boolean;
  pauseVideo: boolean; stopVideo: boolean;
}

export interface PlayerMovementConfig {
  walkSpeed: number; runSpeed: number; acceleration: number; rotationSpeed: number;
}

export interface PlayerJumpConfig {
  force: number; gravity: number; maxFallSpeed: number; coyoteTime: number;
  jumpRiseTime: number; jumpFallMultiplier: number;
}

export interface PlayerCameraConfig {
  fpsEyeLevel: number; tpsPivotY: number; tpsRadius: number; headFollow: boolean;
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

export interface PlayerFogConfig {
  enabled: boolean;
  fogMode: 'linear' | 'exp' | 'exp2';
  color: string;
  startFPS: number;
  endFPS: number;
  startTPS: number;
  endTPS: number;
  renderDistanceFPS: number;
  renderDistanceTPS: number;
  
  // 🔥 Densidades MODO NORMAL
  densityStartFPS: number;
  densityEndFPS: number;
  densityStartTPS: number;
  densityEndTPS: number;

  colorBW: string;
  startFpsBW: number;
  endFpsBW: number;
  startTpsBW: number;
  endTpsBW: number;
  renderDistanceFpsBW: number;
  renderDistanceTpsBW: number;
  
  // 🔥 Densidades MODO BLANCO Y NEGRO
  densityStartFpsBW: number;
  densityEndFpsBW: number;
  densityStartTpsBW: number;
  densityEndTpsBW: number;

  // Legacy variables (por si hay mapas viejos guardados)
  densityFPS?: number;
  densityTPS?: number;
  densityFpsBW?: number;
  densityTpsBW?: number;
  densityFps?: number;
  densityTps?: number;
  density?: number;
  densityBW?: number;
}

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
  camera: { fpsEyeLevel: 1.6, tpsPivotY: 1.5, tpsRadius: 5, headFollow: true },
  blend: { defaultBlend: 0.1, fastBlend: 0.05, slowBlend: 0.15, noBlend: 0 },
  physics: { hardLandingThreshold: 2.5, landingRecoveryFrames: 60 },
  animations: {
    idle: ['idle'], walk: ['walk'], run: ['run'], jumpStart: ['jump start', 'jump'], jumpLoop: ['jump loop', 'jump'],
    fall: ['falling', 'fall'], landSoft: ['land', 'soft landing'], landHard: ['hard landing'], climbUp: ['climb up', 'climb'],
    climbFinish: ['climb finish', 'pull up'], hangIdle: ['hang idle', 'hang'], vault: ['vault'], stepUp: ['step up', 'step'],
    recover: ['recover', 'recovery'], lightOn: null, lightOff: null, lightPulse: null, lightFlicker: null,
    playVideo: null, pauseVideo: null, stopVideo: null
  },
  animationEnabled: {
    idle: true, walk: true, run: true, jumpStart: true, jumpLoop: true, fall: true, landSoft: true, landHard: true,
    climbUp: true, climbFinish: true, hangIdle: true, vault: true, stepUp: true, recover: true, lightOn: true,
    lightOff: true, lightPulse: true, lightFlicker: true, playVideo: true, pauseVideo: true, stopVideo: true
  },
  sequences: [],
  debug: { showRays: false, showCollider: false, showState: false },
  fog: {
    enabled: false,
    fogMode: 'linear',
    color: '#0d1729',
    startFPS: 0,
    endFPS: 80,
    startTPS: 5,
    endTPS: 120,
    renderDistanceFPS: 150,
    renderDistanceTPS: 200,
    densityStartFPS: 0,
    densityEndFPS: 100,
    densityStartTPS: 0,
    densityEndTPS: 100,
    
    colorBW: '#555555',
    startFpsBW: 0,
    endFpsBW: 60,
    startTpsBW: 5,
    endTpsBW: 90,
    renderDistanceFpsBW: 100,
    renderDistanceTpsBW: 150,
    densityStartFpsBW: 0,
    densityEndFpsBW: 100,
    densityStartTpsBW: 0,
    densityEndTpsBW: 100
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
    camera: { ...base.camera, ...(partial.camera || {}) },
    blend: { ...base.blend, ...(partial.blend || {}) },
    physics: { ...base.physics, ...(partial.physics || {}) },
    animations: { ...base.animations, ...(partial.animations || {}) },
    animationEnabled: { ...base.animationEnabled, ...(partial.animationEnabled || {}) },
    sequences: Array.isArray(partial.sequences) ? structuredClone(partial.sequences) : [],
    debug: { ...base.debug, ...(partial.debug || {}) },
    fog: {
      ...base.fog,
      ...(partial.fog || {}),
      renderDistanceFPS: partial.fog?.renderDistanceFPS ?? base.fog.renderDistanceFPS,
      renderDistanceTPS: partial.fog?.renderDistanceTPS ?? base.fog.renderDistanceTPS,
      renderDistanceFpsBW: partial.fog?.renderDistanceFpsBW ?? base.fog.renderDistanceFpsBW,
      renderDistanceTpsBW: partial.fog?.renderDistanceTpsBW ?? base.fog.renderDistanceTpsBW,
      
      densityStartFPS: partial.fog?.densityStartFPS ?? base.fog.densityStartFPS,
      densityEndFPS: partial.fog?.densityEndFPS ?? base.fog.densityEndFPS,
      densityStartTPS: partial.fog?.densityStartTPS ?? base.fog.densityStartTPS,
      densityEndTPS: partial.fog?.densityEndTPS ?? base.fog.densityEndTPS,
      
      densityStartFpsBW: partial.fog?.densityStartFpsBW ?? base.fog.densityStartFpsBW,
      densityEndFpsBW: partial.fog?.densityEndFpsBW ?? base.fog.densityEndFpsBW,
      densityStartTpsBW: partial.fog?.densityStartTpsBW ?? base.fog.densityStartTpsBW,
      densityEndTpsBW: partial.fog?.densityEndTpsBW ?? base.fog.densityEndTpsBW,
    }
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
    action,
    clipOverride: null,
    durationMs: 1000,
    speedRatio: 1,
    blend: 0.08,
    loop: !isCinematic,
    allowMovement: !isCinematic,
    lockInput: isCinematic,
    offsetY: 0,
    offsetForward: 0
  };
}

export function createPlayerSequence(name = 'Nueva secuencia'): PlayerClipSequence {
  return { id: generarIdCorto(), name, enabled: true, repeat: true, steps: [createSequenceStep('idle')] };
}