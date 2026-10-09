// file: src/app/core/engine/runtime/systems/lighting/lighting-types.ts
import { Color3, PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { GameEntity, LightInteriorActivationMode } from '../../../entities/game.entity';

export type LightLifecycleStage = 'OUTSIDE' | 'PREPARING' | 'PREPARED' | 'FADING_IN' | 'ACTIVE' | 'FADING_OUT' | 'INACTIVE';
export type LightSpatialState = 'OUTSIDE' | 'PRE_ENTRY' | 'INSIDE' | 'PRE_EXIT';
export type ContainmentSource = 'COLLISION_MESH' | 'EXPLICIT_MESH' | 'GEOMETRY' | 'AABB_FALLBACK';
export type ShadowTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'DISABLED';

export type LogicalSlotState = 'EMPTY' | 'ACTIVE' | 'FADING_OUT' | 'RELEASING' | 'REBINDING' | 'FADING_IN';

export const LIGHT_SPATIAL_CONSTANTS = {
  DEFAULT_ACTIVATION_RADIUS: 20.0,
  DEFAULT_DEACTIVATION_RADIUS: 26.0,
  DEFAULT_SHADOW_ACTIVATION_RADIUS: 16.0,
  DEFAULT_SHADOW_DEACTIVATION_RADIUS: 22.0,
  RELEVANCE_RADIUS: 25.0,
  DEACTIVATION_RADIUS: 30.0,
  PREPARE_RADIUS: 35.0,
  SHADOW_ACTIVATION_RADIUS: 18.0,
  SHADOW_DEACTIVATION_RADIUS: 24.0,
  MAX_PHYSICAL_ACTIVE_LIGHTS: 3,
  MAX_PREPARED_LIGHTS: 2,
  TOTAL_LOGICAL_SLOTS: 5,
  MAX_LOCAL_LIGHTS: 3,
  MAX_LOCAL_SHADOWS: 3,
  ZERO_INTENSITY_THRESHOLD: 0.001,
  // Márgenes precisos para transiciones en pasillos
  INTERIOR_KEEP_ALIVE_HOLD_MARGIN: 1.5,
  INTERIOR_KEEP_ALIVE_DISTANCE_MULTIPLIER: 1.2,
  INTERIOR_KEEP_ALIVE_MAX_DISTANCE: 7.0,
  INTERIOR_SHADOW_EXIT_MARGIN: 3.0,
  // Histéresis e inercia de puntuación
  STICKINESS_SCORE_MULTIPLIER: 0.70,
  REPLACEMENT_SCORE_ADVANTAGE: 0.85,
  MIN_SLOT_HOLD_TIME_MS: 200
};

export interface ActiveLogicalSlot {
  id: number;
  assignedUid: string | null;
  physicalSlot: PoolSlot | null;
  state: LogicalSlotState;
  pendingUid: string | null;
  assignedTime: number;
  lastStateChangeTime: number;
}

export interface PreparedLogicalSlot {
  id: number;
  candidateUid: string | null;
  score: number;
  isReady: boolean;
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
  logicalSlotIndex?: number | null;
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
  topologicalHop?: number;
  corridorZoneName?: string;
  shadowTier?: ShadowTier;
  shadowRank?: number;
}

export interface PoolSlot {
  index: number;
  logicalSlotIndex?: number | null;
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