// file: src/app/core/engine/runtime/systems/adaptive-quality.system.ts
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
  
  private frameTimeAccumulator = 0;
  private frameCount = 0;
  private cooldownTimerMs = 0;
  
  // Ventana de evaluación ampliada para no reaccionar ante micro-picos normales de culling
  private readonly EVALUATION_FRAMES = 120; // 2 segundos completos de medición a 60 FPS
  private readonly COOLDOWN_MS = 5000;      // 5 segundos de histéresis obligatoria

  private readonly THRESHOLD_DOWNGRADE = 22.0; // Solo degrada si el promedio supera 22ms (>45 FPS sostenido)
  private readonly THRESHOLD_UPGRADE = 14.0;

  public get currentQualityTier(): QualityTier {
    return this.currentTier;
  }

  public update(dtMs: number): void {
    if (this.cooldownTimerMs > 0) {
      this.cooldownTimerMs -= dtMs;
      return;
    }

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

    console.log(`[AdaptiveQuality] Adaptando Tier de hardware: ${tier}`);

    switch (tier) {
      case 'HIGH':
        engine.setHardwareScalingLevel(1.0);
        if (pipeline) pipeline.fxaaEnabled = true;
        if (glow) glow.intensity = 0.6;
        break;
      
      case 'MEDIUM':
        engine.setHardwareScalingLevel(1.2); 
        if (pipeline) pipeline.fxaaEnabled = true; 
        if (glow) glow.intensity = 0.5; 
        break;

      case 'LOW':
        engine.setHardwareScalingLevel(1.5); 
        if (pipeline) pipeline.fxaaEnabled = false; 
        if (glow) glow.intensity = 0.0;
        break;
    }
  }

  public forceTier(tier: QualityTier): void {
    this.applyTier(tier);
    this.cooldownTimerMs = 8000;
  }
}