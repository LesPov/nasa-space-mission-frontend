
import { LightingDistanceThresholds, LightingPolicy, ReferenceResolutionStrategy } from '../lighting-policy.interface';

/**
 * Política de iluminación exclusiva para el modo TEST_LIVE y FINAL_USER.
 * Aplica inercia predictiva, ahorro de recursos y obedece estrictamente 
 * los parámetros de distancia configurados en las entidades.
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
        
        // Reglas estrictas configuradas por la entidad
        const actDist = Math.max(0.1, baseActivation ?? 65);
        const deactDist = Math.max(actDist + 0.1, baseDeactivation ?? (actDist + 10));
        
        let dynamicDeactDist = deactDist;
        
        // Inercia Predictiva de Movimiento (Expande exclusivamente la desactivación y preparación)
        if (speed > 2.0) {
            dynamicDeactDist += speed * 1.5; 
        }
        
        const prepareDist = dynamicDeactDist + 30;

        // Reglas de Sombras para Runtime
        const sActDist = Math.max(0.1, baseShadowActivation ?? 30);
        const sDeactDist = Math.max(sActDist + 0.1, baseShadowDeactivation ?? (sActDist + 6));
        
        let dynSAct = sActDist;
        let dynSDeact = sDeactDist;
        
        // Inercia Predictiva de Sombras
        if (speed > 2.0) {
            dynSAct += speed * 1.5;
            dynSDeact += speed * 1.5;
        }

        return {
            activation: actDist,
            deactivation: deactDist,
            dynamicDeactivation: dynamicDeactDist,
            prepare: prepareDist,
            shadowActivation: dynSAct,
            shadowDeactivation: dynSDeact
        };
    }
}