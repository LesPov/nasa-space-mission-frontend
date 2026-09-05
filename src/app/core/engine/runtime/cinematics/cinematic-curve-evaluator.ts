
import { CinematicKeyframe, CinematicTrack, CinematicInterpolation } from '../../models/cinematic.model';

export interface CurveEvaluation<T> {
  kf1: CinematicKeyframe<T>;
  kf2: CinematicKeyframe<T>;
  t: number;
}

export class CinematicCurveEvaluator {
  /**
   * Evalúa la pista devolviendo el par de keyframes circundantes y el valor de interpolación `t` (0.0 a 1.0).
   * Es una función pura y matemática, independiente del motor 3D.
   */
  public static evaluateTrack<T>(track: CinematicTrack<T>, timeMs: number): CurveEvaluation<T> | null {
    if (!track || !track.keyframes || track.keyframes.length === 0) return null;

    const kfs = track.keyframes;
    
    // Si solo hay un keyframe, no hay interpolación
    if (kfs.length === 1) {
       return { kf1: kfs[0], kf2: kfs[0], t: 0 };
    }

    // Fuera de límites (Clamp a los extremos)
    if (timeMs <= kfs[0].timeMs) {
       return { kf1: kfs[0], kf2: kfs[0], t: 0 };
    }
    if (timeMs >= kfs[kfs.length - 1].timeMs) {
       return { kf1: kfs[kfs.length - 1], kf2: kfs[kfs.length - 1], t: 1 };
    }

    let kf1: CinematicKeyframe<T> = kfs[0];
    let kf2: CinematicKeyframe<T> = kfs[1];

    // Búsqueda del segmento actual
    for (let i = 0; i < kfs.length - 1; i++) {
      if (timeMs >= kfs[i].timeMs && timeMs <= kfs[i + 1].timeMs) {
        kf1 = kfs[i];
        kf2 = kfs[i + 1];
        break;
      }
    }

    const range = kf2.timeMs - kf1.timeMs;
    let rawT = 0;
    if (range > 0) {
       rawT = (timeMs - kf1.timeMs) / range;
    }

    // Aplicación del Easing Funcional
    const t = this.applyEasing(rawT, kf1.interpolation || 'linear');

    return { kf1, kf2, t };
  }

  private static applyEasing(t: number, easing: CinematicInterpolation): number {
    t = Math.max(0, Math.min(1, t));
    switch (easing) {
      case 'linear': return t;
      case 'easeIn': return t * t;
      case 'easeOut': return t * (2 - t);
      case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      case 'step': return 0; // Salto duro al inicio del keyframe
      default: return t;
    }
  }
}