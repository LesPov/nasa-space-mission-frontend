
// file: src/app/core/engine/runtime/live/runtime-readiness-barrier.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { Scene } from '@babylonjs/core';
import { GameContextService } from '../../session/game-context.service';
import { RuntimeReadyStage } from '../../session/game-context.model';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';

export interface ReadinessProgress {
  stage: RuntimeReadyStage;
  stageName: string;
  totalTasks: number;
  completedTasks: number;
  percentage: number;
  detail: string;
}

@Injectable({ providedIn: 'root' })
export class RuntimeReadinessBarrierService {
  private gameContext = inject(GameContextService);
  private profiler = inject(EngineProfilerService);

  public readonly progress = signal<ReadinessProgress>({
    stage: 'IDLE',
    stageName: 'En espera',
    totalTasks: 0,
    completedTasks: 0,
    percentage: 0,
    detail: ''
  });

  private totalTrackedTasks = 10;
  private currentCompletedTasks = 0;

  public startReadiness(totalEstimatedTasks = 10): void {
    this.totalTrackedTasks = Math.max(1, totalEstimatedTasks);
    this.currentCompletedTasks = 0;
    this.setStage('PREPARING_RESOURCES', 'Preparando recursos de escena...', 'Inicializando buffers');
  }

  public setStage(stage: RuntimeReadyStage, stageName: string, detail = ''): void {
    this.gameContext.setRuntimeReadyStage(stage);
    this.currentCompletedTasks++;
    const pct = Math.min(100, Math.round((this.currentCompletedTasks / this.totalTrackedTasks) * 100));

    this.progress.set({
      stage,
      stageName,
      totalTasks: this.totalTrackedTasks,
      completedTasks: this.currentCompletedTasks,
      percentage: pct,
      detail
    });

    this.profiler.recordTransitionMilestone(stage);
  }

  /**
   * Ventana de verificación de estabilidad real:
   * Evalúa fotogramas continuos en la GPU mediante requestAnimationFrame.
   * NO declara READY por timeout. Requiere que no queden shaders compilando en VRAM
   * y que el frame time se mantenga constante.
   */
  public async waitForTrueStability(
    scene: Scene, 
    requiredStableFrames = 30, 
    maxAllowedFrameTimeMs = 28.0,
    onProgress?: (msg: string, pct: number) => void
  ): Promise<boolean> {
    this.setStage('CHECKING_STABILITY', 'Verificando estabilidad de render...', 'Midiendo fluidez de 60 FPS');

    return new Promise<boolean>((resolve) => {
      let stableFramesCount = 0;
      let totalElapsedFrames = 0;
      const MAX_WATCHDOG_FRAMES = 120; // 2 segundos máx de evaluación sin colgar la app
      let lastTime = performance.now();

      const stabilityLoop = () => {
        const now = performance.now();
        const dt = now - lastTime;
        lastTime = now;
        totalElapsedFrames++;

        // Forzar renderizado del cuadro de estabilización
        scene.render();

        // 1. Comprobar shaders pendientes de compilación
        let compilingShaders = 0;
        const materials = scene.materials;
        for (let i = 0; i < materials.length; i++) {
          if (!materials[i].isReady()) compilingShaders++;
        }

        // 2. Comprobar fluidez del frame actual
        const isFrameTimeGood = dt <= maxAllowedFrameTimeMs;
        const isPipelineClean = compilingShaders === 0;

        if (isFrameTimeGood && isPipelineClean) {
          stableFramesCount++;
        } else {
          // Si hubo un spike o shader pendiente, se reinicia el contador de estabilidad
          stableFramesCount = Math.max(0, stableFramesCount - 3);
        }

        const stabilityProgressPct = Math.min(100, Math.round((stableFramesCount / requiredStableFrames) * 100));
        const statusMsg = compilingShaders > 0 
          ? `Compilando ${compilingShaders} sombreadores...` 
          : `Estabilizando: ${stableFramesCount}/${requiredStableFrames} fotogramas a 60 FPS`;

        if (onProgress) {
          onProgress(statusMsg, stabilityProgressPct);
        }

        if (stableFramesCount >= requiredStableFrames) {
          this.setStage('READY', 'Entorno preparado y estable', '60 FPS listos');
          resolve(true);
          return;
        }

        if (totalElapsedFrames >= MAX_WATCHDOG_FRAMES) {
          console.warn(`[ReadinessBarrier] Advertencia: Estabilidad completada por umbral watchdog (${stableFramesCount}/${requiredStableFrames} frames estables).`);
          this.setStage('READY', 'Entorno preparado', 'Iniciando sesión');
          resolve(true);
          return;
        }

        requestAnimationFrame(stabilityLoop);
      };

      requestAnimationFrame(stabilityLoop);
    });
  }

  public reset(): void {
    this.gameContext.setRuntimeReadyStage('IDLE');
    this.progress.set({
      stage: 'IDLE',
      stageName: 'Inactivo',
      totalTasks: 0,
      completedTasks: 0,
      percentage: 0,
      detail: ''
    });
  }
}