// file: src/app/core/engine/runtime/systems/lighting/lighting-types.ts
import { Color3, PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { GameEntity, LightInteriorActivationMode } from '../../../entities/game.entity';

export type LightLifecycleStage = 'OUTSIDE' | 'PREPARING' | 'PREPARED' | 'FADING_IN' | 'ACTIVE' | 'FADING_OUT' | 'INACTIVE';
export type LightSpatialState = 'OUTSIDE' | 'PRE_ENTRY' | 'INSIDE' | 'PRE_EXIT';
export type ContainmentSource = 'COLLISION_MESH' | 'EXPLICIT_MESH' | 'GEOMETRY' | 'AABB_FALLBACK';
export type ShadowTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'DISABLED';

export type LogicalSlotState = 'EMPTY' | 'ACTIVE' | 'FADING_OUT' | 'RELEASING' | 'REBINDING' | 'FADING_IN';

export type MacroZoneState = 'EXTERIOR' | 'APPROACHING_ENTRY' | 'INTERIOR_PREENTRY' | 'INTERIOR_ACTIVE' | 'INTERIOR_EXIT' | 'EXTERIOR_RESTORED';

export const LIGHT_SPATIAL_CONSTANTS = {
  DEFAULT_ACTIVATION_RADIUS: 25.0,
  DEFAULT_DEACTIVATION_RADIUS: 32.0,
  DEFAULT_SHADOW_ACTIVATION_RADIUS: 20.0,
  DEFAULT_SHADOW_DEACTIVATION_RADIUS: 28.0,
  RELEVANCE_RADIUS: 30.0,
  DEACTIVATION_RADIUS: 36.0,
  PREPARE_RADIUS: 42.0,
  SHADOW_ACTIVATION_RADIUS: 22.0,
  SHADOW_DEACTIVATION_RADIUS: 28.0,

  // Capacidad del Pool: 4 Slots Físicos Activos + 2 de Preparación = 6 Lógicos
  MAX_PHYSICAL_ACTIVE_LIGHTS: 4,
  MAX_PREPARED_LIGHTS: 2,
  TOTAL_LOGICAL_SLOTS: 6,
  MAX_LOCAL_LIGHTS: 4,
  MAX_LOCAL_SHADOWS: 4,
  ZERO_INTENSITY_THRESHOLD: 0.001,
  
  // Parámetros de Pasillo y Preentrada (16m preservados)
  DEFAULT_INTERIOR_PREENTRY_DISTANCE: 16.0,
  INTERIOR_KEEP_ALIVE_HOLD_MARGIN: 3.5,
  INTERIOR_KEEP_ALIVE_DISTANCE_MULTIPLIER: 1.3,
  INTERIOR_KEEP_ALIVE_MAX_DISTANCE: 12.0,
  INTERIOR_SHADOW_EXIT_MARGIN: 4.5,
  
  // Histéresis de umbrales
  PRE_ENTRY_HYSTERESIS_MARGIN: 2.0,

  // Histéresis de Puntuación
  STICKINESS_SCORE_MULTIPLIER: 0.65,
  REPLACEMENT_SCORE_ADVANTAGE: 0.80,
  MIN_SLOT_HOLD_TIME_MS: 350,

  // Ángulo de descarte para luces a espaldas de la cámara (~110°)
  BEHIND_CAMERA_DOT_THRESHOLD: -0.35
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
  dotWithCameraForward?: number;
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