
import { Vector3 } from '@babylonjs/core';
import { 
  PlayerMovementConfig, PlayerJumpConfig, PlayerCameraConfig, PlayerFogConfig, 
  PlayerAnimationBindings, PlayerClipSequence, PlayerAnimationEnabled, PlayerDebugConfig 
} from '../models/player-config.model';

export class MovementComponent { constructor(public config: PlayerMovementConfig) {} }
export class JumpComponent { constructor(public config: PlayerJumpConfig) {} }
export class PlayerCameraConfigComponent { constructor(public config: PlayerCameraConfig) {} }
export class FogConfigComponent { constructor(public config: PlayerFogConfig) {} }
export class AnimationBindingsComponent { constructor(public config: PlayerAnimationBindings) {} }
export class SequencesComponent { constructor(public sequences: PlayerClipSequence[]) {} }
export class PhysicsConfigComponent { constructor(public config: { hardLandingThreshold: number; landingRecoveryFrames: number; }) {} }
export class BlendConfigComponent { constructor(public config: { defaultBlend: number; fastBlend: number; slowBlend: number; noBlend: number; }) {} }
export class AnimationEnabledComponent { constructor(public config: PlayerAnimationEnabled) {} }
export class DebugConfigComponent { constructor(public config: PlayerDebugConfig) {} }

export class SelectionRangeComponent { constructor(public config: { fpsAdminMax: number; fpsUserMax: number }) {} }
export class CamOffsetComponent { constructor(public config: { x: number, y: number, z: number }) {} }
export class AnimationNamesComponent { constructor(public names: string[]) {} }
export class AutoAnimComponent { constructor(public config: any) {} }
export class InitialHeadLocalComponent { constructor(public position: Vector3) {} }
