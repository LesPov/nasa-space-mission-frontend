
import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';

/**
 * Política de iluminación exclusiva para el modo TEST_LIVE y FINAL_USER.
 * Aplica inercia predictiva para la asignación de memoria, pero respeta
 * estrictamente los umbrales estáticos para la curva visual.
 */
export class RuntimeLightingPolicy implements LightingPolicy {
    
    public readonly referenceStrategy: ReferenceResolutionStrategy = 'RUNTIME_CONFIG';

    public calculateThresholds(
        baseActivation: number | undefined,
        baseDeactivation: number | undefined,
        baseShadowActivation: number | undefined,
        baseShadowDeactivation: number | undefined,
        speed: number
    ): LightingDistanceThresholds {
        
        // Umbrales visuales estrictos (R_FULL y R_ZERO)
        const actDist = Math.max(0.1, baseActivation ?? 65);
        const deactDist = Math.max(actDist + 0.1, baseDeactivation ?? (actDist + 10));
        
        // 🔥 FIX FASE 2: La desactivación visual (R_ZERO) ya NO se infla con la velocidad.
        // Esto garantiza que el Fade Out progrese incluso mientras el jugador corre.
        const dynamicDeactDist = deactDist;
        
        // Inercia Predictiva de Movimiento exclusiva para PRE-ASIGNAR slots de memoria (Preparación)
        let prepareDist = dynamicDeactDist + 30;
        if (speed > 2.0) {
            prepareDist += speed * 1.5; 
        }

        // Reglas de Sombras para Runtime
        const sActDist = Math.max(0.1, baseShadowActivation ?? 30);
        const sDeactDist = Math.max(sActDist + 0.1, baseShadowDeactivation ?? (sActDist + 6));
        
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