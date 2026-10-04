// file: src/app/core/engine/runtime/systems/lighting/policies/editor-lighting.policy.ts
import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';
import { LIGHT_SPATIAL_CONSTANTS } from '../lighting-types';

export class EditorLightingPolicy implements LightingPolicy {
  public readonly referenceStrategy: ReferenceResolutionStrategy = 'EDITOR_ONLY';

  public calculateThresholds(
    baseActivation: number | undefined,
    baseDeactivation: number | undefined,
    baseShadowActivation: number | undefined,
    baseShadowDeactivation: number | undefined,
    speed: number
  ): LightingDistanceThresholds {
    const actDist = Math.max(1.0, baseActivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS);
    const deactDist = Math.max(actDist + 2.0, baseDeactivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_DEACTIVATION_RADIUS);
    const dynamicDeactDist = deactDist;
    const prepareDist = LIGHT_SPATIAL_CONSTANTS.PREPARE_RADIUS;

    const shadowAct = Math.max(1.0, baseShadowActivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_SHADOW_ACTIVATION_RADIUS);
    const shadowDeact = Math.max(shadowAct + 2.0, baseShadowDeactivation ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_SHADOW_DEACTIVATION_RADIUS);

    return {
      activation: actDist,
      deactivation: deactDist,
      dynamicDeactivation: dynamicDeactDist,
      prepare: prepareDist,
      shadowActivation: shadowAct,
      shadowDeactivation: shadowDeact
    };
  }
}