// file: src/app/core/engine/runtime/live/runtime-readiness-barrier.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { Scene, AbstractMesh, Vector3, Texture, MultiMaterial, Material } from '@babylonjs/core';
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

  private currentBarrierId = 0;
  private totalTrackedTasks = 7;
  private currentCompletedTasks = 0;

  public startReadiness(totalEstimatedTasks = 7): number {
    this.currentBarrierId++;
    this.totalTrackedTasks = Math.max(1, totalEstimatedTasks);
    this.currentCompletedTasks = 0;
    this.setStage('PREPARING_RESOURCES', 'Inicializando barrera de carga...', 'Preparando buffers de GPU');
    return this.currentBarrierId;
  }

  public isCurrentBarrier(barrierId: number): boolean {
    return this.currentBarrierId === barrierId;
  }

  public cancel(): void {
    this.currentBarrierId++;
    this.reset();
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

  public updateDetail(detail: string, percentageOverride?: number): void {
    const cur = this.progress();
    this.progress.set({
      ...cur,
      percentage: percentageOverride !== undefined ? Math.max(0, Math.min(100, percentageOverride)) : cur.percentage,
      detail
    });
  }

  private collectTexturesFromMaterial(mat: Material | null | undefined, out: Texture[]): void {
    if (!mat || (mat as any).isDisposed === true) return;

    if (mat.getClassName() === 'MultiMaterial') {
      const multi = mat as MultiMaterial;
      const subs = multi.subMaterials || [];
      for (let i = 0; i < subs.length; i++) {
        this.collectTexturesFromMaterial(subs[i], out);
      }
      return;
    }

    const anyMat = mat as any;
    const candidates = [
      anyMat.albedoTexture,
      anyMat.diffuseTexture,
      anyMat.opacityTexture,
      anyMat.emissiveTexture,
      anyMat.bumpTexture,
      anyMat.ambientTexture,
      anyMat.metallicTexture,
      anyMat.reflectivityTexture
    ];

    for (let i = 0; i < candidates.length; i++) {
      const tx = candidates[i];
      if (tx && typeof tx.isReady === 'function') {
        if (!out.includes(tx)) {
          out.push(tx);
        }
      }
    }
  }

  /**
   * Espera la estabilidad visual real:
   * 1. Verifica residencia de texturas en VRAM en el perímetro activo.
   * 2. Confirma la compilación de variantes de sombreadores para la cámara activa.
   * 3. Ejecuta fotogramas de renderizado consecutivos bajo la pantalla de carga.
   */
  public async waitForTrueStability(
    scene: Scene, 
    referencePosition: Vector3,
    relevanceRadius = 80.0,
    requiredStableFrames = 3, 
    barrierToken?: number,
    onProgress?: (msg: string, pct: number) => void
  ): Promise<boolean> {
    const activeToken = barrierToken ?? this.currentBarrierId;
    const stabilityStartTime = performance.now();

    this.setStage('CHECKING_STABILITY', 'Verificando preparación de texturas y materiales...', 'Comprobando VRAM');

    const isNullEngine = scene.getEngine().getClassName() === 'NullEngine';
    const materialMeshPairs: Array<{ mat: Material; mesh: AbstractMesh }> = [];
    const texturesToWait: Texture[] = [];
    const meshes = scene.meshes;
    const relRadiusSq = relevanceRadius * relevanceRadius;

    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (m && !m.isDisposed() && m.material) {
        const meshPos = m.getAbsolutePosition();
        if (Vector3.DistanceSquared(meshPos, referencePosition) <= relRadiusSq) {
          materialMeshPairs.push({ mat: m.material, mesh: m });
          this.collectTexturesFromMaterial(m.material, texturesToWait);
        }
      }
    }

    return new Promise<boolean>((resolve) => {
      let completedFrames = 0;
      const MAX_FRAMES = isNullEngine ? 4 : 30;
      const textureWaitTimeoutMs = 4000;
      const startTime = performance.now();

      const checkLoop = () => {
        if (this.currentBarrierId !== activeToken) {
          resolve(false);
          return;
        }

        completedFrames++;

        try {
          scene.render();
        } catch (e) {
          console.warn('[RuntimeReadinessBarrier] Error en fotograma de calentamiento:', e);
        }

        const elapsed = performance.now() - startTime;
        let pendingTextures = 0;

        if (elapsed < textureWaitTimeoutMs && !isNullEngine) {
          for (let t = 0; t < texturesToWait.length; t++) {
            const tx = texturesToWait[t];
            if (!tx.isReady()) {
              pendingTextures++;
            }
          }
        }

        let compilingCount = 0;
        if (!isNullEngine) {
          for (let i = 0; i < materialMeshPairs.length; i++) {
            const pair = materialMeshPairs[i];
            if (!this.materialSvc.isMaterialReadyForMesh(pair.mat, pair.mesh)) {
              compilingCount++;
            }
          }
        }

        const isReadyForCut = compilingCount === 0 && pendingTextures === 0 && completedFrames >= requiredStableFrames;

        if (onProgress) {
          const pct = Math.min(100, Math.round((completedFrames / requiredStableFrames) * 100));
          let msg = 'Estabilizando entorno...';
          if (pendingTextures > 0) {
            msg = `Cargando ${pendingTextures} texturas residentes...`;
          } else if (compilingCount > 0) {
            msg = `Compilando ${compilingCount} sombreadores...`;
          }
          onProgress(msg, pct);
          this.updateDetail(`Fotograma ${completedFrames}/${requiredStableFrames} (Sombreadores: ${compilingCount})`, 85 + Math.round(pct * 0.14));
        }

        if (isReadyForCut || completedFrames >= MAX_FRAMES) {
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