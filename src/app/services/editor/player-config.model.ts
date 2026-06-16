
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

export interface PlayerFogConfig {
  enabled: boolean;
  fogMode: 'linear' | 'exp' | 'exp2';
  fogShape: 'sphere' | 'cylinder'; 
  density: number;

  offsetXFPS: number; offsetYFPS: number; offsetZFPS: number;
  offsetXTPS: number; offsetYTPS: number; offsetZTPS: number;
  
  // 🔥 COLORES NORMALES (4 ETAPAS / 4 ANILLOS)
  colorStart: string;
  colorMedio1: string;
  colorMedio2: string;
  colorEnd: string;
  
  fogHeightYStartFPS: number; fogHeightYMedio1FPS: number; fogHeightYMedio2FPS: number; fogHeightYEndFPS: number;
  fogFalloffYStartFPS: number; fogFalloffYMedio1FPS: number; fogFalloffYMedio2FPS: number; fogFalloffYEndFPS: number;
  
  fogHeightYStartTPS: number; fogHeightYMedio1TPS: number; fogHeightYMedio2TPS: number; fogHeightYEndTPS: number;
  fogFalloffYStartTPS: number; fogFalloffYMedio1TPS: number; fogFalloffYMedio2TPS: number; fogFalloffYEndTPS: number;

  startFPS: number; medio1FPS: number; medio2FPS: number; endFPS: number;
  startTPS: number; medio1TPS: number; medio2TPS: number; endTPS: number;
  renderDistanceFPS: number; renderDistanceTPS: number;
  
  densityStartFPS: number; densityMedio1FPS: number; densityMedio2FPS: number; densityEndFPS: number;
  densityStartTPS: number; densityMedio1TPS: number; densityMedio2TPS: number; densityEndTPS: number;

  // 🔥 COLORES BLANCO Y NEGRO (4 ETAPAS / 4 ANILLOS)
  colorStartBW: string;
  colorMedio1BW: string;
  colorMedio2BW: string;
  colorEndBW: string;
  
  fogHeightYStartFpsBW: number; fogHeightYMedio1FpsBW: number; fogHeightYMedio2FpsBW: number; fogHeightYEndFpsBW: number;
  fogFalloffYStartFpsBW: number; fogFalloffYMedio1FpsBW: number; fogFalloffYMedio2FpsBW: number; fogFalloffYEndFpsBW: number;

  fogHeightYStartTpsBW: number; fogHeightYMedio1TpsBW: number; fogHeightYMedio2TpsBW: number; fogHeightYEndTpsBW: number;
  fogFalloffYStartTpsBW: number; fogFalloffYMedio1TpsBW: number; fogFalloffYMedio2TpsBW: number; fogFalloffYEndTpsBW: number;

  startFpsBW: number; medio1FpsBW: number; medio2FpsBW: number; endFpsBW: number;
  startTpsBW: number; medio1TpsBW: number; medio2TpsBW: number; endTpsBW: number;
  renderDistanceFpsBW: number; renderDistanceTpsBW: number;
  
  densityStartFpsBW: number; densityMedio1FpsBW: number; densityMedio2FpsBW: number; densityEndFpsBW: number;
  densityStartTpsBW: number; densityMedio1TpsBW: number; densityMedio2TpsBW: number; densityEndTpsBW: number;

  // Legacy variables for backward compatibility
  color?: string; colorBW?: string; 
  colorMedio?: string; colorMedioBW?: string;
  medioFPS?: number; medioTPS?: number; medioFpsBW?: number; medioTpsBW?: number;
  densityMedioFPS?: number; densityMedioTPS?: number; densityMedioFpsBW?: number; densityMedioTpsBW?: number;
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
    enabled: false, fogMode: 'linear', fogShape: 'cylinder', density: 0.01,
    offsetXFPS: 0, offsetYFPS: 0, offsetZFPS: 0, offsetXTPS: 0, offsetYTPS: 0, offsetZTPS: 0,
    
    colorStart: '#0d1729', colorMedio1: '#0d1729', colorMedio2: '#0d1729', colorEnd: '#0d1729',
    
    fogHeightYStartFPS: 4.0, fogHeightYMedio1FPS: 6.0, fogHeightYMedio2FPS: 8.0, fogHeightYEndFPS: 10.0,
    fogFalloffYStartFPS: 1.5, fogFalloffYMedio1FPS: 2.0, fogFalloffYMedio2FPS: 2.5, fogFalloffYEndFPS: 3.0,
    
    fogHeightYStartTPS: 4.0, fogHeightYMedio1TPS: 6.0, fogHeightYMedio2TPS: 8.0, fogHeightYEndTPS: 10.0,
    fogFalloffYStartTPS: 1.5, fogFalloffYMedio1TPS: 2.0, fogFalloffYMedio2TPS: 2.5, fogFalloffYEndTPS: 3.0,
    
    startFPS: 5, medio1FPS: 15, medio2FPS: 30, endFPS: 50,
    startTPS: 5, medio1TPS: 20, medio2TPS: 40, endTPS: 60,
    renderDistanceFPS: 100000, renderDistanceTPS: 100000,
    
    densityStartFPS: 0, densityMedio1FPS: 30, densityMedio2FPS: 60, densityEndFPS: 100,
    densityStartTPS: 0, densityMedio1TPS: 30, densityMedio2TPS: 60, densityEndTPS: 100,
    
    colorStartBW: '#555555', colorMedio1BW: '#555555', colorMedio2BW: '#555555', colorEndBW: '#555555',
    
    fogHeightYStartFpsBW: 4.0, fogHeightYMedio1FpsBW: 6.0, fogHeightYMedio2FpsBW: 8.0, fogHeightYEndFpsBW: 10.0,
    fogFalloffYStartFpsBW: 1.5, fogFalloffYMedio1FpsBW: 2.0, fogFalloffYMedio2FpsBW: 2.5, fogFalloffYEndFpsBW: 3.0,
    
    fogHeightYStartTpsBW: 4.0, fogHeightYMedio1TpsBW: 6.0, fogHeightYMedio2TpsBW: 8.0, fogHeightYEndTpsBW: 10.0,
    fogFalloffYStartTpsBW: 1.5, fogFalloffYMedio1TpsBW: 2.0, fogFalloffYMedio2TpsBW: 2.5, fogFalloffYEndTpsBW: 3.0,
    
    startFpsBW: 5, medio1FpsBW: 15, medio2FpsBW: 30, endFpsBW: 50,
    startTpsBW: 5, medio1TpsBW: 20, medio2TpsBW: 40, endTpsBW: 60,
    renderDistanceFpsBW: 100000, renderDistanceTpsBW: 100000,
    
    densityStartFpsBW: 0, densityMedio1FpsBW: 30, densityMedio2FpsBW: 60, densityEndFpsBW: 100,
    densityStartTpsBW: 0, densityMedio1TpsBW: 30, densityMedio2TpsBW: 60, densityEndTpsBW: 100
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