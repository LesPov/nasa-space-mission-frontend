
export enum ShadowLOD {
  LOD0_EVERY_FRAME = 1,
  LOD1_HALF_FRAMERATE = 2,
  LOD2_THIRD_FRAMERATE = 3,
  LOD3_STATIC_RENDER_ONCE = 0
}

export interface ShadowState {
  meshId: string;
  isStatic: boolean;
  needsUpdate: boolean;
  lastTransformHash: string;
  lodLevel: ShadowLOD;
}

export interface ShadowProfile {
  maxShadowDistance: number;
  lod1Distance: number;
  lod2Distance: number;
  lod3Distance: number;
}
