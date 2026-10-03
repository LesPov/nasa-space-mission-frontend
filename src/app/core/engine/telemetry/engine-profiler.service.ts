
// src/app/core/engine/telemetry/engine-profiler.service.ts

import { Injectable, inject, Injector } from '@angular/core';
import { AdaptiveQualitySystem, QualityTier } from '../runtime/systems/adaptive-quality.system';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowQualityService, ShadowQualityTier } from '../runtime/shadows/shadow-quality.service';
import { LightRegistryService } from '../runtime/systems/lighting/light-registry.service';
import { LightPoolService } from '../runtime/systems/lighting/light-pool.service';
import { LocalRenderingSystem } from '../runtime/systems/local-rendering.system';
import { GameContextService } from '../session/game-context.service';

export interface LightForensicRecord {
  uid: string;
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
  distance: number;
  isLightInRange: boolean;
  isShadowInRange: boolean;
  baseIntensity: number;
  targetMultiplier: number;
  currentMultiplier: number;
  finalIntensity: number;
  containmentMode: string;
  hasShadowGenerator: boolean;
  renderListSize: number;
  isStatic: boolean;
}

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
    totalMeshes: number;
    visibleMeshes: number;
  };
  lights: {
    totalVirtual: number;
    activePool: number;
    shadowedPool: number;
    details: LightForensicRecord[];
  };
  shadows: {
    shadowQualityLevel: ShadowQualityTier;
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
  culling: {
    visibleObjects: number;
    fadingObjects: number;
    hardCulledObjects: number;
    restoringObjects: number;
    shadowProtectedObjects: number;
  };
  session: {
    mode: string;
    cameraView: string;
    timestamp: string;
    runtimeReadyStage: string;
  };
}

@Injectable({ providedIn: 'root' })
export class EngineProfilerService {
  public isProfilingEnabled = false;

  private adaptiveQuality: AdaptiveQualitySystem | null = null;
  private shadowCache = inject(ShadowCache);
  private shadowQualitySvc = inject(ShadowQualityService);
  private gameContext = inject(GameContextService);
  private injector = inject(Injector);

  private _lightRegistry: LightRegistryService | null = null;
  private get lightRegistry(): LightRegistryService {
    if (!this._lightRegistry) {
      this._lightRegistry = this.injector.get(LightRegistryService);
    }
    return this._lightRegistry;
  }

  private _lightPool: LightPoolService | null = null;
  private get lightPool(): LightPoolService {
    if (!this._lightPool) {
      this._lightPool = this.injector.get(LightPoolService);
    }
    return this._lightPool;
  }

  private _containmentSvc: LightContainmentService | null = null;
  private get containmentSvc(): LightContainmentService {
    if (!this._containmentSvc) {
      this._containmentSvc = this.injector.get(LightContainmentService);
    }
    return this._containmentSvc;
  }

  private _localRendering: LocalRenderingSystem | null = null;
  private get localRendering(): LocalRenderingSystem {
    if (!this._localRendering) {
      this._localRendering = this.injector.get(LocalRenderingSystem);
    }
    return this._localRendering;
  }

  private readonly BUFFER_SIZE = 120;
  private frameTimeBuffer = new Float32Array(this.BUFFER_SIZE);
  private bufferIndex = 0;
  private bufferCount = 0;

  private readonly HISTORY_SIZE = 120;
  private historyBuffer: Array<{ frameId: number; fps: number; frameTime: number; drawCalls: number; activeMeshes: number }> = [];
  private frameCounter = 0;

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

  public attachInstruments(sceneInstr: any, engineInstr: any, lightSys: any, shadowSys: any, engine: any): void {
    this.sceneInstr = sceneInstr;
    this.engineInstr = engineInstr;
    this.lightSys = lightSys;
    this.shadowSys = shadowSys;
    this.engine = engine;
  }

  public setAdaptiveSystem(system: AdaptiveQualitySystem): void {
    this.adaptiveQuality = system;
  }

  public setFps(fps: number): void {
    this.currentFps = fps;
  }

  public recordFrameTime(timeMs: number): void {
    if (!this.isProfilingEnabled) return;
    this.frameCounter++;
    this.frameTimeBuffer[this.bufferIndex] = timeMs;
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    if (this.bufferCount < this.BUFFER_SIZE) this.bufferCount++;

    if (this.frameCounter % 2 === 0) {
      const drawCalls = this.sceneInstr?.drawCallsCounter?.current || 0;
      const activeMeshes = this.sceneInstr?.scene?.getActiveMeshes()?.length || 0;
      this.historyBuffer.push({
        frameId: this.frameCounter,
        fps: this.currentFps,
        frameTime: timeMs,
        drawCalls,
        activeMeshes
      });
      if (this.historyBuffer.length > this.HISTORY_SIZE) {
        this.historyBuffer.shift();
      }
    }
  }

  public getRecentHistory() {
    return this.historyBuffer;
  }

  public recordPhaseTime(phaseName: string, timeMs: number): void {
    if (!this.isProfilingEnabled) return;
    this.currentPhases[phaseName] = (this.currentPhases[phaseName] || 0) + timeMs;
  }

  public recordSystemTime(systemName: string, timeMs: number): void {
    if (!this.isProfilingEnabled) return;
    this.currentSystems[systemName] = (this.currentSystems[systemName] || 0) + timeMs;
  }

  public endFrame(): void {
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

  public getSnapshot(includeDeepLights: boolean = false): ProfilerMetrics {
    const validCount = this.bufferCount;
    let avg = 0, p50 = 0, p95 = 0, p99 = 0;

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
    const totalMeshes = this.sceneInstr?.scene?.meshes?.length || 0;

    let transparentMeshes = 0;
    let visibleMeshesCount = 0;
    if (this.sceneInstr?.scene) {
      const am = this.sceneInstr.scene.getActiveMeshes();
      for (let i = 0; i < am.length; i++) {
        if (am.data[i].isVisible) visibleMeshesCount++;
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

    const lightDetails: LightForensicRecord[] = [];
    if (includeDeepLights) {
      try {
        const virtuals = this.lightRegistry.getVirtualLights();
        const slots = this.lightPool.getAllSlots();

        for (let i = 0; i < virtuals.length; i++) {
          const vl = virtuals[i];
          const slot = slots.find(s => s.assignedEntityUid === vl.entity.uid);
          const lightComp = vl.entity.light;
          const pos = vl.entity.view ? vl.entity.view.getAbsolutePosition() : { x: vl.entity.transform.position.x, y: vl.entity.transform.position.y, z: vl.entity.transform.position.z };

          lightDetails.push({
            uid: vl.entity.uid,
            name: vl.entity.name,
            type: vl.entity.type,
            position: { x: parseFloat(pos.x.toFixed(1)), y: parseFloat(pos.y.toFixed(1)), z: parseFloat(pos.z.toFixed(1)) },
            distance: parseFloat(vl.lastEvaluatedDistance.toFixed(1)),
            isLightInRange: vl.isLightInRange,
            isShadowInRange: vl.isShadowInRange,
            baseIntensity: lightComp?.intensity || 1.0,
            targetMultiplier: parseFloat(vl.targetMultiplier.toFixed(2)),
            currentMultiplier: parseFloat(vl.currentMultiplier.toFixed(2)),
            finalIntensity: parseFloat(((lightComp?.renderIntensity || lightComp?.intensity || 1.0) * vl.currentMultiplier).toFixed(2)),
            containmentMode: lightComp?.containmentMode || 'GLOBAL',
            hasShadowGenerator: !!slot?.sg,
            renderListSize: slot?.sg ? (slot.sg.getShadowMap()?.renderList?.length || 0) : 0,
            isStatic: slot?.isStaticLight ?? true
          });
        }
      } catch (e) {
        // Fallback defensivo
      }
    }

    const cullingMetrics = this.localRendering ? this.localRendering.getMetrics() : {
      visibleObjects: visibleMeshesCount,
      fadingObjects: 0,
      hardCulledObjects: 0,
      restoringObjects: 0,
      shadowProtectedObjects: 0
    };

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
        transparentMeshes,
        totalMeshes,
        visibleMeshes: visibleMeshesCount
      },
      lights: {
        ...lightMetrics,
        details: lightDetails
      },
      shadows: {
        ...shadowMetrics,
        shadowQualityLevel: this.shadowQualitySvc.getQualityTier(),
        invalidations: this.shadowCache.metrics.invalidations,
        renderListRebuilds: this.shadowCache.metrics.renderListRebuilds,
        staticCastersFrozen: this.shadowCache.metrics.staticLights,
        dynamicCastersActive: this.shadowCache.metrics.dynamicLights
      },
      spaces: {
        containmentRebuilds: this.containmentSvc.metrics.containmentRebuilds,
        cacheHits: this.containmentSvc.metrics.cacheHits,
        cacheMisses: this.containmentSvc.metrics.cacheMisses
      },
      culling: cullingMetrics,
      session: {
        mode: this.gameContext.mode(),
        cameraView: this.gameContext.cameraView(),
        timestamp: new Date().toLocaleTimeString(),
        runtimeReadyStage: this.gameContext.runtimeReadyStage()
      }
    };
  }

  public printSnapshotToConsole(): void {
    const snap = this.getSnapshot(true);
    console.log("===== PROFILING FORENSIC SNAPSHOT =====");
    console.log(JSON.stringify(snap, null, 2));
    console.log("=======================================");
  }
}