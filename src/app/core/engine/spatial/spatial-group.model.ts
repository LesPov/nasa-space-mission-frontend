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
  preloadMargin: number;       // Margen antes de entrar para preparar recursos (m)
  prepareMargin: number;       // Distancia para preparar iluminación y sombras (m)
  activeMargin: number;        // Distancia para activación plena (m)
  retainDistance: number;      // Histéresis de retención antes de pasar a DORMANT (m)
  lookAheadMultiplier: number; // Multiplicador de velocidad para vector de avance
  maxLookAheadDistance: number;// Máxima proyección de avance frontal (m)
}

export const DEFAULT_SPATIAL_GROUP_CONFIG: SpatialGroupConfig = {
  preloadMargin: 45.0,
  prepareMargin: 20.0,
  activeMargin: 12.0,
  retainDistance: 8.0,
  lookAheadMultiplier: 1.2,
  maxLookAheadDistance: 16.0
};

export interface SpatialPortal {
  targetGroupId: string; // ID del grupo contiguo o 'EXTERIOR'
  position: Vector3;     // Coordenada mundial del umbral/puerta
  normal: Vector3;       // Vector normal saliente desde este grupo
  width: number;
}

export interface SpatialGroup {
  id: string;
  name: string;
  rootEntityUid: string;
  memberUids: Set<string>;
  neighborGroupIds: Set<string>;
  portals: SpatialPortal[];
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
  hopDistanceFromActive: number; // 0 = actual, 1 = vecino inmediato, >= 2 = desconectado
  config: SpatialGroupConfig;
  lastStateChangeTimestamp: number;
  preparationProgress: number;
}