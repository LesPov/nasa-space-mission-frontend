// file: src/app/core/engine/runtime/systems/lighting/light-attenuation-curve.ts
export class LightAttenuationCurve {
    /**
     * Calcula una transición hiper-suave (0.0001 -> 1.0) sin escalones lineales ni saltos.
     * Cero allocations en el render loop.
     * 
     * @param distance Distancia euclidiana al actor.
     * @param rFull Radio interior donde la luz alcanza el 100% de intensidad.
     * @param rZero Radio exterior donde la luz se apaga por completo.
     */
    public static calculate(distance: number, rFull: number, rZero: number): number {
        if (rZero <= rFull) {
            return distance <= rFull ? 1.0 : 0.0;
        }

        if (distance <= rFull) return 1.0;
        if (distance >= rZero) return 0.0;

        // Normalización invertida: 1.0 en rFull, 0.0 en rZero
        const x = 1.0 - ((distance - rFull) / (rZero - rFull));

        // Curva sigmoide de quinto grado (Smootherstep de Ken Perlin): 6x^5 - 15x^4 + 10x^3
        // Proporciona primera y segunda derivada iguales a 0 en ambos extremos,
        // garantizando aceleración continua sin tirones perceptibles en la retina.
        const factor = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
        return Math.max(0.0, Math.min(1.0, factor));
    }
}