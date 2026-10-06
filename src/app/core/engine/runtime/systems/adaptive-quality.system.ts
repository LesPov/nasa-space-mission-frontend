// file: src/app/core/engine/runtime/systems/adaptive-quality.system.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';

export type QualityTier = 'HIGH' | 'MEDIUM' | 'LOW';

@Injectable({ providedIn: 'root' })
export class AdaptiveQualitySystem implements IUpdatable {
  public id = 'AdaptiveQualitySystem';
  
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private profiler = inject(EngineProfilerService);
  private context = inject(GameContextService);

  private currentTier: QualityTier = 'HIGH';
  
  private frameTimeAccumulator = 0;
  private frameCount = 0;
  private cooldownTimerMs = 0;
  
  // Evaluación a baja frecuencia para eliminar overhead en CPU
  private readonly EVALUATION_FRAMES = 180; // 3 segundos completos de medición
  private readonly COOLDOWN_MS = 6000;      // 6 segundos de histéresis estricta

  private readonly THRESHOLD_DOWNGRADE = 24.0; // Solo degrada si el frametime supera 24ms de forma sostenida
  private readonly THRESHOLD_UPGRADE = 14.0;

  public get currentQualityTier(): QualityTier {
    return this.currentTier;
  }

  public update(dtMs: number): void {
    const mode = this.context.mode();
    // En el Editor o durante transiciones / carga inicial, el sistema adaptativo no debe intervenir
    if (mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME || this.context.isTransitioning()) {
      return;
    }

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
        engine.setHardwareScalingLevel(1.15); 
        if (pipeline) pipeline.fxaaEnabled = true; 
        if (glow) glow.intensity = 0.5; 
        break;

      case 'LOW':
        engine.setHardwareScalingLevel(1.3); 
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