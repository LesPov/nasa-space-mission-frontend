// file: src/app/core/engine/runtime/systems/lighting/policies/runtime-lighting.policy.ts
import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';
import { LIGHT_SPATIAL_CONSTANTS } from '../lighting-types';

export class RuntimeLightingPolicy implements LightingPolicy {
  public readonly referenceStrategy: ReferenceResolutionStrategy = 'RUNTIME_CONFIG';

  public calculateThresholds(
    baseActivation: number | undefined,
    baseDeactivation: number | undefined,
    baseShadowActivation: number | undefined,
    baseShadowDeactivation: number | undefined,
    speed: number
  ): LightingDistanceThresholds {
    const actDist = Math.max(0.1, baseActivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS);
    const deactDist = Math.max(actDist + 0.1, baseDeactivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_DEACTIVATION_RADIUS);
    const dynamicDeactDist = deactDist;

    let prepareDist = LIGHT_SPATIAL_CONSTANTS.PREPARE_RADIUS;
    if (speed > 2.0) {
      prepareDist += speed * 1.2;
    }

    const sActDist = Math.max(0.1, baseShadowActivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_SHADOW_ACTIVATION_RADIUS);
    const sDeactDist = Math.max(sActDist + 0.1, baseShadowDeactivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_SHADOW_DEACTIVATION_RADIUS);

    return {
      activation: actDist,
      deactivation: deactDist,
      dynamicDeactivation: dynamicDeactDist,
      prepare: prepareDist,
      shadowActivation: sActDist,
      shadowDeactivation: sDeactDist
    };
  }
}