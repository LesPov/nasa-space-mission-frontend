
// file: src/app/core/engine/spatial/spatial-group.model.ts
import { Vector3 } from '@babylonjs/core';

export type SpatialGroupState = 
  | 'DORMANT'
  | 'PREPARING'
  | 'PREPARED'
  | 'ACTIVE'
  | 'RETAINED';

export interface SpatialGroupConfig {
  preloadMargin: number;       // Margen extra antes de entrar a la zona para disparar preparación (metros)
  activeMargin: number;        // Distancia para activar visibilidad completa (metros)
  retainDistance: number;      // Distancia de histeresis para retener antes de pasar a DORMANT (metros)
  lookAheadMultiplier: number; // Multiplicador de velocidad para anticipar el vector de carrera
}

export const DEFAULT_SPATIAL_GROUP_CONFIG: SpatialGroupConfig = {
  preloadMargin: 70.0,         // Ampliado para pasillos de 60m
  activeMargin: 40.0,          // Cubre el volumen completo del modelo antes de llegar al centro
  retainDistance: 25.0,        // Histéresis contra oscilaciones en umbrales
  lookAheadMultiplier: 1.8
};

export interface SpatialGroup {
  id: string;
  rootEntityUid: string;
  memberUids: Set<string>;
  minWorld: Vector3;
  maxWorld: Vector3;
  centerWorld: Vector3;
  boundingRadius: number;
  state: SpatialGroupState;
  previousState: SpatialGroupState;
  distanceToPlayer: number;
  distanceToBox: number;
  isInsideVolume: boolean;
  config: SpatialGroupConfig;
  lastStateChangeTimestamp: number;
}