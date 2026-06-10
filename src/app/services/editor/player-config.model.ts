export type AnimBinding = string | string[] | null;

export type PlayerActionKey =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jumpStart'
  | 'jumpLoop'
  | 'fall'
  | 'landSoft'
  | 'landHard'
  | 'climbUp'
  | 'climbFinish'
  | 'hangIdle'
  | 'vault'
  | 'stepUp'
  | 'recover';

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
}

export interface PlayerClipSequence {
  id: string;
  name: string;
  enabled: boolean;
  repeat: boolean;
  steps: PlayerSequenceStep[];
}

export interface PlayerAnimationBindings {
  idle: AnimBinding;
  walk: AnimBinding;
  run: AnimBinding;
  jumpStart: AnimBinding;
  jumpLoop: AnimBinding;
  fall: AnimBinding;
  landSoft: AnimBinding;
  landHard: AnimBinding;
  climbUp: AnimBinding;
  climbFinish: AnimBinding;
  hangIdle: AnimBinding;
  vault: AnimBinding;
  stepUp: AnimBinding;
  recover: AnimBinding;
}

export interface PlayerAnimationEnabled {
  idle: boolean;
  walk: boolean;
  run: boolean;
  jumpStart: boolean;
  jumpLoop: boolean;
  fall: boolean;
  landSoft: boolean;
  landHard: boolean;
  climbUp: boolean;
  climbFinish: boolean;
  hangIdle: boolean;
  vault: boolean;
  stepUp: boolean;
  recover: boolean;
}

export interface PlayerMovementConfig {
  walkSpeed: number;
  runSpeed: number;
  acceleration: number;
  rotationSpeed: number;
}

export interface PlayerJumpConfig {
  force: number;
  gravity: number;
  maxFallSpeed: number;
  coyoteTime: number;
  jumpRiseTime: number;
  jumpFallMultiplier: number;
}

export interface PlayerClimbConfig {
  enabled: boolean;
  minHeight: number;
  maxHeight: number;
  forwardMultiplier: number;
  climbUpForwardMultiplier: number;
  climbDuration: number;
  pullUpDuration: number;
  postClimbLockFrames: number;
  hangOffsetY: number;
  upOffsetY: number;
  topOffsetY: number;
}

export interface PlayerCameraConfig {
  fpsEyeLevel: number;
  tpsPivotY: number;
  tpsRadius: number;
  headFollow: boolean;
}

export interface PlayerBlendConfig {
  defaultBlend: number;
  fastBlend: number;
  slowBlend: number;
  noBlend: number;
}

export interface PlayerPhysicsConfig {
  hardLandingThreshold: number;
  landingRecoveryFrames: number;
  climbRayReach: number;
}

export interface PlayerDebugConfig {
  showRays: boolean;
  showCollider: boolean;
  showState: boolean;
}

export interface PlayerRuntimeConfig {
  movement: PlayerMovementConfig;
  jump: PlayerJumpConfig;
  climb: PlayerClimbConfig;
  camera: PlayerCameraConfig;
  blend: PlayerBlendConfig;
  physics: PlayerPhysicsConfig;
  animations: PlayerAnimationBindings;
  animationEnabled: PlayerAnimationEnabled;
  sequences: PlayerClipSequence[];
  debug: PlayerDebugConfig;
}

export const DEFAULT_PLAYER_CONFIG: PlayerRuntimeConfig = {
  movement: {
    walkSpeed: 0.045,
    runSpeed: 0.09,
    acceleration: 0.1,
    rotationSpeed: 0.1
  },
  jump: {
    force: 0.16,
    gravity: 0.018,
    maxFallSpeed: 0.8,
    coyoteTime: 0.1,
    jumpRiseTime: 0.18,
    jumpFallMultiplier: 1.0
  },
  climb: {
    enabled: true,
    minHeight: 0.25,
    maxHeight: 4.0,
    forwardMultiplier: 0.42,
    climbUpForwardMultiplier: 0.16,
    climbDuration: 66,
    pullUpDuration: 40,
    postClimbLockFrames: 40,
    hangOffsetY: 1.05,
    upOffsetY: 0.58,
    topOffsetY: 0.003
  },
  camera: {
    fpsEyeLevel: 1.6,
    tpsPivotY: 1.5,
    tpsRadius: 5,
    headFollow: true
  },
  blend: {
    defaultBlend: 0.1,
    fastBlend: 0.05,
    slowBlend: 0.15,
    noBlend: 0
  },
  physics: {
    hardLandingThreshold: 2.5,
    landingRecoveryFrames: 60,
    climbRayReach: 2.5
  },
  animations: {
    idle: ['idle'],
    walk: ['walk'],
    run: ['run'],
    jumpStart: ['jump start', 'jump'],
    jumpLoop: ['jump loop', 'jump'],
    fall: ['falling', 'fall'],
    landSoft: ['land', 'soft landing'],
    landHard: ['hard landing'],
    climbUp: ['climb up', 'climb'],
    climbFinish: ['climb finish', 'pull up'],
    hangIdle: ['hang idle', 'hang'],
    vault: ['vault'],
    stepUp: ['step up', 'step'],
    recover: ['recover', 'recovery']
  },
  animationEnabled: {
    idle: true,
    walk: true,
    run: true,
    jumpStart: true,
    jumpLoop: true,
    fall: true,
    landSoft: true,
    landHard: true,
    climbUp: true,
    climbFinish: true,
    hangIdle: true,
    vault: true,
    stepUp: true,
    recover: true
  },
  sequences: [],
  debug: {
    showRays: false,
    showCollider: false,
    showState: false
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
    climb: { ...base.climb, ...(partial.climb || {}) },
    camera: { ...base.camera, ...(partial.camera || {}) },
    blend: { ...base.blend, ...(partial.blend || {}) },
    physics: { ...base.physics, ...(partial.physics || {}) },
    animations: { ...base.animations, ...(partial.animations || {}) },
    animationEnabled: { ...base.animationEnabled, ...(partial.animationEnabled || {}) },
    sequences: Array.isArray(partial.sequences) ? structuredClone(partial.sequences) : [],
    debug: { ...base.debug, ...(partial.debug || {}) }
  };
}

export function normalizeAnimBinding(binding: AnimBinding): string[] {
  if (!binding) return [];
  if (Array.isArray(binding)) return binding.map(v => String(v).trim()).filter(Boolean);
  return [String(binding).trim()].filter(Boolean);
}

export function createSequenceStep(action: PlayerActionKey = 'idle'): PlayerSequenceStep {
  return {
    id: crypto.randomUUID(),
    action,
    clipOverride: null,
    durationMs: 1000,
    speedRatio: 1,
    blend: 0.08,
    loop: true,
    allowMovement: true,
    lockInput: false
  };
}

export function createPlayerSequence(name = 'Nueva secuencia'): PlayerClipSequence {
  return {
    id: crypto.randomUUID(),
    name,
    enabled: true,
    repeat: false,
    steps: [createSequenceStep('walk')]
  };
}