// ARCHIVO: src/app/core/engine/runtime/systems/lighting/lighting-types.ts

import { Color3, PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3, AbstractMesh } from '@babylonjs/core';
import { GameEntity, LightInteriorActivationMode } from '../../../entities/game.entity';

export type LightLifecycleStage = 'OUTSIDE' | 'PREPARING' | 'PREPARED' | 'FADING_IN' | 'ACTIVE' | 'FADING_OUT' | 'INACTIVE';
export type LightSpatialState = 'OUTSIDE' | 'PRE_ENTRY' | 'INSIDE' | 'PRE_EXIT';
export type ContainmentSource = 'COLLISION_MESH' | 'EXPLICIT_MESH' | 'GEOMETRY' | 'AABB_FALLBACK';
export type ShadowTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'DISABLED';

export const LIGHT_SPATIAL_CONSTANTS = {
  DEFAULT_ACTIVATION_RADIUS: 50.0,
  DEFAULT_DEACTIVATION_RADIUS: 58.0,
  DEFAULT_SHADOW_ACTIVATION_RADIUS: 32.0,
  DEFAULT_SHADOW_DEACTIVATION_RADIUS: 38.0,
  RELEVANCE_RADIUS: 50.0,
  DEACTIVATION_RADIUS: 58.0,
  PREPARE_RADIUS: 70.0,
  SHADOW_ACTIVATION_RADIUS: 32.0,
  SHADOW_DEACTIVATION_RADIUS: 38.0,
  MAX_PHYSICAL_ACTIVE_LIGHTS: 3,
  MAX_PREPARED_LIGHTS: 2,
  MAX_LOCAL_LIGHTS: 3,
  MAX_LOCAL_SHADOWS: 3,
  ZERO_INTENSITY_THRESHOLD: 0.001,
  INTERIOR_KEEP_ALIVE_HOLD_MARGIN: 4.0,
  INTERIOR_KEEP_ALIVE_DISTANCE_MULTIPLIER: 1.6,
  INTERIOR_KEEP_ALIVE_MAX_DISTANCE: 25.0,
  INTERIOR_SHADOW_EXIT_MARGIN: 6.0
};

export interface LightDistanceBreakdown {
  centerDistance: number;
  boundsDistance: number;
  effectiveDistance: number;
  activationDistance: number;
  fadeStartDistance: number;
  fadeEndDistance: number;
}

export interface VirtualLight {
  entity: GameEntity;
  materials: any[];
  baseColor: Color3;
  currentMultiplier: number;
  targetMultiplier: number;
  distSq: number;
  isLightInRange: boolean;
  isShadowInRange: boolean;
  lastEvaluatedDistance: number;
  centerDistance: number;
  boundsDistance: number;
  effectiveDistance: number;
  _lastRenderedMultiplier?: number;
  _isInPrepareRange?: boolean;
  _sortScore?: number;
  closestActorName?: string;
  poolRank?: number;
  lifecycleStage: LightLifecycleStage;
  previousLifecycleStage?: LightLifecycleStage;
  lastStateChangeTimestamp?: string;
  lastDistanceUpdateTimestamp?: string;
  decisionText: string;
  rejectionReason?: string;
  activationReason?: string;
  isWarmedUp: boolean;
  isInterior: boolean;
  interiorActivationMode?: LightInteriorActivationMode;
  insideVolume: boolean;
  inPreEntryZone: boolean;
  inPreExitZone?: boolean;
  spatialState?: LightSpatialState;
  distanceToBoundary?: number;
  containmentSource?: ContainmentSource;
  containerName?: string;
  shadowTier?: ShadowTier;
  shadowRank?: number;
}

export interface PoolSlot {
  index: number;
  type: 'point' | 'spot' | 'directional';
  light: PointLight | SpotLight | DirectionalLight;
  sg: ShadowGenerator | null;
  assignedEntityUid: string | null;
  currentIntensity: number;
  lastShadowRebuildPos?: Vector3;
  _isNewAssignment?: boolean;
  hasDynamicCasters?: boolean;
  isStaticLight?: boolean;
  isWarmedUp?: boolean;
  _lightOnTimestamp?: number;
  _shadowReadyTimestamp?: number;
  shadowTier?: ShadowTier;
  currentRefreshRate?: number;
  _framesSinceStopped?: number;
  dynamicCastersRegistered?: Set<string>;
}