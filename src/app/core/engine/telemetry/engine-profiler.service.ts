
// file: src/app/core/engine/telemetry/engine-profiler.service.ts
import { Injectable, inject, Injector } from '@angular/core';
import { AdaptiveQualitySystem, QualityTier } from '../runtime/systems/adaptive-quality.system';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowQualityService, ShadowQualityTier } from '../runtime/shadows/shadow-quality.service';
import { LightRegistryService } from '../runtime/systems/lighting/light-registry.service';
import { LightPoolService } from '../runtime/systems/lighting/light-pool.service';
import { LocalRenderingSystem } from '../runtime/systems/local-rendering.system';
import { PlayerSequenceService, ActiveSequenceDetail } from '../runtime/systems/player-sequence.service';
import { GameContextService } from '../session/game-context.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { SpatialRelevanceHubService } from '../spatial/spatial-relevance-hub.service';
import { LightReferenceService } from '../runtime/systems/lighting/light-reference.service';
import { FogRendererService } from '../runtime/systems/fog-renderer.service';
import { CoreSceneMaterialService } from '../scene/utils/core-scene-material.service';
import { Vector3, Material, AbstractMesh, MultiMaterial } from '@babylonjs/core';

export interface LightForensicRecord {
  uid: string;
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
  distance: number;
  centerDistance: number;
  boundsDistance: number;
  effectiveDistance: number;
  configActivationDistance: number;
  configDeactivationDistance: number;
  configFadeStartDistance: number;
  configFadeEndDistance: number;
  configShadowDistance: number;
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
  priorityScore: number;
  state: string;
  decisionText: string;
  rejectionReason?: string;
  lastStateChangeTimestamp?: string;
  lastDistanceUpdateTimestamp?: string;
  lightOnTimestamp?: number;
  shadowReadyTimestamp?: number;
  includedMeshesCount: number;
  excludedMeshesCount: number;
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

export interface SequenceForensicMetrics {
  activeCount: number;
  details: ActiveSequenceDetail[];
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
  activeSequences: number;
  usedHeapMb: number;
}

export interface LatencyBuckets {
  framesAbove33ms: number;
  framesAbove50ms: number;
  framesAbove100ms: number;
  framesAbove250ms: number;
  framesAbove500ms: number;
  framesAbove1000ms: number;
}

export interface TimelineEvent {
  id: number;
  timestamp: number;
  relativeMs: number;
  frameNumber: number;
  sessionId: string;
  entryNumber: number;
  category: 'LIFECYCLE' | 'TRANSITION' | 'READINESS' | 'SHADER' | 'LIGHT' | 'SEQUENCE' | 'CULLING' | 'ZONE' | 'SPIKE' | 'SNAPSHOT';
  name: string;
  details: Record<string, any>;
}

export interface EntrySummaryComparison {
  entryNumber: number;
  sessionId: string;
  transitionDurationMs: number;
  stabilityCheckDurationMs: number;
  readyDurationMs: number;
  shaderEventsCount: number;
  lightChangesCount: number;
  sequenceEventsCount: number;
  cullingChangesCount: number;
  cullingFlapsCount: number;
  worstFrameTimeMs: number;
  snapshotStatus: string;
  timestamp: string;
}

export interface ProfilerMetrics {
  fps: number;
  frameTimeAvg: number;
  frameTimeMin: number;
  frameTimeMax: number;
  frameTimeP50: number;
  frameTimeP90: number;
  frameTimeP95: number;
  frameTimeP99: number;
  worstFrameTime: number;
  latencyBuckets: LatencyBuckets;
  cpuPhases: Record<string, number>;
  cpuSystems: Record<string, number>;
  dominantSystem: string;
  telemetryCpuTimeMs: number;
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
    fadingInCount: number;
    fadingOutCount: number;
    inactiveCount: number;
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
  sequences: SequenceForensicMetrics;
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
    playerRotation: { x: number; y: number; z: number } | null;
    cameraPosition: { x: number; y: number; z: number };
    cameraRotation: { x: number; y: number; z: number };
    cameraDirection: { x: number; y: number; z: number };
    cardinalDirection: string;
    fogCenter: { x: number; y: number; z: number };
    fogRingDistances: number[];
    cameraFov: number;
    distanceCameraToPlayer: number;
    selectedObjectName: string | null;
    sessionId: string;
    entryNumber: number;
  };
  timelineEvents: TimelineEvent[];
  sessionComparisons: EntrySummaryComparison[];
}

@Injectable({ providedIn: 'root' })
export class EngineProfilerService {
  public isProfilingEnabled = true;

  private adaptiveQuality: AdaptiveQualitySystem | null = null;
  private shadowCache = inject(ShadowCache);
  private shadowQualitySvc = inject(ShadowQualityService);
  private gameContext = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private lightRef = inject(LightReferenceService);
  private fogRenderer = inject(FogRendererService);
  private injector = inject(Injector);

  private _lightRegistry: LightRegistryService | null = null;
  private get lightRegistry(): LightRegistryService {
    if (!this._lightRegistry) this._lightRegistry = this.injector.get(LightRegistryService);
    return this._lightRegistry;
  }

  private _lightPool: LightPoolService | null = null;
  private get lightPool(): LightPoolService {
    if (!this._lightPool) this._lightPool = this.injector.get(LightPoolService);
    return this._lightPool;
  }

  private _containmentSvc: LightContainmentService | null = null;
  private get containmentSvc(): LightContainmentService {
    if (!this._containmentSvc) this._containmentSvc = this.injector.get(LightContainmentService);
    return this._containmentSvc;
  }

  private _localRendering: LocalRenderingSystem | null = null;
  private get localRendering(): LocalRenderingSystem {
    if (!this._localRendering) this._localRendering = this.injector.get(LocalRenderingSystem);
    return this._localRendering;
  }

  private _sequenceSvc: PlayerSequenceService | null = null;
  private get sequenceSvc(): PlayerSequenceService {
    if (!this._sequenceSvc) this._sequenceSvc = this.injector.get(PlayerSequenceService);
    return this._sequenceSvc;
  }

  private _spatialHub: SpatialRelevanceHubService | null = null;
  private get spatialHub(): SpatialRelevanceHubService {
    if (!this._spatialHub) this._spatialHub = this.injector.get(SpatialRelevanceHubService);
    return this._spatialHub;
  }

  private _materialSvc: CoreSceneMaterialService | null = null;
  private get materialSvc(): CoreSceneMaterialService {
    if (!this._materialSvc) this._materialSvc = this.injector.get(CoreSceneMaterialService);
    return this._materialSvc;
  }

  private currentSessionId = 'init_session';
  private currentEntryNumber = 0;
  private sessionStartTime = performance.now();
  private transitionStartTime = 0;
  private lastTransitionDuration = 0;
  private stabilityCheckDuration = 0;
  private readyDuration = 0;

  private readonly BUFFER_SIZE = 120;
  private frameTimeBuffer = new Float32Array(this.BUFFER_SIZE);
  private bufferIndex = 0;
  private bufferCount = 0;

  private readonly HISTORY_CAPACITY = 120;
  private historyCircularBuffer: FrameSample[] = [];
  private historyIndex = 0;
  private frameCounter = 0;

  private readonly EVENT_CAPACITY = 256;
  private timelineEventsBuffer: TimelineEvent[] = [];
  private nextEventId = 1;

  private sessionComparisons: EntrySummaryComparison[] = [];
  private currentEntrySummary: EntrySummaryComparison | null = null;

  private knownShaderEffectKeys = new Set<string>();

  private latencyBuckets: LatencyBuckets = {
    framesAbove33ms: 0,
    framesAbove50ms: 0,
    framesAbove100ms: 0,
    framesAbove250ms: 0,
    framesAbove500ms: 0,
    framesAbove1000ms: 0
  };
  private worstFrameEver = 0;

  private currentPhases: Record<string, number> = {};
  private currentSystems: Record<string, number> = {};
  private avgPhases: Record<string, number> = {};
  private avgSystems: Record<string, number> = {};
  private dominantSystemName = 'None';
  private telemetryCpuAccumulator = 0;
  private avgTelemetryCpuTime = 0;

  public distanceEvaluationsCounter: Record<string, number> = {};
  public cullingEvaluatedCount = 0;
  public cullingChangedCount = 0;

  private sceneInstr: any = null;
  private engineInstr: any = null;
  private lightSys: any = null;
  private shadowSys: any = null;
  private engine: any = null;
  private currentFps = 0;

  private cachedMemoryMetrics = {
    usedJSHeapSizeMb: 'unavailable' as number | 'unavailable',
    totalJSHeapSizeMb: 'unavailable' as number | 'unavailable',
    jsHeapSizeLimitMb: 'unavailable' as number | 'unavailable',
    heapDeltaMb: 0
  };
  private lastHeapMb = 0;
  private memoryCheckTimer = 0;

  private transitionMilestones: TransitionMilestone[] = [];

  constructor() {
    (window as any).HIGH_RES_PERFORMANCE_TELEMETRY = true;

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
        activeSequences: 0,
        usedHeapMb: 0
      });
    }
  }

  public isHighResTelemetryEnabled(): boolean {
    return (window as any).HIGH_RES_PERFORMANCE_TELEMETRY !== false;
  }

  public notifySessionEntry(sessionId: string, entryNumber: number): void {
    this.currentSessionId = sessionId;
    this.currentEntryNumber = entryNumber;
    this.sessionStartTime = performance.now();

    this.currentEntrySummary = {
      entryNumber,
      sessionId,
      transitionDurationMs: 0,
      stabilityCheckDurationMs: 0,
      readyDurationMs: 0,
      shaderEventsCount: 0,
      lightChangesCount: 0,
      sequenceEventsCount: 0,
      cullingChangesCount: 0,
      cullingFlapsCount: 0,
      worstFrameTimeMs: 0,
      snapshotStatus: 'PENDING',
      timestamp: new Date().toLocaleTimeString()
    };
    this.sessionComparisons.push(this.currentEntrySummary);
    if (this.sessionComparisons.length > 10) {
      this.sessionComparisons.shift();
    }

    this.recordTimelineEvent('LIFECYCLE', 'SESSION_ENTRY_START', {
      sessionId,
      entryNumber,
      mode: this.gameContext.mode()
    });
  }

  public recordTimelineEvent(
    category: TimelineEvent['category'],
    name: string,
    details: Record<string, any> = {}
  ): void {
    if (!this.isProfilingEnabled || !this.isHighResTelemetryEnabled()) return;

    const now = performance.now();
    const event: TimelineEvent = {
      id: this.nextEventId++,
      timestamp: now,
      relativeMs: parseFloat((now - this.sessionStartTime).toFixed(2)),
      frameNumber: this.frameCounter,
      sessionId: this.currentSessionId,
      entryNumber: this.currentEntryNumber,
      category,
      name,
      details
    };

    if (this.timelineEventsBuffer.length >= this.EVENT_CAPACITY) {
      this.timelineEventsBuffer.shift();
    }
    this.timelineEventsBuffer.push(event);

    if (this.currentEntrySummary) {
      if (category === 'SHADER') this.currentEntrySummary.shaderEventsCount++;
      if (category === 'LIGHT') this.currentEntrySummary.lightChangesCount++;
      if (category === 'SEQUENCE') this.currentEntrySummary.sequenceEventsCount++;
      if (category === 'CULLING') this.currentEntrySummary.cullingChangesCount++;
      if (name === 'CULLING_FLAP') this.currentEntrySummary.cullingFlapsCount++;
      if (category === 'SNAPSHOT') this.currentEntrySummary.snapshotStatus = name;
    }
  }

  public getTimelineEvents(): TimelineEvent[] {
    return [...this.timelineEventsBuffer];
  }

  public getSessionComparisons(): EntrySummaryComparison[] {
    return [...this.sessionComparisons];
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
    this.recordTimelineEvent('TRANSITION', 'TRANSITION_BEGIN', { stage: stageName });
  }

  public recordTransitionMilestone(stageName: string): void {
    const now = performance.now();
    const lastTimestamp = this.transitionMilestones.length > 0 
      ? this.transitionMilestones[this.transitionMilestones.length - 1].timestamp 
      : this.transitionStartTime;

    const duration = now - lastTimestamp;
    this.transitionMilestones.push({
      stage: stageName,
      durationMs: duration,
      timestamp: now
    });

    if (stageName.includes('STABILITY')) {
      this.stabilityCheckDuration = duration;
      if (this.currentEntrySummary) this.currentEntrySummary.stabilityCheckDurationMs = parseFloat(duration.toFixed(1));
    } else if (stageName.includes('READY')) {
      this.readyDuration = duration;
      if (this.currentEntrySummary) this.currentEntrySummary.readyDurationMs = parseFloat(duration.toFixed(1));
    }

    this.recordTimelineEvent('TRANSITION', `STAGE_${stageName}`, { durationMs: parseFloat(duration.toFixed(2)) });
  }

  public endTransitionTracking(): void {
    if (this.transitionStartTime > 0) {
      this.lastTransitionDuration = performance.now() - this.transitionStartTime;
      this.recordTransitionMilestone('COMPLETE');
      if (this.currentEntrySummary) {
        this.currentEntrySummary.transitionDurationMs = parseFloat(this.lastTransitionDuration.toFixed(1));
      }
      this.recordTimelineEvent('TRANSITION', 'TRANSITION_COMPLETE', {
        totalDurationMs: parseFloat(this.lastTransitionDuration.toFixed(2))
      });
      this.transitionStartTime = 0;
    }
  }

  public recordFrameTime(timeMs: number): void {
    if (!this.isProfilingEnabled) return;
    const tStart = performance.now();

    if (timeMs > this.worstFrameEver) {
      this.worstFrameEver = timeMs;
    }
    if (this.currentEntrySummary && timeMs > this.currentEntrySummary.worstFrameTimeMs) {
      this.currentEntrySummary.worstFrameTimeMs = parseFloat(timeMs.toFixed(1));
    }

    if (timeMs > 1000) this.latencyBuckets.framesAbove1000ms++;
    if (timeMs > 500) this.latencyBuckets.framesAbove500ms++;
    if (timeMs > 250) this.latencyBuckets.framesAbove250ms++;
    if (timeMs > 100) this.latencyBuckets.framesAbove100ms++;
    if (timeMs > 50) this.latencyBuckets.framesAbove50ms++;
    if (timeMs > 33.3) this.latencyBuckets.framesAbove33ms++;

    this.frameCounter++;
    this.frameTimeBuffer[this.bufferIndex] = timeMs;
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    if (this.bufferCount < this.BUFFER_SIZE) this.bufferCount++;

    const sample = this.historyCircularBuffer[this.historyIndex];
    sample.frameId = this.frameCounter;
    sample.timestamp = tStart;
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
    sample.activeSequences = this.sequenceSvc.getActiveSequencesCount();

    this.memoryCheckTimer++;
    if (this.memoryCheckTimer >= 30) {
      this.updateMemoryMetricsThrottled();
      this.memoryCheckTimer = 0;
    }
    sample.usedHeapMb = typeof this.cachedMemoryMetrics.usedJSHeapSizeMb === 'number' 
      ? this.cachedMemoryMetrics.usedJSHeapSizeMb 
      : 0;

    this.historyIndex = (this.historyIndex + 1) % this.HISTORY_CAPACITY;

    this.inspectShadersNonIntrusive();

    this.telemetryCpuAccumulator += (performance.now() - tStart);
  }

  private inspectShadersNonIntrusive(): void {
    const scene = this.sceneInstr?.scene;
    if (!scene || !scene.materials) return;

    if (this.frameCounter % 15 !== 0) return;

    const materials = scene.materials as Material[];
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i];
      if (mat && typeof mat.getEffect === 'function') {
        const effect = mat.getEffect();
        if (effect && effect.key) {
          if (!this.knownShaderEffectKeys.has(effect.key)) {
            this.knownShaderEffectKeys.add(effect.key);
            this.recordTimelineEvent('SHADER', 'NEW_SHADER_VARIANT_DETECTED', {
              materialName: mat.name,
              materialType: mat.getClassName(),
              effectKey: effect.key,
              isReady: effect.isReady()
            });
          }
        }
      }
    }
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
    const tStart = performance.now();
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
    this.distanceEvaluationsCounter = {};

    if (this.bufferIndex % 60 === 0) {
      this.shadowCache.clearMetrics();
    }

    this.telemetryCpuAccumulator += (performance.now() - tStart);
    this.avgTelemetryCpuTime = (this.avgTelemetryCpuTime * 0.9) + (this.telemetryCpuAccumulator * 0.1);
    this.telemetryCpuAccumulator = 0;
  }

  private updateMemoryMetricsThrottled(): void {
    const perf = (performance as any);
    if (perf && perf.memory) {
      const used = perf.memory.usedJSHeapSize / (1024 * 1024);
      const total = perf.memory.totalJSHeapSize / (1024 * 1024);
      const limit = perf.memory.jsHeapSizeLimit / (1024 * 1024);
      const delta = this.lastHeapMb > 0 ? used - this.lastHeapMb : 0;
      this.lastHeapMb = used;
      this.cachedMemoryMetrics = {
        usedJSHeapSizeMb: parseFloat(used.toFixed(2)),
        totalJSHeapSizeMb: parseFloat(total.toFixed(2)),
        jsHeapSizeLimitMb: parseFloat(limit.toFixed(2)),
        heapDeltaMb: parseFloat(delta.toFixed(2))
      };
    }
  }

  private getShaderMetrics(): ShaderForensicMetrics {
    const scene = this.sceneInstr?.scene;
    if (!scene) {
      return {
        totalMaterials: 0, standardMaterials: 0, pbrMaterials: 0, multiMaterials: 0,
        compilingCount: 0, totalCompilationsDetected: 0, maxLightsObserved: 0
      };
    }

    let stdCount = 0, pbrCount = 0, multiCount = 0, compiling = 0, maxLights = 0;
    const materials = scene.materials as Material[];
    const total = materials ? materials.length : 0;

    // Solo inspeccionar materiales que están en mallas activas de la escena para evitar falsos positivos
    const activeMaterialsSet = new Set<Material>();
    const meshes = scene.meshes;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (m && !m.isDisposed() && m.material) {
        activeMaterialsSet.add(m.material);
        if (m.material.getClassName() === 'MultiMaterial') {
          const multi = m.material as MultiMaterial;
          (multi.subMaterials || []).forEach(sm => { if (sm) activeMaterialsSet.add(sm); });
        }
      }
    }

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

      // Solo evaluamos readiness si el material pertenece a una malla en la escena activa
      if (activeMaterialsSet.has(m)) {
        if (typeof (m as any).getEffect === 'function') {
          const effect = (m as any).getEffect();
          if (effect && !effect.isReady()) {
            compiling++;
          }
        }
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

  private getCardinalDirection(dirX: number, dirZ: number): string {
    const angle = Math.atan2(dirX, dirZ) * 180 / Math.PI;
    const norm = (angle + 360) % 360;
    if (norm >= 337.5 || norm < 22.5) return 'N (+Z)';
    if (norm >= 22.5 && norm < 67.5) return 'NE';
    if (norm >= 67.5 && norm < 112.5) return 'E (+X)';
    if (norm >= 112.5 && norm < 157.5) return 'SE';
    if (norm >= 157.5 && norm < 202.5) return 'S (-Z)';
    if (norm >= 202.5 && norm < 247.5) return 'SW';
    if (norm >= 247.5 && norm < 292.5) return 'W (-X)';
    return 'NW';
  }

  public getSnapshot(includeDeepLights: boolean = false): ProfilerMetrics {
    const validCount = this.bufferCount;
    let avg = 0, p50 = 0, p90 = 0, p95 = 0, p99 = 0;
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
      p90 = sorted[Math.floor(validCount * 0.90)];
      p95 = sorted[Math.floor(validCount * 0.95)];
      p99 = sorted[Math.floor(validCount * 0.99)];
    } else {
      min = 0;
    }

    let gpuMetric: number | 'unavailable' = 'unavailable';
    if (this.engineInstr?.gpuFrameTimeCounter && this.engineInstr.gpuFrameTimeCounter.current > 0) {
      gpuMetric = this.engineInstr.gpuFrameTimeCounter.current * 0.000001;
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
    let fadingInCount = 0;
    let fadingOutCount = 0;
    let inactiveCount = 0;

    try {
      const virtuals = this.lightRegistry.getVirtualLights();
      const slots = this.lightPool.getAllSlots();

      for (let i = 0; i < virtuals.length; i++) {
        const vl = virtuals[i];
        const slot = slots.find(s => s.assignedEntityUid === vl.entity.uid);
        const lightComp = vl.entity.light;
        const pos = vl.entity.view 
          ? vl.entity.view.getAbsolutePosition() 
          : { x: vl.entity.transform.position.x, y: vl.entity.transform.position.y, z: vl.entity.transform.position.z };

        if (vl.lifecycleStage === 'FADING_IN') fadingInCount++;
        else if (vl.lifecycleStage === 'FADING_OUT') fadingOutCount++;
        else if (vl.lifecycleStage === 'INACTIVE' || vl.lifecycleStage === 'OUTSIDE') inactiveCount++;

        const actDist = lightComp?.activationDistance ?? 50.0;
        const deactDist = lightComp?.deactivationDistance ?? 55.0;
        const shadowAct = lightComp?.shadowActivationDistance ?? 24.0;

        lightDetails.push({
          uid: vl.entity.uid,
          name: vl.entity.name,
          type: vl.entity.type,
          position: { x: parseFloat(pos.x.toFixed(2)), y: parseFloat(pos.y.toFixed(2)), z: parseFloat(pos.z.toFixed(2)) },
          distance: parseFloat(vl.lastEvaluatedDistance.toFixed(2)),
          centerDistance: parseFloat(vl.centerDistance.toFixed(2)),
          boundsDistance: parseFloat(vl.boundsDistance.toFixed(2)),
          effectiveDistance: parseFloat(vl.effectiveDistance.toFixed(2)),
          configActivationDistance: actDist,
          configDeactivationDistance: deactDist,
          configFadeStartDistance: parseFloat((actDist * 0.7).toFixed(1)),
          configFadeEndDistance: deactDist,
          configShadowDistance: shadowAct,
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
          priorityScore: parseFloat((vl._sortScore ?? 0).toFixed(2)),
          state: vl.lifecycleStage,
          decisionText: vl.decisionText || 'EVALUATING',
          rejectionReason: vl.rejectionReason,
          lastStateChangeTimestamp: vl.lastStateChangeTimestamp || 'Initial',
          lastDistanceUpdateTimestamp: vl.lastDistanceUpdateTimestamp || 'Initial',
          lightOnTimestamp: slot?._lightOnTimestamp,
          shadowReadyTimestamp: slot?._shadowReadyTimestamp,
          includedMeshesCount: slot?.light ? (slot.light.includedOnlyMeshes?.length || 0) : 0,
          excludedMeshesCount: slot?.light ? (slot.light.excludedMeshes?.length || 0) : 0,
          insideVolume: vl.insideVolume,
          inPreEntryZone: vl.inPreEntryZone
        });
      }
    } catch (e) {}

    const cullingMetrics = this.localRendering ? this.localRendering.getMetrics() : {
      visibleObjects: visibleMeshesCount, fadingObjects: 0, hardCulledObjects: 0, restoringObjects: 0, shadowProtectedObjects: 0
    };

    const seqDetails = this.sequenceSvc ? this.sequenceSvc.getActiveSequencesDetails() : [];

    const validActors = this.lightRef.getValidActorEntities();
    let playerPos: { x: number; y: number; z: number } | null = null;
    let playerRot: { x: number; y: number; z: number } | null = null;

    if (validActors.length > 0 && validActors[0].view && !validActors[0].view.isDisposed()) {
      const p = validActors[0].view.getAbsolutePosition();
      playerPos = { x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)), z: parseFloat(p.z.toFixed(2)) };

      const pv = validActors[0].view;
      if (pv.rotationQuaternion) {
        const e = pv.rotationQuaternion.toEulerAngles();
        playerRot = { 
          x: parseFloat((e.x * 180 / Math.PI).toFixed(1)), 
          y: parseFloat((e.y * 180 / Math.PI).toFixed(1)), 
          z: parseFloat((e.z * 180 / Math.PI).toFixed(1)) 
        };
      } else {
        playerRot = { 
          x: parseFloat((pv.rotation.x * 180 / Math.PI).toFixed(1)), 
          y: parseFloat((pv.rotation.y * 180 / Math.PI).toFixed(1)), 
          z: parseFloat((pv.rotation.z * 180 / Math.PI).toFixed(1)) 
        };
      }
    }

    const cam = this.ownership.getCamera() || this.sceneInstr?.scene?.activeCamera;
    let camPos = { x: 0, y: 0, z: 0 };
    let camRot = { x: 0, y: 0, z: 0 };
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

      if ((cam as any).rotation) {
        const cr = (cam as any).rotation;
        camRot = { 
          x: parseFloat((cr.x * 180 / Math.PI).toFixed(1)), 
          y: parseFloat((cr.y * 180 / Math.PI).toFixed(1)), 
          z: parseFloat((cr.z * 180 / Math.PI).toFixed(1)) 
        };
      } else if ((cam as any).rotationQuaternion) {
        const e = (cam as any).rotationQuaternion.toEulerAngles();
        camRot = { 
          x: parseFloat((e.x * 180 / Math.PI).toFixed(1)), 
          y: parseFloat((e.y * 180 / Math.PI).toFixed(1)), 
          z: parseFloat((e.z * 180 / Math.PI).toFixed(1)) 
        };
      }

      if (playerPos) {
        distCamPlayer = parseFloat(Vector3.Distance(cp, new Vector3(playerPos.x, playerPos.y, playerPos.z)).toFixed(2));
      }
    }

    const cardinalDirection = this.getCardinalDirection(camDir.x, camDir.z);

    const selectedNode = this.gameContext.selectedNode();
    const epData = this.gameContext.activePlatformData();
    const sceneId = this.gameContext.activePlatformId();
    const sceneName = epData?.scene?.name || 'Zona Principal';

    const shaderMetrics = this.getShaderMetrics();
    const engine = this.engine;

    const hubMetrics = this.spatialHub ? this.spatialHub.getMetrics() : {
      evaluations: 0, exactDistanceCalculations: 0, squaredDistanceCalculations: 0, cacheHits: 0, registeredEntities: 0, updateTimeMs: 0
    };

    const combinedDistances: Record<string, number> = {
      ...this.distanceEvaluationsCounter,
      HubUpdateTimeMs: hubMetrics.updateTimeMs,
      HubRegisteredEntities: hubMetrics.registeredEntities,
      HubEvaluationsThisFrame: hubMetrics.evaluations,
      HubSquaredDistCalls: hubMetrics.squaredDistanceCalculations,
      HubExactDistCalls: hubMetrics.exactDistanceCalculations,
      HubCacheHits: hubMetrics.cacheHits
    };

    const fogAnchor = this.fogRenderer.lastAnchorPosition;
    const fogRings = [...this.fogRenderer.lastRingDistances];

    return {
      fps: parseFloat(this.currentFps.toFixed(1)),
      frameTimeAvg: parseFloat(avg.toFixed(2)),
      frameTimeMin: parseFloat(min.toFixed(2)),
      frameTimeMax: parseFloat(max.toFixed(2)),
      frameTimeP50: parseFloat(p50.toFixed(2)),
      frameTimeP90: parseFloat(p90.toFixed(2)),
      frameTimeP95: parseFloat(p95.toFixed(2)),
      frameTimeP99: parseFloat(p99.toFixed(2)),
      worstFrameTime: parseFloat(this.worstFrameEver.toFixed(2)),
      latencyBuckets: { ...this.latencyBuckets },
      cpuPhases: { ...this.avgPhases },
      cpuSystems: { ...this.avgSystems },
      dominantSystem: this.dominantSystemName,
      telemetryCpuTimeMs: parseFloat(this.avgTelemetryCpuTime.toFixed(3)),
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
      memory: { ...this.cachedMemoryMetrics },
      lights: { 
        ...lightMetrics, 
        fadingInCount,
        fadingOutCount,
        inactiveCount,
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
      sequences: { activeCount: seqDetails.length, details: seqDetails },
      distances: { evaluationsBySystem: combinedDistances },
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
        playerRotation: playerRot,
        cameraPosition: camPos,
        cameraRotation: camRot,
        cameraDirection: camDir,
        cardinalDirection,
        fogCenter: { x: parseFloat(fogAnchor.x.toFixed(2)), y: parseFloat(fogAnchor.y.toFixed(2)), z: parseFloat(fogAnchor.z.toFixed(2)) },
        fogRingDistances: fogRings,
        cameraFov: parseFloat(camFov.toFixed(2)),
        distanceCameraToPlayer: distCamPlayer,
        selectedObjectName: selectedNode ? selectedNode.name : null,
        sessionId: this.currentSessionId,
        entryNumber: this.currentEntryNumber
      },
      timelineEvents: this.getTimelineEvents(),
      sessionComparisons: this.getSessionComparisons()
    };
  }

  public printSnapshotToConsole(): void {
    const snap = this.getSnapshot(true);
    console.log('===== PROFILING FORENSIC SNAPSHOT =====');
    console.log(JSON.stringify(snap, null, 2));
    console.log('=======================================');
  }
}