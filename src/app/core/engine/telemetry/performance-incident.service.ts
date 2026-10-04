
// file: src/app/core/engine/telemetry/performance-incident.service.ts
import { Injectable, inject } from '@angular/core';
import { EngineProfilerService, ProfilerMetrics, FrameSample } from './engine-profiler.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { GameContextService } from '../session/game-context.service';
import { GameMode } from '../session/game-mode.model';
import { Tools, Vector3 } from '@babylonjs/core';

export type IncidentCategory = 
  | 'FRAME_TIME_SPIKE'
  | 'CPU_SYSTEM_SPIKE'
  | 'GPU_BOUND_SPIKE'
  | 'SHADER_COMPILATION_SPIKE'
  | 'SHADOW_REBUILD_SPIKE'
  | 'LIGHT_SURGE_SPIKE'
  | 'CULLING_STORM_SPIKE'
  | 'MEMORY_GC_SPIKE'
  | 'TRANSITION_HITCH'
  | 'UNKNOWN';

export interface IncidentDelta {
  fpsDelta: number;
  frameTimeDeltaMs: number;
  drawCallsDelta: number;
  activeMeshesDelta: number;
  activeLightsDelta: number;
  shadowedLightsDelta: number;
  shadowRebuildsDelta: number;
  heapDeltaMb: number;
  newLightsDetected: string[];
}

export interface PerformanceIncident {
  id: string;
  timestamp: string;
  frameNumber: number;
  durationMs: number;
  status: 'ACTIVE' | 'RECOVERED';
  category: IncidentCategory;
  primarySuspect: string;
  secondarySuspects: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  
  // Rendimiento
  fps: number;
  minFps: number;
  frameTime: number;
  maxFrameTime: number;
  
  // Contexto Espacial Exacto
  spatialContext: {
    sceneId: number | null;
    sceneName: string;
    mode: string;
    stage: string;
    playerCoordinates: { x: number; y: number; z: number } | null;
    cameraCoordinates: { x: number; y: number; z: number };
    cameraDirection: { x: number; y: number; z: number };
    cameraFov: number;
    distanceCameraToPlayer: number;
    selectedObject: string | null;
  };

  // Deltas forenses
  delta: IncidentDelta;

  // Diagnóstico
  diagnosis: string;
  metrics: ProfilerMetrics;
  previousStableMetrics?: FrameSample;
  recentHistory: FrameSample[];
  postIncidentHistory?: FrameSample[];

  // Captura Visual
  imageUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class PerformanceIncidentService {
  private profiler = inject(EngineProfilerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private context = inject(GameContextService);

  private incidents: PerformanceIncident[] = [];
  private readonly MAX_INCIDENTS = 15;
  
  private consecutiveBadFrames = 0;
  private consecutiveGoodFrames = 0;
  private cooldownTimer = 0;
  
  private state: 'NORMAL' | 'ACTIVE' = 'NORMAL';
  private activeIncident: PerformanceIncident | null = null;
  private incidentStartTime = 0;
  private postCaptureCounter = 0;

  private readonly FPS_THRESHOLD = 42;
  private readonly FRAMETIME_THRESHOLD = 23.8; 
  private readonly COOLDOWN_MS = 6000;

  public checkFrame(frameTimeMs: number, fps: number): void {
    if (this.cooldownTimer > 0 && this.state === 'NORMAL') {
      this.cooldownTimer -= frameTimeMs;
      return;
    }

    if (this.context.isTransitioning()) {
      return;
    }

    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
    const toleranceFactor = isEditor ? 1.6 : 1.0; 

    const triggerLimit = isEditor ? 25 : 12;

    if (fps < (this.FPS_THRESHOLD / toleranceFactor) || frameTimeMs > (this.FRAMETIME_THRESHOLD * toleranceFactor)) {
      this.consecutiveBadFrames++;
      this.consecutiveGoodFrames = 0;

      if (this.state === 'NORMAL' && this.consecutiveBadFrames >= triggerLimit) {
         this.triggerIncident(fps, frameTimeMs);
      } else if (this.state === 'ACTIVE' && this.activeIncident) {
         if (fps < this.activeIncident.minFps) this.activeIncident.minFps = fps;
         if (frameTimeMs > this.activeIncident.maxFrameTime) this.activeIncident.maxFrameTime = frameTimeMs;
         this.activeIncident.durationMs = performance.now() - this.incidentStartTime;
      }
    } else {
      this.consecutiveBadFrames = 0;
      this.consecutiveGoodFrames++;

      if (this.state === 'ACTIVE' && this.activeIncident) {
         this.postCaptureCounter++;
         if (this.postCaptureCounter === 30) {
            this.activeIncident.postIncidentHistory = this.profiler.getRecentHistory().slice(-30);
         }

         if (this.consecutiveGoodFrames > 40) {
            this.recoverIncident();
         }
      }
    }
  }

  public simulateIncident(): void {
    this.triggerIncident(28.4, 35.2);
    setTimeout(() => this.recoverIncident(), 2000);
  }

  private determineContextStage(): string {
    const mode = this.context.mode();
    if (this.context.isTransitioning()) return 'SCENE_LOADING_OR_TRANSITION';
    if (this.context.isInteracting()) return 'EDITOR_INTERACTION';

    if (mode === GameMode.EDITOR) return 'EDITOR_IDLE';
    if (mode === GameMode.EDITING_IN_GAME) return 'EDITING_IN_GAME';
    if (mode === GameMode.TEST_LIVE) return 'TEST_LIVE_PLAY';
    if (mode === GameMode.PREVIEW_ADMIN) return 'ADMIN_PREVIEW_PLAY';
    if (mode === GameMode.FINAL_USER) return 'FINAL_USER_PLAY';

    return 'IDLE_OR_UNKNOWN';
  }

  private triggerIncident(fps: number, frameTime: number): void {
    this.state = 'ACTIVE';
    this.incidentStartTime = performance.now();
    this.postCaptureCounter = 0;
    
    const snap = this.profiler.getSnapshot(true);
    const recentHistory = this.profiler.getRecentHistory();
    const stableSample = recentHistory.length > 10 ? recentHistory[recentHistory.length - 10] : recentHistory[0];

    const contextStage = this.determineContextStage();
    const delta = this.calculateDelta(snap, stableSample);
    const classification = this.classifyIncident(snap, delta, contextStage);
    
    const incident: PerformanceIncident = {
      id: 'inc_' + Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      frameNumber: recentHistory.length > 0 ? recentHistory[recentHistory.length - 1].frameId : 0,
      durationMs: 0,
      status: 'ACTIVE',
      category: classification.category,
      primarySuspect: classification.primarySuspect,
      secondarySuspects: classification.secondarySuspects,
      confidence: classification.confidence,
      fps,
      minFps: fps,
      frameTime,
      maxFrameTime: frameTime,
      spatialContext: {
        sceneId: snap.session.sceneId,
        sceneName: snap.session.sceneName,
        mode: snap.session.mode,
        stage: contextStage,
        playerCoordinates: snap.session.playerPosition,
        cameraCoordinates: snap.session.cameraPosition,
        cameraDirection: snap.session.cameraDirection,
        cameraFov: snap.session.cameraFov,
        distanceCameraToPlayer: snap.session.distanceCameraToPlayer,
        selectedObject: snap.session.selectedObjectName
      },
      delta,
      diagnosis: classification.diagnosis,
      metrics: snap,
      previousStableMetrics: stableSample,
      recentHistory: recentHistory.slice(-60)
    };

    this.activeIncident = incident;
    this.incidents.unshift(incident);
    
    if (this.incidents.length > this.MAX_INCIDENTS) this.incidents.pop();

    console.warn(`🚨 [PerformanceIncident] [${classification.category}] [Confidence: ${classification.confidence}] ${classification.diagnosis} | FPS: ${fps.toFixed(1)} | Pos: (${snap.session.cameraPosition.x}, ${snap.session.cameraPosition.y}, ${snap.session.cameraPosition.z})`);

    this.captureVisual(incident);
  }

  private calculateDelta(curr: ProfilerMetrics, prev?: FrameSample): IncidentDelta {
    if (!prev) {
      return {
        fpsDelta: 0,
        frameTimeDeltaMs: 0,
        drawCallsDelta: 0,
        activeMeshesDelta: 0,
        activeLightsDelta: 0,
        shadowedLightsDelta: 0,
        shadowRebuildsDelta: 0,
        heapDeltaMb: 0,
        newLightsDetected: []
      };
    }

    const curHeap = typeof curr.memory.usedJSHeapSizeMb === 'number' ? curr.memory.usedJSHeapSizeMb : 0;
    return {
      fpsDelta: parseFloat((curr.fps - prev.fps).toFixed(1)),
      frameTimeDeltaMs: parseFloat((curr.frameTimeAvg - prev.frameTime).toFixed(2)),
      drawCallsDelta: curr.gpu.drawCalls - prev.drawCalls,
      activeMeshesDelta: curr.gpu.activeMeshes - prev.activeMeshes,
      activeLightsDelta: curr.lights.activePool - prev.activeLights,
      shadowedLightsDelta: curr.lights.shadowedPool - prev.shadowedLights,
      shadowRebuildsDelta: curr.shadows.renderListRebuilds - prev.shadowRebuilds,
      heapDeltaMb: parseFloat((curHeap - prev.usedHeapMb).toFixed(2)),
      newLightsDetected: curr.lights.details.filter(l => l.isLightInRange && l.targetMultiplier > 0.05).map(l => l.name)
    };
  }

  private classifyIncident(m: ProfilerMetrics, d: IncidentDelta, contextStage: string): {
    category: IncidentCategory;
    primarySuspect: string;
    secondarySuspects: string[];
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    diagnosis: string;
  } {
    const secondaries: string[] = [];

    if (contextStage === 'SCENE_LOADING_OR_TRANSITION') {
      return {
        category: 'TRANSITION_HITCH',
        primarySuspect: 'Shader Compilation / Scene Load',
        secondarySuspects: ['Texture Upload', 'Matrix Hierarchy Rebuild'],
        confidence: 'HIGH',
        diagnosis: 'Pico esperado durante el montaje y warmup de la escena'
      };
    }

    if (m.shaders.compilingCount > 0) {
      if (d.activeLightsDelta > 0) secondaries.push(`+${d.activeLightsDelta} Luces asignadas`);
      return {
        category: 'SHADER_COMPILATION_SPIKE',
        primarySuspect: `Compilación de Shader en VRAM (${m.shaders.compilingCount} materiales no listos)`,
        secondarySuspects: secondaries,
        confidence: 'HIGH',
        diagnosis: `Tormenta de compilación por alteración del pipeline o layout de luces (Max: ${m.shaders.maxLightsObserved})`
      };
    }

    if (m.shadows.renderListRebuilds > 2 || d.shadowRebuildsDelta > 0) {
      if (d.shadowedLightsDelta > 0) secondaries.push(`+${d.shadowedLightsDelta} ShadowGenerators activos`);
      return {
        category: 'SHADOW_REBUILD_SPIKE',
        primarySuspect: `Reconstrucción de RenderList en ShadowMap (${m.shadows.renderListRebuilds} rebuilds)`,
        secondarySuspects: secondaries,
        confidence: 'HIGH',
        diagnosis: 'La renderList de sombras forzó un barrido de casters en la jerarquía'
      };
    }

    if (d.activeLightsDelta > 1) {
      return {
        category: 'LIGHT_SURGE_SPIKE',
        primarySuspect: `Entrada súbita de luces al pool (+${d.activeLightsDelta} luces simultáneas)`,
        secondarySuspects: d.newLightsDetected,
        confidence: 'MEDIUM',
        diagnosis: `Las luces [${d.newLightsDetected.join(', ')}] superaron el umbral al unísono`
      };
    }

    if (typeof m.gpu.gpuFrameTime === 'number' && m.gpu.gpuFrameTime > 20.0) {
      if (m.gpu.transparentMeshes > 40) secondaries.push(`Overdraw por ${m.gpu.transparentMeshes} mallas con transparencia`);
      return {
        category: 'GPU_BOUND_SPIKE',
        primarySuspect: `Saturación de rasterización / Fragment Shader (${m.gpu.gpuFrameTime.toFixed(1)} ms GPU)`,
        secondarySuspects: secondaries,
        confidence: 'HIGH',
        diagnosis: 'La GPU tardó más de un ciclo completo en resolver el framebuffer'
      };
    }

    if (m.cpuSystems[m.dominantSystem] > 5.0) {
      return {
        category: 'CPU_SYSTEM_SPIKE',
        primarySuspect: `Sobrecarga de CPU en sistema '${m.dominantSystem}' (${m.cpuSystems[m.dominantSystem].toFixed(1)} ms)`,
        secondarySuspects: Object.keys(m.cpuSystems).filter(k => m.cpuSystems[k] > 2.0 && k !== m.dominantSystem),
        confidence: 'HIGH',
        diagnosis: `El loop se estancó principalmente en la fase de ${m.dominantSystem}`
      };
    }

    if (m.culling.modifiedEntities > 30 || m.culling.evaluatedEntities > 300) {
      return {
        category: 'CULLING_STORM_SPIKE',
        primarySuspect: `Culling masivo (${m.culling.evaluatedEntities} evaluados, ${m.culling.modifiedEntities} modificados)`,
        secondarySuspects: [`Visible: ${m.culling.visibleObjects}`, `Culled: ${m.culling.hardCulledObjects}`],
        confidence: 'MEDIUM',
        diagnosis: 'Tránsito veloz cruzó múltiples fronteras de culling al mismo tiempo'
      };
    }

    if (d.heapDeltaMb > 25.0) {
      return {
        category: 'MEMORY_GC_SPIKE',
        primarySuspect: `Pico de memoria JS Heap (+${d.heapDeltaMb} MB)`,
        secondarySuspects: ['Garbage Collection Pause'],
        confidence: 'LOW',
        diagnosis: 'Posible pausa por recolección de basura tras alocaciones intensas'
      };
    }

    return {
      category: 'FRAME_TIME_SPIKE',
      primarySuspect: 'Micro-Stutter no aislado',
      secondarySuspects: [m.dominantSystem !== 'None' ? `Dominante: ${m.dominantSystem}` : 'Fluctuación general'],
      confidence: 'LOW',
      diagnosis: 'Caída de FPS multifactorial sin un único subsistema dominante'
    };
  }

  private recoverIncident(): void {
    if (this.activeIncident) {
      this.activeIncident.status = 'RECOVERED';
      this.activeIncident.durationMs = performance.now() - this.incidentStartTime;
      console.log(`✅ [PerformanceIncident] Incidente ${this.activeIncident.id} recuperado tras ${this.activeIncident.durationMs.toFixed(0)}ms`);
    }
    this.state = 'NORMAL';
    this.activeIncident = null;
    this.cooldownTimer = this.COOLDOWN_MS;
  }

  private captureVisual(incident: PerformanceIncident): void {
    const scene = this.motor3d.getScene();
    const engine = this.motor3d.getEngine();
    const camera = scene?.activeCamera;
    
    if (engine && camera) {
      try {
        Tools.CreateScreenshotUsingRenderTarget(engine, camera, { width: 480, height: 270 }, (dataUrl) => {
          incident.imageUrl = dataUrl;
        });
      } catch (e) {
        console.warn('[PerformanceIncident] No se pudo capturar screenshot:', e);
      }
    }
  }

  public getIncidents(): PerformanceIncident[] {
    return this.incidents;
  }
}