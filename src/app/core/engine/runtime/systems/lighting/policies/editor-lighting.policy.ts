
import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';

/**
 * Política de iluminación para los modos EDITOR y EDITING_IN_GAME.
 * Respeta rigurosamente las distancias configuradas por el usuario en cada luz
 * y proporciona los rangos para la atenuación continua (Fade) y la selección del Top 3
 * calculados respecto a los Actores (Player/NPC).
 */
export class EditorLightingPolicy implements LightingPolicy {
    
    public readonly referenceStrategy: ReferenceResolutionStrategy = 'EDITOR_ONLY';

    public calculateThresholds(
        baseActivation: number | undefined,
        baseDeactivation: number | undefined,
        baseShadowActivation: number | undefined,
        baseShadowDeactivation: number | undefined,
        speed: number
    ): LightingDistanceThresholds {
        // Respetar fielmente los valores configurados por el usuario
        const actDist = Math.max(1.0, baseActivation ?? 52.0);
        // Asegurar que deactivation sea estrictamente mayor que activation para crear la zona de fade
        const deactDist = Math.max(actDist + 2.0, baseDeactivation ?? (actDist + 8.0));
        const dynamicDeactDist = deactDist;
        // Rango de preparación para asignar slot en el pool antes de encender el brillo
        const prepareDist = dynamicDeactDist + 15.0;

        // Sombras con su propio rango e histéresis
        const shadowAct = Math.max(1.0, baseShadowActivation ?? Math.min(actDist, 40.0));
        const shadowDeact = Math.max(shadowAct + 2.0, baseShadowDeactivation ?? (shadowAct + 6.0));

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