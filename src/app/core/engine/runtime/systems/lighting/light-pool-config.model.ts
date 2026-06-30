
export interface LightPoolConfig {
  maxPointLights: number;
  maxSpotLights: number;
  maxDirectionalLights: number;
}

export const DEFAULT_LIGHT_POOL_CONFIG: LightPoolConfig = {
  maxPointLights: 8,
  maxSpotLights: 4,
  maxDirectionalLights: 1
};