
// file: src/app/core/engine/telemetry/engine-profiler.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { AdaptiveQualitySystem, QualityTier } from '../runtime/systems/adaptive-quality.system';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowQualityService, ShadowQualityTier } from '../runtime/shadows/shadow-quality.service';
import { LightRegistryService } from '../runtime/systems/lighting/light-registry.service';
import { LightPoolService } from '../runtime/systems/lighting/light-pool.service';
import { LocalRenderingSystem } from '../runtime/systems/local-rendering.system';
import { GameContextService } from '../session/game-context.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { Vector3, Material } from '@babylonjs/core';

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
  assignedSlot: number | null;
  lightOnTimestamp?: number;
  shadowReadyTimestamp?: number;
  includedMeshesCount: number;
  insideVolume: boolean;
  inPreEntryZone: boolean;
}

export interface ShaderForensicMetrics {
  totalMaterials: number;
  standardMaterials: number;
  pbrMaterials: number;
  multiMaterials: number;
  compilingCount: number;
  totalCompilationsDetected: number;
  maxLightsObserved: number;
}

export interface TransitionMilestone {
  stage: string;
  durationMs: number;
  timestamp: number;
}

export interface FrameSample {
  frameId: number;
  timestamp: number;
  fps: number;
  frameTime: number;
  drawCalls: number;
  activeMeshes: number;
  activeLights: number;
  shadowedLights: number;
  shadowRebuilds: number;
  cullingEvaluated: number;
  cullingChanged: number;
  usedHeapMb: number;
}

export interface ProfilerMetrics {
  fps: number;
  frameTimeAvg: number;
  frameTimeMin: number;
  frameTimeMax: number;
  frameTimeP50: number;
  frameTimeP95: number;
  frameTimeP99: number;
  cpuPhases: Record<string, number>;
  cpuSystems: Record<string, number>;
  dominantSystem: string;
  gpu: {
    drawCalls: number;
    activeMeshes: number;
    activeIndices: number;
    gpuFrameTime: number | 'unavailable';
    hardwareScaling: number;
    qualityTier: QualityTier;
    transparentMeshes: number;
    totalMeshes: number;
    visibleMeshes: number;
  };
  memory: {
    usedJSHeapSizeMb: number | 'unavailable';
    totalJSHeapSizeMb: number | 'unavailable';
    jsHeapSizeLimitMb: number | 'unavailable';
    heapDeltaMb: number;
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
    evaluatedEntities: number;
    modifiedEntities: number;
    visibleObjects: number;
    fadingObjects: number;
    hardCulledObjects: number;
    restoringObjects: number;
    shadowProtectedObjects: number;
  };
  shaders: ShaderForensicMetrics;
  distances: {
    evaluationsBySystem: Record<string, number>;
  };
  transition: {
    lastTransitionTotalMs: number;
    milestones: TransitionMilestone[];
  };
  session: {
    mode: string;
    cameraView: string;
    timestamp: string;
    runtimeReadyStage: string;
    sceneId: number | null;
    sceneName: string;
    playerPosition: { x: number; y: number; z: number } | null;
    cameraPosition: { x: number; y: number; z: number };
    cameraDirection: { x: number; y: number; z: number };
    cameraFov: number;
    distanceCameraToPlayer: number;
    selectedObjectName: string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class EngineProfilerService {
  public isProfilingEnabled = false;

  private adaptiveQuality: AdaptiveQualitySystem | null = null;
  private shadowCache = inject(ShadowCache);
  private shadowQualitySvc = inject(ShadowQualityService);
  private gameContext = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
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

  // --- Buffers circulares eficientes (Zero-Allocation) ---
  private readonly BUFFER_SIZE = 120;
  private frameTimeBuffer = new Float32Array(this.BUFFER_SIZE);
  private bufferIndex = 0;
  private bufferCount = 0;

  private readonly HISTORY_CAPACITY = 120;
  private historyCircularBuffer: FrameSample[] = [];
  private historyIndex = 0;
  private frameCounter = 0;

  // --- Medición continua CPU ---
  private currentPhases: Record<string, number> = {};
  private currentSystems: Record<string, number> = {};
  private avgPhases: Record<string, number> = {};
  private avgSystems: Record<string, number> = {};
  private dominantSystemName = 'None';

  // --- Contadores de distancia y culling por frame ---
  public distanceEvaluationsCounter: Record<string, number> = {};
  public cullingEvaluatedCount = 0;
  public cullingChangedCount = 0;

  // --- Instrumentos Babylon ---
  private sceneInstr: any = null;
  private engineInstr: any = null;
  private lightSys: any = null;
  private shadowSys: any = null;
  private engine: any = null;
  private currentFps = 0;

  // --- Memoria Heap ---
  private lastHeapMb = 0;

  // --- Transiciones ---
  private transitionMilestones: TransitionMilestone[] = [];
  private transitionStartTime = 0;
  private lastTransitionDuration = 0;

  constructor() {
    for (let i = 0; i < this.HISTORY_CAPACITY; i++) {
      this.historyCircularBuffer.push({
        frameId: 0,
        timestamp: 0,
        fps: 0,
        frameTime: 0,
        drawCalls: 0,
        activeMeshes: 0,
        activeLights: 0,
        shadowedLights: 0,
        shadowRebuilds: 0,
        cullingEvaluated: 0,
        cullingChanged: 0,
        usedHeapMb: 0
      });
    }
  }

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

  public recordDistanceEvaluation(systemName: string, count: number = 1): void {
    if (!this.isProfilingEnabled) return;
    this.distanceEvaluationsCounter[systemName] = (this.distanceEvaluationsCounter[systemName] || 0) + count;
  }

  public beginTransitionTracking(stageName: string): void {
    this.transitionStartTime = performance.now();
    this.transitionMilestones = [{
      stage: stageName,
      durationMs: 0,
      timestamp: performance.now()
    }];
  }

  public recordTransitionMilestone(stageName: string): void {
    const now = performance.now();
    const lastTimestamp = this.transitionMilestones.length > 0 
      ? this.transitionMilestones[this.transitionMilestones.length - 1].timestamp 
      : this.transitionStartTime;

    this.transitionMilestones.push({
      stage: stageName,
      durationMs: now - lastTimestamp,
      timestamp: now
    });
  }

  public endTransitionTracking(): void {
    if (this.transitionStartTime > 0) {
      this.lastTransitionDuration = performance.now() - this.transitionStartTime;
      this.recordTransitionMilestone('COMPLETE');
      this.transitionStartTime = 0;
    }
  }

  public recordFrameTime(timeMs: number): void {
    if (!this.isProfilingEnabled) return;
    this.frameCounter++;
    this.frameTimeBuffer[this.bufferIndex] = timeMs;
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    if (this.bufferCount < this.BUFFER_SIZE) this.bufferCount++;

    // Muestra en buffer circular reutilizable
    const sample = this.historyCircularBuffer[this.historyIndex];
    sample.frameId = this.frameCounter;
    sample.timestamp = performance.now();
    sample.fps = this.currentFps;
    sample.frameTime = timeMs;
    sample.drawCalls = this.sceneInstr?.drawCallsCounter?.current || 0;
    sample.activeMeshes = this.sceneInstr?.scene?.getActiveMeshes()?.length || 0;
    
    let activeL = 0;
    let shadowedL = 0;
    if (this.lightSys && typeof this.lightSys.getProfilerMetrics === 'function') {
      const lm = this.lightSys.getProfilerMetrics();
      activeL = lm.activePool;
      shadowedL = lm.shadowedPool;
    }
    sample.activeLights = activeL;
    sample.shadowedLights = shadowedL;
    sample.shadowRebuilds = this.shadowCache.metrics.renderListRebuilds;
    sample.cullingEvaluated = this.cullingEvaluatedCount;
    sample.cullingChanged = this.cullingChangedCount;

    const mem = this.getMemoryMetrics();
    sample.usedHeapMb = typeof mem.usedJSHeapSizeMb === 'number' ? mem.usedJSHeapSizeMb : 0;

    this.historyIndex = (this.historyIndex + 1) % this.HISTORY_CAPACITY;
  }

  public getRecentHistory(): FrameSample[] {
    const list: FrameSample[] = [];
    for (let i = 0; i < this.HISTORY_CAPACITY; i++) {
      const idx = (this.historyIndex + i) % this.HISTORY_CAPACITY;
      const s = this.historyCircularBuffer[idx];
      if (s.frameId > 0) {
        list.push({ ...s });
      }
    }
    return list;
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
    const alpha = 0.15;
    let maxSysTime = -1;
    let dominantSys = 'None';

    for (const key in this.currentPhases) {
      this.avgPhases[key] = (this.avgPhases[key] || 0) * (1 - alpha) + this.currentPhases[key] * alpha;
      this.currentPhases[key] = 0;
    }
    for (const key in this.currentSystems) {
      const val = this.currentSystems[key];
      this.avgSystems[key] = (this.avgSystems[key] || 0) * (1 - alpha) + val * alpha;
      if (val > maxSysTime) {
        maxSysTime = val;
        dominantSys = key;
      }
      this.currentSystems[key] = 0;
    }

    this.dominantSystemName = dominantSys;
    this.cullingEvaluatedCount = 0;
    this.cullingChangedCount = 0;

    if (this.bufferIndex % 60 === 0) {
      this.shadowCache.clearMetrics();
    }
  }

  private getMemoryMetrics() {
    const perf = (performance as any);
    if (perf && perf.memory) {
      const used = perf.memory.usedJSHeapSize / (1024 * 1024);
      const total = perf.memory.totalJSHeapSize / (1024 * 1024);
      const limit = perf.memory.jsHeapSizeLimit / (1024 * 1024);
      const delta = this.lastHeapMb > 0 ? used - this.lastHeapMb : 0;
      this.lastHeapMb = used;
      return {
        usedJSHeapSizeMb: parseFloat(used.toFixed(2)),
        totalJSHeapSizeMb: parseFloat(total.toFixed(2)),
        jsHeapSizeLimitMb: parseFloat(limit.toFixed(2)),
        heapDeltaMb: parseFloat(delta.toFixed(2))
      };
    }
    return {
      usedJSHeapSizeMb: 'unavailable' as const,
      totalJSHeapSizeMb: 'unavailable' as const,
      jsHeapSizeLimitMb: 'unavailable' as const,
      heapDeltaMb: 0
    };
  }

  private getShaderMetrics(): ShaderForensicMetrics {
    const scene = this.sceneInstr?.scene;
    if (!scene) {
      return {
        totalMaterials: 0,
        standardMaterials: 0,
        pbrMaterials: 0,
        multiMaterials: 0,
        compilingCount: 0,
        totalCompilationsDetected: 0,
        maxLightsObserved: 0
      };
    }

    let stdCount = 0;
    let pbrCount = 0;
    let multiCount = 0;
    let compiling = 0;
    let maxLights = 0;

    const materials = scene.materials as Material[];
    const total = materials ? materials.length : 0;

    for (let i = 0; i < total; i++) {
      const m = materials[i];
      const cls = m.getClassName();
      if (cls === 'StandardMaterial') stdCount++;
      else if (cls === 'PBRMaterial') pbrCount++;
      else if (cls === 'MultiMaterial') multiCount++;

      const lightLimit = (m as any).maxSimultaneousLights;
      if (typeof lightLimit === 'number' && lightLimit > maxLights) {
        maxLights = lightLimit;
      }

      if (!m.isReady()) {
        compiling++;
      }
    }

    return {
      totalMaterials: total,
      standardMaterials: stdCount,
      pbrMaterials: pbrCount,
      multiMaterials: multiCount,
      compilingCount: compiling,
      totalCompilationsDetected: compiling,
      maxLightsObserved: maxLights
    };
  }

  public getSnapshot(includeDeepLights: boolean = false): ProfilerMetrics {
    const validCount = this.bufferCount;
    let avg = 0, p50 = 0, p95 = 0, p99 = 0;
    let min = 99999, max = 0;

    if (validCount > 0) {
      const activeBuffer = new Float32Array(this.frameTimeBuffer.buffer, 0, validCount);
      const sorted = new Float32Array(activeBuffer).sort();

      min = sorted[0];
      max = sorted[validCount - 1];

      let sum = 0;
      for (let i = 0; i < validCount; i++) sum += sorted[i];
      avg = sum / validCount;

      p50 = sorted[Math.floor(validCount * 0.50)];
      p95 = sorted[Math.floor(validCount * 0.95)];
      p99 = sorted[Math.floor(validCount * 0.99)];
    } else {
      min = 0;
    }

    // Comprobar si GPU time está realmente disponible en Babylon
    let gpuMetric: number | 'unavailable' = 'unavailable';
    if (this.engineInstr?.gpuFrameTimeCounter && this.engineInstr.gpuFrameTimeCounter.current > 0) {
      gpuMetric = this.engineInstr.gpuFrameTimeCounter.current * 0.000001; // ns a ms
    }

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
            position: { x: parseFloat(pos.x.toFixed(2)), y: parseFloat(pos.y.toFixed(2)), z: parseFloat(pos.z.toFixed(2)) },
            distance: parseFloat(vl.lastEvaluatedDistance.toFixed(2)),
            isLightInRange: vl.isLightInRange,
            isShadowInRange: vl.isShadowInRange,
            baseIntensity: lightComp?.intensity || 1.0,
            targetMultiplier: parseFloat(vl.targetMultiplier.toFixed(2)),
            currentMultiplier: parseFloat(vl.currentMultiplier.toFixed(2)),
            finalIntensity: parseFloat(((lightComp?.renderIntensity !== undefined ? lightComp.renderIntensity : (lightComp?.intensity || 1.0)) * vl.currentMultiplier).toFixed(2)),
            containmentMode: lightComp?.containmentMode || 'GLOBAL',
            hasShadowGenerator: !!slot?.sg,
            renderListSize: slot?.sg ? (slot.sg.getShadowMap()?.renderList?.length || 0) : 0,
            isStatic: slot?.isStaticLight ?? true,
            assignedSlot: slot ? slot.index : null,
            includedMeshesCount: slot?.light ? (slot.light.includedOnlyMeshes?.length || 0) : 0,
            insideVolume: vl.insideVolume,
            inPreEntryZone: vl.inPreEntryZone
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

    // --- CONTEXTO ESPACIAL COMPLETO ---
    const activePlayer = this.gameContext.activePlayerEntity();
    let playerPos: { x: number; y: number; z: number } | null = null;
    if (activePlayer && activePlayer.view && !activePlayer.view.isDisposed()) {
      const p = activePlayer.view.getAbsolutePosition();
      playerPos = { x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)), z: parseFloat(p.z.toFixed(2)) };
    }

    const cam = this.ownership.getCamera() || this.sceneInstr?.scene?.activeCamera;
    let camPos = { x: 0, y: 0, z: 0 };
    let camDir = { x: 0, y: 0, z: 1 };
    let camFov = 0.8;
    let distCamPlayer = 0;

    if (cam) {
      cam.computeWorldMatrix();
      const cp = cam.globalPosition;
      camPos = { x: parseFloat(cp.x.toFixed(2)), y: parseFloat(cp.y.toFixed(2)), z: parseFloat(cp.z.toFixed(2)) };
      const cd = cam.getDirection(Vector3.Forward());
      camDir = { x: parseFloat(cd.x.toFixed(3)), y: parseFloat(cd.y.toFixed(3)), z: parseFloat(cd.z.toFixed(3)) };
      camFov = cam.fov || 0.8;

      if (playerPos) {
        distCamPlayer = parseFloat(Vector3.Distance(cp, new Vector3(playerPos.x, playerPos.y, playerPos.z)).toFixed(2));
      }
    }

    const selectedNode = this.gameContext.selectedNode();
    const selectedName = selectedNode ? selectedNode.name : null;

    const epData = this.gameContext.activePlatformData();
    const sceneId = this.gameContext.activePlatformId();
    const sceneName = epData?.scene?.name || 'Zona Principal';

    const memoryMetrics = this.getMemoryMetrics();
    const shaderMetrics = this.getShaderMetrics();
    const engine = this.engine;

    return {
      fps: parseFloat(this.currentFps.toFixed(1)),
      frameTimeAvg: parseFloat(avg.toFixed(2)),
      frameTimeMin: parseFloat(min.toFixed(2)),
      frameTimeMax: parseFloat(max.toFixed(2)),
      frameTimeP50: parseFloat(p50.toFixed(2)),
      frameTimeP95: parseFloat(p95.toFixed(2)),
      frameTimeP99: parseFloat(p99.toFixed(2)),
      cpuPhases: { ...this.avgPhases },
      cpuSystems: { ...this.avgSystems },
      dominantSystem: this.dominantSystemName,
      gpu: {
        drawCalls,
        activeMeshes,
        activeIndices: this.sceneInstr?.scene?.getActiveIndices() || 0,
        gpuFrameTime: typeof gpuMetric === 'number' ? parseFloat(gpuMetric.toFixed(2)) : gpuMetric,
        hardwareScaling: engine ? engine.getHardwareScalingLevel() : 1.0,
        qualityTier: this.adaptiveQuality ? this.adaptiveQuality.currentQualityTier : 'HIGH',
        transparentMeshes,
        totalMeshes,
        visibleMeshes: visibleMeshesCount
      },
      memory: memoryMetrics,
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
      culling: {
        evaluatedEntities: this.cullingEvaluatedCount,
        modifiedEntities: this.cullingChangedCount,
        ...cullingMetrics
      },
      shaders: shaderMetrics,
      distances: {
        evaluationsBySystem: { ...this.distanceEvaluationsCounter }
      },
      transition: {
        lastTransitionTotalMs: parseFloat(this.lastTransitionDuration.toFixed(1)),
        milestones: [...this.transitionMilestones]
      },
      session: {
        mode: this.gameContext.mode(),
        cameraView: this.gameContext.cameraView(),
        timestamp: new Date().toLocaleTimeString(),
        runtimeReadyStage: this.gameContext.runtimeReadyStage(),
        sceneId,
        sceneName,
        playerPosition: playerPos,
        cameraPosition: camPos,
        cameraDirection: camDir,
        cameraFov: parseFloat(camFov.toFixed(2)),
        distanceCameraToPlayer: distCamPlayer,
        selectedObjectName: selectedName
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