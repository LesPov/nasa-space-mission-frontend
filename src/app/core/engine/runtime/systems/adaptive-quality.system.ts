
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';

export type QualityTier = 'HIGH' | 'MEDIUM' | 'LOW';

@Injectable({ providedIn: 'root' })
export class AdaptiveQualitySystem implements IUpdatable {
  public id = 'AdaptiveQualitySystem';
  
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private profiler = inject(EngineProfilerService);

  private currentTier: QualityTier = 'HIGH';
  
  // Histéresis y Cooldown
  private frameTimeAccumulator = 0;
  private frameCount = 0;
  private cooldownTimerMs = 0;
  
  private readonly EVALUATION_FRAMES = 60; // Evaluar cada 60 frames (aprox 1 segundo)
  private readonly COOLDOWN_MS = 3000; // 3 segundos de espera tras un cambio de tier

  // Umbrales de FrameTime (16.67ms = 60fps, 22.22ms = 45fps, 33.33ms = 30fps)
  private readonly THRESHOLD_DOWNGRADE = 19.0; // Si el frame promedio supera 19ms, bajamos calidad
  private readonly THRESHOLD_UPGRADE = 14.0;   // Si el frame promedio baja de 14ms, subimos calidad

  public get currentQualityTier(): QualityTier {
    return this.currentTier;
  }

  public update(dtMs: number): void {
    if (this.cooldownTimerMs > 0) {
      this.cooldownTimerMs -= dtMs;
      return;
    }

    // Usamos el frame time real desde el motor, no el simulado
    const engine = this.motor3d.getEngine();
    if (!engine) return;
    
    this.frameTimeAccumulator += engine.getDeltaTime();
    this.frameCount++;

    if (this.frameCount >= this.EVALUATION_FRAMES) {
      const avgFrameTime = this.frameTimeAccumulator / this.frameCount;
      
      if (avgFrameTime > this.THRESHOLD_DOWNGRADE) {
        this.downgradeQuality();
      } else if (avgFrameTime < this.THRESHOLD_UPGRADE) {
        this.upgradeQuality();
      }

      this.frameTimeAccumulator = 0;
      this.frameCount = 0;
    }
  }

  private downgradeQuality(): void {
    if (this.currentTier === 'HIGH') {
      this.applyTier('MEDIUM');
    } else if (this.currentTier === 'MEDIUM') {
      this.applyTier('LOW');
    }
  }

  private upgradeQuality(): void {
    if (this.currentTier === 'LOW') {
      this.applyTier('MEDIUM');
    } else if (this.currentTier === 'MEDIUM') {
      this.applyTier('HIGH');
    }
  }

  private applyTier(tier: QualityTier): void {
    if (this.currentTier === tier) return;
    
    const engine = this.motor3d.getEngine();
    const pipeline = this.motor3d.getRenderingPipeline();
    const glow = (this.motor3d as any).glowLayer;

    this.currentTier = tier;
    this.cooldownTimerMs = this.COOLDOWN_MS;

    console.log(`[AdaptiveQuality] Cambiando a Tier: ${tier}`);

    switch (tier) {
      case 'HIGH':
        engine.setHardwareScalingLevel(1.0); // Resolucion Nativa
        if (pipeline) pipeline.fxaaEnabled = true;
        if (glow) glow.intensity = 0.6;
        break;
      
      case 'MEDIUM':
        // Reduce el fill-rate renderizando a menor resolución y escalando
        engine.setHardwareScalingLevel(1.3); 
        if (pipeline) pipeline.fxaaEnabled = true; // FXAA ayuda a disimular el escalado
        if (glow) glow.intensity = 0.0; // Desactivar glow elimina un render pass pesado
        break;

      case 'LOW':
        engine.setHardwareScalingLevel(1.8); // Resolución muy agresiva
        if (pipeline) pipeline.fxaaEnabled = false; // Desactivar FXAA ahorra procesamiento de fragmentos
        if (glow) glow.intensity = 0.0;
        break;
    }
  }

  // Permite forzar la calidad desde la UI de Debug
  public forceTier(tier: QualityTier): void {
    this.applyTier(tier);
    this.cooldownTimerMs = 5000; // Bloquear auto-adaptación por 5 segundos si el usuario fuerza
  }
}