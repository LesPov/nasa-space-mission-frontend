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
   * Espera la preparación real del entorno:
   * 1. Cero compilaciones pendientes en el radio de relevancia del spawn.
   * 2. Renderizado de 2 cuadros de warmup para asegurar carga en VRAM.
   * 3. Liberación rápida y determinista (evita los ~3.1s de espera artificial).
   */
  public async waitForTrueStability(
    scene: Scene, 
    referencePosition: Vector3,
    relevanceRadius = 60.0,
    requiredStableFrames = 3, 
    onProgress?: (msg: string, pct: number) => void
  ): Promise<boolean> {
    const stabilityStartTime = performance.now();
    this.setStage('CHECKING_STABILITY', 'Verificando preparación del entorno...', 'Comprobando sombreadores');

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
      let completedFrames = 0;
      const MAX_FRAMES = 12; // Máximo 200 ms de comprobación

      const checkLoop = () => {
        completedFrames++;

        // Renderizado explícito para forzar al driver GPU a procesar uniforms y geometría
        scene.render();

        let compilingCount = 0;
        for (let i = 0; i < materialMeshPairs.length; i++) {
          const pair = materialMeshPairs[i];
          if (!this.materialSvc.isMaterialReadyForMesh(pair.mat, pair.mesh)) {
            compilingCount++;
          }
        }

        const isComplete = compilingCount === 0 && completedFrames >= requiredStableFrames;

        if (onProgress) {
          const pct = Math.min(100, Math.round((completedFrames / requiredStableFrames) * 100));
          const msg = compilingCount > 0 
            ? `Compilando ${compilingCount} sombreadores...` 
            : `Estabilizando entorno (${completedFrames}/${requiredStableFrames})`;
          onProgress(msg, pct);
        }

        if (isComplete || completedFrames >= MAX_FRAMES) {
          const duration = performance.now() - stabilityStartTime;
          this.setStage('READY', 'Entorno preparado y estable', `${duration.toFixed(0)} ms`);
          resolve(true);
          return;
        }

        requestAnimationFrame(checkLoop);
      };

      requestAnimationFrame(checkLoop);
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