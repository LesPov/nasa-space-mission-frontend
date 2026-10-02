
import { Injectable } from '@angular/core';
import { Vector3 } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class SpatialSchedulerService {
  private lastEvalTime = 0;
  private lastPos = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  
  // 🔥 LÍMITES ADAPTATIVOS
  private readonly TIME_THRESHOLD_MS = 200; // Evaluar cada 200ms como máximo si estamos estáticos
  private readonly DIST_SQ_THRESHOLD = 4.0; // Evaluar si nos movemos 2 metros (2^2 = 4) de golpe

  /**
   * Determina si es necesario ejecutar cálculos espaciales pesados en este frame.
   * Basado en una estrategia combinada de Tiempo (Throttling) y Espacio (Desplazamiento).
   */
  public shouldEvaluate(currentPos: Vector3, dtMs: number): boolean {
    this.lastEvalTime += dtMs;
    
    // Si ha pasado el tiempo prudencial, evaluamos
    if (this.lastEvalTime >= this.TIME_THRESHOLD_MS) {
      this.lastEvalTime = 0;
      this.lastPos.copyFrom(currentPos);
      return true;
    }

    // Si nos hemos movido bruscamente (ej: salto, caída, velocidad extrema), evaluamos de inmediato
    if (Vector3.DistanceSquared(this.lastPos, currentPos) > this.DIST_SQ_THRESHOLD) {
      this.lastEvalTime = 0;
      this.lastPos.copyFrom(currentPos);
      return true;
    }

    return false;
  }

  /**
   * Fuerza que la próxima llamada a shouldEvaluate devuelva true.
   * Útil cuando hay un cambio de estado abrupto (ej: teletransporte, spawn, o forzar sincronización manual).
   */
  public forceNextEvaluation(): void {
    this.lastEvalTime = this.TIME_THRESHOLD_MS;
  }

  public reset(): void {
    this.lastEvalTime = 0;
    this.lastPos.set(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  }
}