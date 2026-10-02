
import { Injectable, inject, Injector } from '@angular/core';
import { AdaptiveQualitySystem, QualityTier } from '../runtime/systems/adaptive-quality.system';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowQualityService, ShadowQualityTier } from '../runtime/shadows/shadow-quality.service';
 
export interface ProfilerMetrics {
  fps: number;
  frameTimeAvg: number;
  frameTimeP50: number;
  frameTimeP95: number;
  frameTimeP99: number;
  cpuPhases: Record<string, number>;
  cpuSystems: Record<string, number>;
  gpu: {
    drawCalls: number;
    activeMeshes: number;
    activeIndices: number;
    gpuFrameTime: number; 
    hardwareScaling: number;
    qualityTier: QualityTier;
    transparentMeshes: number;
  };
  lights: {
    totalVirtual: number;
    activePool: number;
    shadowedPool: number;
  };
  shadows: {
    shadowQualityLevel: ShadowQualityTier; // 🔥 Nueva propiedad de diagnóstico
    activeGenerators: number;
    totalCasters: number;
    csmMaxZ: number;
    csmCascades: number;
    invalidations: number;
    renderListRebuilds: number;
    staticCastersFrozen: number;
    dynamicCastersActive: number;
  };
  spaces: {
    containmentRebuilds: number;
    cacheHits: number;
    cacheMisses: number;
  }; 
}

@Injectable({ providedIn: 'root' })
export class EngineProfilerService {
  public isProfilingEnabled = false;

  private adaptiveQuality: AdaptiveQualitySystem | null = null;
  private shadowCache = inject(ShadowCache);
  private shadowQualitySvc = inject(ShadowQualityService); // 🔥 Inyectado para Snapshot
  private injector = inject(Injector);

  private _containmentSvc: LightContainmentService | null = null;
  private get containmentSvc(): LightContainmentService {
    if (!this._containmentSvc) {
      this._containmentSvc = this.injector.get(LightContainmentService);
    }
    return this._containmentSvc;
  }

  private readonly BUFFER_SIZE = 300;
  private frameTimeBuffer = new Float32Array(this.BUFFER_SIZE);
  private bufferIndex = 0;
  private bufferCount = 0;

  private currentPhases: Record<string, number> = {};
  private currentSystems: Record<string, number> = {};

  private avgPhases: Record<string, number> = {};
  private avgSystems: Record<string, number> = {};

  private sceneInstr: any = null;
  private engineInstr: any = null;
  private lightSys: any = null;
  private shadowSys: any = null;
  private engine: any = null;
  private currentFps = 0;

  public attachInstruments(sceneInstr: any, engineInstr: any, lightSys: any, shadowSys: any, engine: any) {
    this.sceneInstr = sceneInstr;
    this.engineInstr = engineInstr;
    this.lightSys = lightSys;
    this.shadowSys = shadowSys;
    this.engine = engine;
  }

  public setAdaptiveSystem(system: AdaptiveQualitySystem) {
    this.adaptiveQuality = system;
  }

  public setFps(fps: number) {
    this.currentFps = fps;
  }

  public recordFrameTime(timeMs: number) {
    if (!this.isProfilingEnabled) return;
    this.frameTimeBuffer[this.bufferIndex] = timeMs;
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    if (this.bufferCount < this.BUFFER_SIZE) this.bufferCount++;
  }

  public recordPhaseTime(phaseName: string, timeMs: number) {
    if (!this.isProfilingEnabled) return;
    this.currentPhases[phaseName] = (this.currentPhases[phaseName] || 0) + timeMs;
  }

  public recordSystemTime(systemName: string, timeMs: number) {
    if (!this.isProfilingEnabled) return;
    this.currentSystems[systemName] = (this.currentSystems[systemName] || 0) + timeMs;
  }

  public endFrame() {
    if (!this.isProfilingEnabled) return;
    const alpha = 0.1;
    for (const key in this.currentPhases) {
      this.avgPhases[key] = (this.avgPhases[key] || 0) * (1 - alpha) + this.currentPhases[key] * alpha;
      this.currentPhases[key] = 0;
    }
    for (const key in this.currentSystems) {
      this.avgSystems[key] = (this.avgSystems[key] || 0) * (1 - alpha) + this.currentSystems[key] * alpha;
      this.currentSystems[key] = 0;
    }
    
    if (this.bufferIndex % 60 === 0) {
      this.shadowCache.clearMetrics();
    }
  }

  public getSnapshot(): ProfilerMetrics {
    const validCount = this.bufferCount;
    let avg = 0, p50 = 0, p95 = 0, p99 = 0;

    // 🔥 Zero-allocation sorting and computing (ya estaba bien implementado, lo mantenemos estricto)
    if (validCount > 0) {
      const activeBuffer = new Float32Array(this.frameTimeBuffer.buffer, 0, validCount);
      const sorted = new Float32Array(activeBuffer).sort();
      
      let sum = 0;
      for (let i = 0; i < validCount; i++) sum += sorted[i];
      avg = sum / validCount;

      p50 = sorted[Math.floor(validCount * 0.50)];
      p95 = sorted[Math.floor(validCount * 0.95)];
      p99 = sorted[Math.floor(validCount * 0.99)];
    }

    const gpuTime = this.engineInstr?.gpuFrameTimeCounter?.current || 0;
    const drawCalls = this.sceneInstr?.drawCallsCounter?.current || 0;
    const activeMeshes = this.sceneInstr?.scene?.getActiveMeshes()?.length || 0; 
    
    let transparentMeshes = 0;
    if (this.sceneInstr?.scene) {
        const am = this.sceneInstr.scene.getActiveMeshes();
        for(let i=0; i<am.length; i++) {
            if (am.data[i].material && am.data[i].material.needAlphaBlending()) {
                transparentMeshes++;
            }
        }
    }

    let lightMetrics = { totalVirtual: 0, activePool: 0, shadowedPool: 0 };
    if (this.lightSys && typeof this.lightSys.getProfilerMetrics === 'function') {
      lightMetrics = this.lightSys.getProfilerMetrics();
    }

    let shadowMetrics = { activeGenerators: 0, totalCasters: 0, csmMaxZ: 0, csmCascades: 0 };
    if (this.shadowSys && typeof this.shadowSys.getProfilerMetrics === 'function') {
      shadowMetrics = this.shadowSys.getProfilerMetrics();
    }

    const engine = this.engine;

    return {
      fps: this.currentFps,
      frameTimeAvg: avg,
      frameTimeP50: p50,
      frameTimeP95: p95,
      frameTimeP99: p99,
      cpuPhases: { ...this.avgPhases },
      cpuSystems: { ...this.avgSystems },
      gpu: {
        drawCalls,
        activeMeshes,
        activeIndices: this.sceneInstr?.scene?.getActiveIndices() || 0,
        gpuFrameTime: gpuTime * 0.000001,
        hardwareScaling: engine ? engine.getHardwareScalingLevel() : 1.0,
        qualityTier: this.adaptiveQuality ? this.adaptiveQuality.currentQualityTier : 'HIGH',
        transparentMeshes
      },
      lights: lightMetrics,
      shadows: {
        ...shadowMetrics,
        shadowQualityLevel: this.shadowQualitySvc.getQualityTier(), // 🔥 Incluido en el snapshot
        invalidations: this.shadowCache.metrics.invalidations,
        renderListRebuilds: this.shadowCache.metrics.renderListRebuilds,
        staticCastersFrozen: this.shadowCache.metrics.staticLights,
        dynamicCastersActive: this.shadowCache.metrics.dynamicLights
      },
      spaces: {
        containmentRebuilds: this.containmentSvc.metrics.containmentRebuilds,
        cacheHits: this.containmentSvc.metrics.cacheHits,
        cacheMisses: this.containmentSvc.metrics.cacheMisses
      }
    };
  }

  public printSnapshotToConsole() {
    const snap = this.getSnapshot();
    console.log("===== PROFILING SNAPSHOT =====");
    console.log(JSON.stringify(snap, null, 2));
    console.log("==============================");
  }
}
