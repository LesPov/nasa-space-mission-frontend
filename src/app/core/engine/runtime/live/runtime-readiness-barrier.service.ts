// file: src/app/core/engine/runtime/live/runtime-readiness-barrier.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { Scene, AbstractMesh, Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../session/game-context.service';
import { RuntimeReadyStage } from '../../session/game-context.model';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
import { CoreSceneMaterialService } from '../../scene/utils/core-scene-material.service';

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
  private materialSvc = inject(CoreSceneMaterialService);

  public readonly progress = signal<ReadinessProgress>({
    stage: 'IDLE',
    stageName: 'En espera',
    totalTasks: 0,
    completedTasks: 0,
    percentage: 0,
    detail: ''
  });

  private totalTrackedTasks = 8;
  private currentCompletedTasks = 0;

  public startReadiness(totalEstimatedTasks = 8): void {
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
   * Evalúa la estabilidad real del pipeline de renderizado basándose en:
   * 1. 0 compilaciones pendientes en mallas relevantes cercanas al spawn.
   * 2. Varianza de frametime acotada (estabilidad de entrega entre frames consecutivos).
   * 3. Sin retrasos artificiales fijos ni requerimientos de framerate absoluto inalcanzables.
   */
  public async waitForTrueStability(
    scene: Scene, 
    referencePosition: Vector3,
    relevanceRadius = 60.0,
    requiredStableFrames = 6, 
    maxVarianceMs = 12.0,
    onProgress?: (msg: string, pct: number) => void
  ): Promise<boolean> {
    const stabilityStartTime = performance.now();
    this.setStage('CHECKING_STABILITY', 'Verificando estabilidad de render...', 'Comprobando fluidez');

    // Filtrar únicamente mallas en el radio relevante del jugador
    const materialMeshPairs: Array<{ mat: any; mesh: AbstractMesh }> = [];
    const meshes = scene.meshes;
    const relRadiusSq = relevanceRadius * relevanceRadius;

    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (m && !m.isDisposed() && m.material && m.isVisible) {
        const meshPos = m.getAbsolutePosition();
        if (Vector3.DistanceSquared(meshPos, referencePosition) <= relRadiusSq) {
          materialMeshPairs.push({ mat: m.material, mesh: m });
        }
      }
    }

    return new Promise<boolean>((resolve) => {
      let stableFramesCount = 0;
      let totalElapsedFrames = 0;
      const MAX_WATCHDOG_FRAMES = 35; // Límite máximo de seguridad (menos de 600ms a 60 FPS)
      let prevDt = 16.66;
      let lastTime = performance.now();

      const stabilityLoop = () => {
        const now = performance.now();
        const dt = Math.max(1.0, now - lastTime);
        lastTime = now;
        totalElapsedFrames++;

        scene.render();

        // Verificar si algún material del área relevante sigue compilando en VRAM
        let compilingShaders = 0;
        for (let i = 0; i < materialMeshPairs.length; i++) {
          const pair = materialMeshPairs[i];
          if (!this.materialSvc.isMaterialReadyForMesh(pair.mat, pair.mesh)) {
            compilingShaders++;
          }
        }

        // Calibración adaptativa: El frame es estable si los shaders están listos y no hay saltos bruscos entre frames
        const frameJitter = Math.abs(dt - prevDt);
        prevDt = dt;

        const isWarmupFrame = totalElapsedFrames <= 2;
        const isPipelineClean = compilingShaders === 0;
        const isSmoothDelivery = frameJitter <= maxVarianceMs || isWarmupFrame;

        if (isPipelineClean && isSmoothDelivery && !isWarmupFrame) {
          stableFramesCount++;
        } else if (!isWarmupFrame) {
          stableFramesCount = Math.max(0, stableFramesCount - 1);
        }

        const stabilityProgressPct = Math.min(100, Math.round((stableFramesCount / requiredStableFrames) * 100));
        const statusMsg = compilingShaders > 0 
          ? `Compilando ${compilingShaders} sombreadores...` 
          : `Estabilizando entorno: ${stableFramesCount}/${requiredStableFrames}`;

        if (onProgress) {
          onProgress(statusMsg, stabilityProgressPct);
        }

        if (stableFramesCount >= requiredStableFrames || totalElapsedFrames >= MAX_WATCHDOG_FRAMES) {
          const totalDuration = performance.now() - stabilityStartTime;
          this.setStage('READY', 'Entorno preparado y estable', `${totalDuration.toFixed(0)} ms`);
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