import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';

/**
 * Política de iluminación exclusiva para el modo EDITOR y EDITING_IN_GAME.
 * Mantiene la iluminación estable cerca de la cámara del creador y 
 * aplica umbrales mínimos más altos para facilitar el trabajo.
 */
export class EditorLightingPolicy implements LightingPolicy {
    
    public readonly referenceStrategy: ReferenceResolutionStrategy = 'EDITOR_ONLY';

    public calculateThresholds(
        baseActivation: number | undefined,
        baseDeactivation: number | undefined,
        baseShadowActivation: number | undefined,
        baseShadowDeactivation: number | undefined,
        speed: number // La velocidad se recibe pero se ignora intencionalmente en el Editor
    ): LightingDistanceThresholds {
        
        // Reglas estrictas extraídas exactamente de DynamicLightingSystem (Editor Policy)
        const actDist = Math.max(40, baseActivation ?? 65);
        const deactDist = Math.max(actDist + 10, baseDeactivation ?? 75);
        const dynamicDeactDist = deactDist; // Sin inercia predictiva en Editor
        const prepareDist = dynamicDeactDist + 20;
        const fadeStartDist = actDist * 0.7;
        const fadeEndDist = dynamicDeactDist;

        // Reglas de Sombras para Editor
        const shadowAct = Math.max(25, baseShadowActivation ?? 30);
        const shadowDeact = Math.max(shadowAct + 5, baseShadowDeactivation ?? 36);

        return {
            activation: actDist,
            deactivation: deactDist,
            dynamicDeactivation: dynamicDeactDist,
            prepare: prepareDist,
            fadeStart: fadeStartDist,
            fadeEnd: fadeEndDist,
            shadowActivation: shadowAct,
            shadowDeactivation: shadowDeact
        };
    }
}