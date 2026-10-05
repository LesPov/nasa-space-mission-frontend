
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

  public async waitForTrueStability(
    scene: Scene, 
    requiredStableFrames = 25, 
    maxAllowedFrameTimeMs = 28.0,
    onProgress?: (msg: string, pct: number) => void
  ): Promise<boolean> {
    const stabilityStartTime = performance.now();
    this.setStage('CHECKING_STABILITY', 'Verificando estabilidad de render...', 'Midiendo fluidez de 60 FPS');

    this.profiler.recordTimelineEvent('READINESS', 'WAIT_START', {
      requiredStableFrames,
      maxAllowedFrameTimeMs
    });

    return new Promise<boolean>((resolve) => {
      let stableFramesCount = 0;
      let totalElapsedFrames = 0;
      let lostFramesCount = 0;
      const MAX_WATCHDOG_FRAMES = 120;
      let lastTime = performance.now();

      const stabilityLoop = () => {
        const now = performance.now();
        const dt = now - lastTime;
        lastTime = now;
        totalElapsedFrames++;

        scene.render();

        let compilingShaders = 0;
        const materials = scene.materials;
        for (let i = 0; i < materials.length; i++) {
          if (!materials[i].isReady()) compilingShaders++;
        }

        const isFrameTimeGood = dt <= maxAllowedFrameTimeMs;
        const isPipelineClean = compilingShaders === 0;

        if (isFrameTimeGood && isPipelineClean) {
          stableFramesCount++;
          this.profiler.recordTimelineEvent('READINESS', 'STABLE_FRAME_ACCEPTED', {
            frameTime: parseFloat(dt.toFixed(2)),
            stableCount: stableFramesCount,
            compilingShaders
          });
        } else {
          lostFramesCount++;
          this.profiler.recordTimelineEvent('READINESS', 'STABLE_FRAME_REJECTED', {
            frameTime: parseFloat(dt.toFixed(2)),
            reason: !isFrameTimeGood ? 'FRAME_TIME_EXCEEDED' : 'SHADERS_NOT_READY',
            compilingShaders,
            stableCount: stableFramesCount
          });
          stableFramesCount = Math.max(0, stableFramesCount - 2);
        }

        const stabilityProgressPct = Math.min(100, Math.round((stableFramesCount / requiredStableFrames) * 100));
        const statusMsg = compilingShaders > 0 
          ? `Compilando ${compilingShaders} sombreadores...` 
          : `Estabilizando niebla y entorno: ${stableFramesCount}/${requiredStableFrames}`;

        if (onProgress) {
          onProgress(statusMsg, stabilityProgressPct);
        }

        if (stableFramesCount >= requiredStableFrames) {
          const totalDuration = performance.now() - stabilityStartTime;
          this.setStage('READY', 'Entorno preparado y estable', '60 FPS listos');
          this.profiler.recordTimelineEvent('READINESS', 'READY', {
            totalDurationMs: parseFloat(totalDuration.toFixed(2)),
            totalElapsedFrames,
            lostFramesCount,
            stableFramesCount
          });
          resolve(true);
          return;
        }

        if (totalElapsedFrames >= MAX_WATCHDOG_FRAMES) {
          const totalDuration = performance.now() - stabilityStartTime;
          this.setStage('READY', 'Entorno preparado', 'Iniciando sesión');
          this.profiler.recordTimelineEvent('READINESS', 'TIMEOUT_WATCHDOG', {
            totalDurationMs: parseFloat(totalDuration.toFixed(2)),
            totalElapsedFrames,
            lostFramesCount,
            stableFramesCount
          });
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