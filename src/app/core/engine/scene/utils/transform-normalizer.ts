// file: src/app/core/engine/scene/utils/transform-normalizer.ts

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export class TransformNormalizer {
  public static readonly MIN_SCALE = 0.001;
  public static readonly MAX_SCALE = 1000.0;
  public static readonly DEFAULT_SCALE = 1.0;

  /**
   * Sanitiza un componente de escala escalar dentro de los límites seguros [0.001, 1000.0].
   * Emite una advertencia técnica en consola si se detecta un valor anómalo, infinito o NaN.
   */
  public static sanitizeScale(val: number | null | undefined, axisName = 'scale', entityName?: string): number {
    const num = Number(val);
    if (!Number.isFinite(num) || num === 0) {
      if (entityName) {
        console.warn(`[TransformNormalizer] Escala inválida (${val}) en ${entityName}.${axisName}. Normalizado a ${this.DEFAULT_SCALE}`);
      }
      return this.DEFAULT_SCALE;
    }
    const absVal = Math.abs(num);
    if (absVal < this.MIN_SCALE || absVal > this.MAX_SCALE) {
      const clamped = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, absVal)) * Math.sign(num);
      console.warn(`[TransformNormalizer] Escala anómala detectada (${num}) en ${entityName ? entityName + '.' : ''}${axisName}. Normalizada a ${clamped} dentro del rango [${this.MIN_SCALE}, ${this.MAX_SCALE}]`);
      return clamped;
    }
    return num;
  }

  /**
   * Sanitiza un vector tridimensional de escala, asegurando que ninguno de sus componentes
   * sea cero, NaN, subatómico (< 0.001) o astronómico (> 1000.0).
   */
  public static sanitizeScaleVector(vec: { x?: number; y?: number; z?: number } | null | undefined, entityName?: string): Vector3Like {
    return {
      x: this.sanitizeScale(vec?.x, 'scale.x', entityName),
      y: this.sanitizeScale(vec?.y, 'scale.y', entityName),
      z: this.sanitizeScale(vec?.z, 'scale.z', entityName)
    };
  }

  public static sanitizePosition(val: number | null | undefined, fallback = 0): number {
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
  }

  public static sanitizePositionVector(vec: { x?: number; y?: number; z?: number } | null | undefined): Vector3Like {
    return {
      x: this.sanitizePosition(vec?.x, 0),
      y: this.sanitizePosition(vec?.y, 0),
      z: this.sanitizePosition(vec?.z, 0)
    };
  }

  public static sanitizeRotation(val: number | null | undefined, fallback = 0): number {
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
  }

  public static sanitizeRotationVector(vec: { x?: number; y?: number; z?: number } | null | undefined): Vector3Like {
    return {
      x: this.sanitizeRotation(vec?.x, 0),
      y: this.sanitizeRotation(vec?.y, 0),
      z: this.sanitizeRotation(vec?.z, 0)
    };
  }
}