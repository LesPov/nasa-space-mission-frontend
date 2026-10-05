// file: src/app/core/engine/runtime/systems/lighting/lighting-types.ts
import { Color3, PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3, AbstractMesh } from '@babylonjs/core';
import { GameEntity, LightInteriorActivationMode } from '../../../entities/game.entity';

export type LightLifecycleStage = 'OUTSIDE' | 'FADING_IN' | 'ACTIVE' | 'FADING_OUT' | 'INACTIVE';
export type LightSpatialState = 'OUTSIDE' | 'PRE_ENTRY' | 'INSIDE' | 'PRE_EXIT';
export type ContainmentSource = 'COLLISION_MESH' | 'EXPLICIT_MESH' | 'GEOMETRY' | 'AABB_FALLBACK';
export type ShadowTier = 'HIGH' | 'MEDIUM' | 'LOW';

export const LIGHT_SPATIAL_CONSTANTS = {
  DEFAULT_ACTIVATION_RADIUS: 50.0,
  DEFAULT_DEACTIVATION_RADIUS: 55.0,
  DEFAULT_SHADOW_ACTIVATION_RADIUS: 30.0,
  DEFAULT_SHADOW_DEACTIVATION_RADIUS: 35.0,
  RELEVANCE_RADIUS: 50.0,
  DEACTIVATION_RADIUS: 55.0,
  PREPARE_RADIUS: 65.0,
  SHADOW_ACTIVATION_RADIUS: 30.0,
  SHADOW_DEACTIVATION_RADIUS: 35.0,
  MAX_LOCAL_LIGHTS: 3,
  MAX_LOCAL_SHADOWS: 3,
  ZERO_INTENSITY_THRESHOLD: 0.0001
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

  // Seguimiento de actores dinámicos actualmente inyectados en la renderList
  dynamicCastersRegistered?: Set<string>;
}