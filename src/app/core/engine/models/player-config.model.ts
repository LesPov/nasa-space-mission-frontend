// file: src/app/core/engine/models/player-config.model.ts
export type AnimBinding = string | string[] | null;

export interface GameCondition {
  type: 'var_eq' | 'var_neq' | 'has_item' | 'missing_item' | 'role_eq';
  key: string;
  value?: string | number | boolean;
  scope?: string;
}

export interface GameStateMutation {
  type: 'set_var' | 'add_item' | 'remove_item';
  key: string;
  value?: string | number | boolean;
  scope?: string;
}

export type PlayerActionKey =
  | 'idle' | 'walk' | 'run' | 'jumpStart' | 'jumpLoop' | 'fall' | 'landSoft' | 'landHard'
  | 'climbUp' | 'climbFinish' | 'hangIdle' | 'vault' | 'stepUp' | 'recover' | 'lightOn'
  | 'lightOff' | 'lightPulse' | 'lightFlicker' | 'playVideo' | 'pauseVideo' | 'stopVideo'
  | 'stopBaked' | 'procMove' | 'procRotate' | 'setState' | 'checkCondition';

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
  conditions?: GameCondition[];
  stateMutations?: GameStateMutation[];
  stateKey?: string;
  stateValue?: string | number | boolean;
}

export interface PlayerClipSequence {
  id: string;
  name: string;
  enabled: boolean;
  repeat: boolean;
  autoPlay?: boolean;
  conditions?: GameCondition[];
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
  setState: AnimBinding; checkCondition: AnimBinding;
}

export interface PlayerAnimationEnabled {
  idle: boolean; walk: boolean; run: boolean; jumpStart: boolean; jumpLoop: boolean;
  fall: boolean; landSoft: boolean; landHard: boolean; climbUp: boolean; climbFinish: boolean;
  hangIdle: boolean; vault: boolean; stepUp: boolean; recover: boolean; lightOn: boolean;
  lightOff: boolean; lightPulse: boolean; lightFlicker: boolean; playVideo: boolean;
  pauseVideo: boolean; stopVideo: boolean;
  stopBaked: boolean; procMove: boolean; procRotate: boolean;
  setState: boolean; checkCondition: boolean;
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

export interface FogLevel {
  distance: number;
  height: number;
  opacity: number;
  thickness: number; 
  offsetY: number;
  color?: string; 
  layerOpacities?: number[]; 
  layerHeights?: number[]; 
}

const defaultFogLevels: FogLevel[] = [
  { distance: 15, height: 10, opacity: 15, thickness: 15, offsetY: 0, layerOpacities: [5, 35, 100, 100, 35, 5], layerHeights: [100, 100, 100, 100, 100, 100] },
  { distance: 45, height: 25, opacity: 50, thickness: 30, offsetY: 0, layerOpacities: [5, 35, 100, 100, 35, 5], layerHeights: [100, 100, 100, 100, 100, 100] },
  { distance: 90, height: 60, opacity: 100, thickness: 60, offsetY: 0, layerOpacities: [5, 35, 100, 100, 35, 5], layerHeights: [100, 100, 100, 100, 100, 100] }
];

export interface PlayerFogConfig {
  enabled: boolean;
  fogMode: 'linear' | 'exp' | 'exp2';
  color: string;
  colorBW: string;
  fogShape?: 'cylinder' | 'sphere'; 

  renderDistanceFPS: number;
  renderDistanceTPS: number;
  renderDistanceFpsBW: number;
  renderDistanceTpsBW: number;

  levelsFPS: FogLevel[];
  levelsTPS: FogLevel[];
  levelsFpsBW: FogLevel[];
  levelsTpsBW: FogLevel[];

  startFPS?: number; endFPS?: number; startTPS?: number; endTPS?: number;
  densityStartFPS?: number; densityEndFPS?: number; densityStartTPS?: number; densityEndTPS?: number;
  startFpsBW?: number; endFpsBW?: number; startTpsBW?: number; endTpsBW?: number;
  densityStartFpsBW?: number; densityEndFpsBW?: number; densityStartTpsBW?: number; densityEndTpsBW?: number;

  fogHeightYStartFPS?: number; fogHeightYStartTPS?: number; fogHeightYStartFpsBW?: number; fogHeightYStartTpsBW?: number;
  fogHeightYEndFPS?: number; fogHeightYEndTPS?: number; fogHeightYEndFpsBW?: number; fogHeightYEndTpsBW?: number;

  offsetXFPS?: number; offsetYFPS?: number; offsetZFPS?: number;
  offsetXTPS?: number; offsetYTPS?: number; offsetZTPS?: number;
}

export interface PlayerCullingConfig {
  enabled: boolean;
  cullDistance: number;
  fadeMargin: number;
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
  culling: PlayerCullingConfig;
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
    stopBaked: null, procMove: null, procRotate: null, setState: null, checkCondition: null
  },
  animationEnabled: {
    idle: true, walk: true, run: true, jumpStart: true, jumpLoop: true, fall: true, landSoft: true, landHard: true,
    climbUp: true, climbFinish: true, hangIdle: true, vault: true, stepUp: true, recover: true, lightOn: true,
    lightOff: true, lightPulse: true, lightFlicker: true, playVideo: true, pauseVideo: true, stopVideo: true,
    stopBaked: true, procMove: true, procRotate: true, setState: true, checkCondition: true
  },
  sequences: [],
  debug: { showRays: false, showCollider: false, showState: false },
  fog: {
    enabled: false, fogMode: 'linear', color: '#0d1729', colorBW: '#555555',
    renderDistanceFPS: 150, renderDistanceTPS: 150,
    renderDistanceFpsBW: 150, renderDistanceTpsBW: 150,
    levelsFPS: structuredClone(defaultFogLevels),
    levelsTPS: structuredClone(defaultFogLevels),
    levelsFpsBW: structuredClone(defaultFogLevels),
    levelsTpsBW: structuredClone(defaultFogLevels)
  },
  culling: { enabled: true, cullDistance: 150, fadeMargin: 30 }
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
    fog: { ...base.fog, ...(partial.fog || {}) },
    culling: { ...base.culling, ...(partial.culling || {}) }
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
  // Solo se bloquea el input por defecto en acciones de animación física explícita del personaje
  const isCharacterPhysicalAction = ['climbUp', 'climbFinish', 'vault', 'stepUp', 'recover'].includes(action);
  return {
    id: generarIdCorto(),
    action,
    clipOverride: null,
    durationMs: 1000,
    speedRatio: 1,
    blend: 0.08,
    loop: !isCharacterPhysicalAction,
    allowMovement: !isCharacterPhysicalAction,
    lockInput: isCharacterPhysicalAction, // Jamás bloquea input en luces ni props
    offsetY: 0,
    offsetForward: 0,
    procX: 0,
    procY: 0,
    procZ: 0,
    conditions: [],
    stateMutations: []
  };
}

export function createPlayerSequence(name = 'Nueva secuencia'): PlayerClipSequence {
  return { id: generarIdCorto(), name, enabled: true, repeat: true, autoPlay: false, conditions: [], steps: [createSequenceStep('idle')] };
}