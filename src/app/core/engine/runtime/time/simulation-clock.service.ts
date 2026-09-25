import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SimulationClockService {
  /**
   * Factor multiplicador de la velocidad de simulación:
   * 0x (Pausa), 1x (Normal), 2x, 5x, 10x.
   */
  public readonly timeScaleSignal = signal<number>(1.0);

  private _timeScale = 1.0;
  private _renderDeltaTimeMs = 16.67;
  private _simulationDeltaTimeMs = 16.67;
  private _accumulatedSimTimeMs = 0;
  private _substeps: number[] = [];

  // Constantes de seguridad matemática
  private readonly FIXED_SUBSTEP_MS = 16.666; // ~60 Hz base
  private readonly MAX_SUBSTEPS = 8; // Evita el "Spiral of Death"
  private readonly MAX_DELTA_SPIKE_MS = 100; // Clamping contra pausas de pestañas

  public get timeScale(): number {
    return this._timeScale;
  }

  public get renderDeltaTimeMs(): number {
    return this._renderDeltaTimeMs;
  }

  public get simulationDeltaTimeMs(): number {
    return this._simulationDeltaTimeMs;
  }

  public get substeps(): number[] {
    return this._substeps;
  }

  public setTimeScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 0) scale = 1.0;
    // Límite superior seguro documentado: 10x
    this._timeScale = Math.min(10.0, Math.max(0.0, scale));
    this.timeScaleSignal.set(this._timeScale);
  }

  /**
   * Avanza el reloj en base al tiempo real transcurrido en el motor (frame delta).
   * Genera los substeps físicos necesarios de forma determinista.
   */
  public advance(rawDtMs: number): void {
    // 1. Clamping del delta del render para proteger ante picos (Delta Spikes)
    this._renderDeltaTimeMs = Math.min(this.MAX_DELTA_SPIKE_MS, Math.max(0.001, rawDtMs));

    // 2. Si la simulación está pausada (0x), la física no avanza
    if (this._timeScale === 0) {
      this._simulationDeltaTimeMs = 0;
      this._substeps = [];
      this._accumulatedSimTimeMs = 0;
      return;
    }

    // 3. Tiempo de simulación acumulado
    const targetSimTimeMs = this._renderDeltaTimeMs * this._timeScale;
    this._simulationDeltaTimeMs = targetSimTimeMs;
    this._accumulatedSimTimeMs += targetSimTimeMs;

    // Límite de acumulación anti-bloqueo
    if (this._accumulatedSimTimeMs > this.MAX_DELTA_SPIKE_MS * this._timeScale) {
      this._accumulatedSimTimeMs = this.MAX_DELTA_SPIKE_MS * this._timeScale;
    }

    // 4. Generación de Substeps fijos para estabilidad física
    this._substeps = [];
    let stepsCount = 0;

    while (this._accumulatedSimTimeMs >= this.FIXED_SUBSTEP_MS && stepsCount < this.MAX_SUBSTEPS) {
      this._substeps.push(this.FIXED_SUBSTEP_MS);
      this._accumulatedSimTimeMs -= this.FIXED_SUBSTEP_MS;
      stepsCount++;
    }

    // Si después de los substeps queda un residuo o si la escala es menor a 1x (slow-motion)
    if (stepsCount === 0 && this._accumulatedSimTimeMs > 0.001) {
      this._substeps.push(this._accumulatedSimTimeMs);
      this._accumulatedSimTimeMs = 0;
    }
  }

  public reset(): void {
    this._accumulatedSimTimeMs = 0;
    this._renderDeltaTimeMs = 16.67;
    this._simulationDeltaTimeMs = 16.67;
    this._substeps = [16.67];
  }
}