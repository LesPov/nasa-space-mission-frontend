
import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';

/**
 * Política de iluminación exclusiva para el modo EDITOR y EDITING_IN_GAME.
 * Mantiene todas las luces de la zona de trabajo iluminando y proyectando sombras
 * de forma completamente estable para eliminar oscilaciones y recompilaciones en caliente.
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
        // En el editor se utilizan distancias amplias con tolerancia extendida (300m)
        // para que mover la cámara nunca desactive luces intempestivamente
        const actDist = Math.max(150, baseActivation ?? 150);
        const deactDist = Math.max(actDist + 50, baseDeactivation ?? (actDist + 50));
        const dynamicDeactDist = deactDist;
        const prepareDist = dynamicDeactDist + 50;

        // Sombras con rango generoso para mantener coherencia compositiva
        const shadowAct = Math.max(100, baseShadowActivation ?? 100);
        const shadowDeact = Math.max(shadowAct + 30, baseShadowDeactivation ?? (shadowAct + 30));

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