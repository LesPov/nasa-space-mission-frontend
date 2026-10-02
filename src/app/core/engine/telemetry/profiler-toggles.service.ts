
import { Injectable, inject } from '@angular/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { DynamicLightingSystem } from '../runtime/systems/lighting/dynamic-lighting.system';
import { ShadowOrchestratorService } from '../runtime/shadows/shadow-orchestrator.service';
import { EngineProfilerService } from './engine-profiler.service';

@Injectable({ providedIn: 'root' })
export class ProfilerTogglesService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private dynLighting = inject(DynamicLightingSystem);
  private shadowOrch = inject(ShadowOrchestratorService);
  private profiler = inject(EngineProfilerService);

  public state = {
    glowOff: false,
    fxaaOff: false,
    fogOff: false,
    hwScaleHalf: false,
    shadowsOff: false,
    localLightsOff: false,
    postProcessOff: false
  };

  public toggleProfiling() {
    this.profiler.isProfilingEnabled = !this.profiler.isProfilingEnabled;
  }

  public setGlow(disable: boolean) {
    this.state.glowOff = disable;
    const motor = this.motor3d as any; 
    if (motor.glowLayer) {
      motor.glowLayer.intensity = disable ? 0 : 0.6;
    }
  }

  public setFxaa(disable: boolean) {
    this.state.fxaaOff = disable;
    const pipeline = this.motor3d.getRenderingPipeline();
    if (pipeline) {
      pipeline.fxaaEnabled = !disable;
    }
  }

  public setFog(disable: boolean) {
    this.state.fogOff = disable;
    const scene = this.motor3d.getScene();
    if (scene) {
      scene.fogEnabled = !disable;
    }
  }

  public setHwScaling(half: boolean) {
    this.state.hwScaleHalf = half;
    const engine = this.motor3d.getEngine();
    if (engine) {
      engine.setHardwareScalingLevel(half ? 2 : 1);
    }
  }

  public setShadows(disable: boolean) {
    this.state.shadowsOff = disable;
    (this.shadowOrch as any).profilerDisableShadows = disable;
  }

  public setLocalLights(disable: boolean) {
    this.state.localLightsOff = disable;
    (this.dynLighting as any).profilerDisableLocalLights = disable;
  }

  public setPostProcess(disable: boolean) {
    this.state.postProcessOff = disable;
    const pipeline = this.motor3d.getRenderingPipeline();
    if (pipeline) {
      pipeline.imageProcessingEnabled = !disable;
    }
  }
}