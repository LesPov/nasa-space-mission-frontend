
export class LightAttenuationCurve {
    /**
     * Calcula un multiplicador continuo y suavizado (0.0 a 1.0) basado en la distancia.
     * Cero Allocations. Función matemática pura.
     * 
     * @param distance Distancia actual entre el jugador/cámara y la luz.
     * @param rFull Radio interno (activationDistance). Distancias menores o iguales devuelven 1.0 (100% luz).
     * @param rZero Radio externo (deactivationDistance). Distancias mayores o iguales devuelven 0.0 (0% luz).
     */
    public static calculate(distance: number, rFull: number, rZero: number): number {
        // Fallback de seguridad por si el usuario configura mal los rangos en el inspector
        if (rZero <= rFull) {
            return distance <= rFull ? 1.0 : 0.0;
        }

        // Fuera de límites
        if (distance <= rFull) return 1.0;
        if (distance >= rZero) return 0.0;

        // Normalización lineal invertida (1.0 en rFull, 0.0 en rZero)
        const t = 1.0 - ((distance - rFull) / (rZero - rFull));

        // Aplicación de Smoothstep (Hermite interpolation) para desvanecimiento orgánico
        // f(t) = t^2 * (3 - 2t)
        return t * t * (3.0 - 2.0 * t);
    }
}