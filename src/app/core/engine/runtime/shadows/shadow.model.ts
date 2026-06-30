
export enum ShadowLOD {
  LOD0_ACTIVE_SHADOWS = 0,
  LOD1_NO_SHADOWS = 1,
  LOD2_LIGHTING_ONLY = 2,
  LOD3_NO_PHYSICAL_LIGHT = 3
}

export interface ShadowState {
  meshId: string;
  isStatic: boolean;
  needsUpdate: boolean;
  lastTransformHash: string;
  lodLevel: ShadowLOD;
}

export interface ShadowAssignment {
  meshId: string;
  lightId: string;
}

export interface ShadowProfile {
  maxShadowDistance: number;
  lod1Distance: number;
  lod2Distance: number;
  lod3Distance: number;
  updateIntervalMs: number;
}