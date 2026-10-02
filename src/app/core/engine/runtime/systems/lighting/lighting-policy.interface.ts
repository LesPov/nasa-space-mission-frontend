
export interface LightingDistanceThresholds {
    activation: number;
    deactivation: number;
    dynamicDeactivation: number;
    prepare: number;
    shadowActivation: number;
    shadowDeactivation: number;
}

export type ReferenceResolutionStrategy = 'EDITOR_ONLY' | 'RUNTIME_CONFIG';

export interface LightingPolicy {
    /** 
     * Define cómo debe resolverse la posición espacial base para calcular distancias.
     */
    readonly referenceStrategy: ReferenceResolutionStrategy;

    /**
     * Calcula los umbrales de distancia considerando las reglas específicas del entorno
     * (Editor vs Runtime) y el estado físico actual (ej. velocidad e inercia).
     */
    calculateThresholds(
        baseActivation: number | undefined,
        baseDeactivation: number | undefined,
        baseShadowActivation: number | undefined,
        baseShadowDeactivation: number | undefined,
        speed: number
    ): LightingDistanceThresholds;
}