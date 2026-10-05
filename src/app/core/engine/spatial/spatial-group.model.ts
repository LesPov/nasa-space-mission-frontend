// file: src/app/core/engine/spatial/spatial-group.model.ts
import { Vector3 } from '@babylonjs/core';

export type SpatialGroupState = 
  | 'DORMANT'
  | 'PREPARING'
  | 'PREPARED'
  | 'PREACTIVATING'
  | 'ACTIVE'
  | 'RETAINED';

export interface SpatialGroupConfig {
  preloadMargin: number;       // Margen extra antes de entrar a la zona para disparar preparación (metros)
  prepareMargin: number;       // Distancia de hidratación de recursos de luz/sombras (metros)
  activeMargin: number;        // Distancia para activar visibilidad completa (metros)
  retainDistance: number;      // Distancia de histéresis para retener antes de pasar a DORMANT (metros)
  lookAheadMultiplier: number; // Multiplicador de velocidad para anticipar el vector de carrera
  maxLookAheadDistance: number;// Límite máximo de proyección frontal (metros)
}

export const DEFAULT_SPATIAL_GROUP_CONFIG: SpatialGroupConfig = {
  preloadMargin: 160.0,
  prepareMargin: 110.0,
  activeMargin: 85.0,
  retainDistance: 40.0,
  lookAheadMultiplier: 2.2,
  maxLookAheadDistance: 50.0
};

export interface SpatialGroup {
  id: string;
  name: string;
  rootEntityUid: string;
  memberUids: Set<string>;
  neighborGroupIds: Set<string>;
  minWorld: Vector3;
  maxWorld: Vector3;
  centerWorld: Vector3;
  boundingRadius: number;
  state: SpatialGroupState;
  previousState: SpatialGroupState;
  distanceToPlayer: number;
  distanceToBox: number;
  predictedDistanceToBox: number;
  directionDot: number;
  isInsideVolume: boolean;
  isPredictedTarget: boolean;
  config: SpatialGroupConfig;
  lastStateChangeTimestamp: number;
  preparationProgress: number; // 0.0 a 1.0 para preparación incremental
}