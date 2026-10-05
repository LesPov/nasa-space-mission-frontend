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
  preloadMargin: 150.0,        // Ampliado para cubrir todo el horizonte visible sin pop-in
  activeMargin: 90.0,          // Mantiene los modelos y pasillos conectados completamente activos a 90m
  retainDistance: 35.0,        // Histéresis sólida contra oscilaciones en umbrales
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