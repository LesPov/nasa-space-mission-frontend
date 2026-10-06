
// file: src/app/core/engine/telemetry/performance-incident.service.ts
import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { EngineProfilerService, ProfilerMetrics, FrameSample, TimelineEvent } from './engine-profiler.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { GameContextService } from '../session/game-context.service';
import { GameMode } from '../session/game-mode.model';
import { Vector3 } from '@babylonjs/core';

export type IncidentCategory = 
  | 'FRAME_TIME_SPIKE'
  | 'CPU_SYSTEM_SPIKE'
  | 'GPU_BOUND_SPIKE'
  | 'SHADER_COMPILATION_SPIKE'
  | 'SHADOW_REBUILD_SPIKE'
  | 'SHADOW_POP_IN'
  | 'LIGHT_ACTIVE_SHADOW_MISSING'
  | 'SHADOW_RECOVERED_AFTER_TRANSFORM'
  | 'LIGHT_SURGE_SPIKE'
  | 'OBJECT_POP_IN'
  | 'OBJECT_POP_OUT'
  | 'CULLING_FLAP'
  | 'FAST_PLAYER_MOVE'
  | 'CULLING_STORM_SPIKE'
  | 'SEQUENCE_SPIKE'
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
  activeSequencesDelta: number;
  heapDeltaMb: number;
  newLightsDetected: string[];
}

export interface SnapshotMetadata {
  requestId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'TIMEOUT';
  requestedAtFrame: number;
  capturedAtFrame?: number;
  requestedAtMs: number;
  capturedAtMs?: number;
  captureLatencyMs?: number;
  width?: number;
  height?: number;
  error?: string;
}

export interface PerformanceIncident {
  id: string;
  sessionId: string;
  entryNumber: number;
  timestamp: string;
  frameNumber: number;
  durationMs: number;
  status: 'ACTIVE' | 'RECOVERED';
  category: IncidentCategory;
  primarySuspect: string;
  secondarySuspects: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  
  fps: number;
  minFps: number;
  frameTime: number;
  maxFrameTime: number;
  
  spatialContext: {
    sceneId: number | null;
    sceneName: string;
    mode: string;
    stage: string;
    playerCoordinates: { x: number; y: number; z: number } | null;
    cameraCoordinates: { x: number; y: number; z: number };
    cameraRotation: { x: number; y: number; z: number };
    cameraDirection: { x: number; y: number; z: number };
    cameraFov: number;
    distanceCameraToPlayer: number;
    selectedObject: string | null;
  };

  delta: IncidentDelta;
  diagnosis: string;
  metrics: ProfilerMetrics;
  previousStableMetrics?: FrameSample;
  recentHistory: FrameSample[];
  postIncidentHistory?: FrameSample[];
  preIncidentEvents?: TimelineEvent[];

  imageUrl?: string;
  snapshotStatus?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'TIMEOUT';
  snapshotInfo?: SnapshotMetadata;
}

@Injectable({ providedIn: 'root' })
export class PerformanceIncidentService {
  private profiler = inject(EngineProfilerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private context = inject(GameContextService);

  public readonly onIncidentUpdated = new Subject<PerformanceIncident>();

  private incidents: PerformanceIncident[] = [];
  private readonly MAX_INCIDENTS = 15;
  
  private consecutiveBadFrames = 0;
  private consecutiveGoodFrames = 0;
  private cooldownTimer = 0;
  
  private state: 'NORMAL' | 'ACTIVE' = 'NORMAL';
  private activeIncident: PerformanceIncident | null = null;
  private incidentStartTime = 0;
  private postCaptureCounter = 0;
  private framesSinceTransitionEnd = 0;
  private sessionFrameCounter = 0;

  private lastSpecificIncidentTime = new Map<string, number>();

  private readonly FPS_THRESHOLD = 42;
  private readonly FRAMETIME_THRESHOLD = 23.8; 
  private readonly COOLDOWN_MS = 3000;
  private readonly EDITOR_STARTUP_GRACE_FRAMES = 120;
  private readonly TEST_LIVE_STARTUP_GRACE_FRAMES = 25;

  // Optimización de strings numéricos mediante matemáticas
  private round1(val: number): number { return Math.round(val * 10) / 10; }
  private round2(val: number): number { return Math.round(val * 100) / 100; }

  public notifyTransitionEnded(): void {
    this.framesSinceTransitionEnd = 0;
    this.sessionFrameCounter = 0;
  }

  public checkFrame(frameTimeMs: number, fps: number): void {
    this.framesSinceTransitionEnd++;
    this.sessionFrameCounter++;

    if (this.cooldownTimer > 0 && this.state === 'NORMAL') {
      this.cooldownTimer -= frameTimeMs;
      return;
    }

    if (this.context.isTransitioning()) {
      return;
    }

    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    const isEditorWarmup = isEditor && this.sessionFrameCounter <= this.EDITOR_STARTUP_GRACE_FRAMES;
    if (isEditorWarmup && frameTimeMs < 100.0) {
      return;
    }

    const isTestLiveImmediateStartup = !isEditor && this.framesSinceTransitionEnd <= this.TEST_LIVE_STARTUP_GRACE_FRAMES;
    if (isTestLiveImmediateStartup && frameTimeMs < 60.0) {
      return;
    }

    const toleranceFactor = isEditor ? 1.7 : 1.0; 
    const triggerLimit = isEditor ? 30 : 10;

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
          this.onIncidentUpdated.next(this.activeIncident);
        }

        if (this.consecutiveGoodFrames > 35) {
          this.recoverIncident();
        }
      }
    }
  }

  public recordShadowMissing(lightUid: string, lightName: string, distance: number): void {
    this.recordSpecificIncident('LIGHT_ACTIVE_SHADOW_MISSING', `Luz activa "${lightName}" sin sombra del Player a ${this.round1(distance)}m`, [
      `Light UID: ${lightUid}`,
      `Player en rango de luz pero no registrado en renderList`
    ], 'HIGH');
  }

  public recordShadowRecovered(lightUid: string, lightName: string): void {
    this.recordSpecificIncident('SHADOW_RECOVERED_AFTER_TRANSFORM', `Sombra del Player sincronizada tras actualización en "${lightName}"`, [
      `Light UID: ${lightUid}`
    ], 'MEDIUM');
  }

  public recordObjectPopIn(uid: string, name: string, distance: number, playerSpeed: number): void {
    this.recordSpecificIncident('OBJECT_POP_IN', `Pop-in repentino del objeto "${name}" a ${this.round1(distance)}m`, [
      `Velocidad jugador: ${this.round1(playerSpeed)} m/s`,
      `UID: ${uid}`
    ], distance < 40.0 ? 'HIGH' : 'LOW');
  }

  public recordObjectPopOut(uid: string, name: string, distance: number, playerSpeed: number): void {
    this.recordSpecificIncident('OBJECT_POP_OUT', `Objeto "${name}" desapareció repentinamente a ${this.round1(distance)}m`, [
      `Velocidad jugador: ${this.round1(playerSpeed)} m/s`,
      `UID: ${uid}`
    ], distance < 40.0 ? 'HIGH' : 'LOW');
  }

  public recordCullingFlap(uid: string, name: string, distance: number, playerSpeed: number, currentVisibility?: number): void {
    if (distance >= 80.0) {
      return;
    }

    if (currentVisibility !== undefined && currentVisibility <= 0.15) {
      return;
    }

    this.profiler.recordTimelineEvent('CULLING', 'CULLING_FLAP', { uid, name, distance, playerSpeed, currentVisibility });
    this.recordSpecificIncident('CULLING_FLAP', `Oscilación rápida de visibilidad (Culling Flap) en "${name}" a ${this.round1(distance)}m`, [
      `Velocidad jugador: ${this.round1(playerSpeed)} m/s`,
      `Visibilidad en flap: ${currentVisibility !== undefined ? Math.round(currentVisibility * 100) + '%' : 'N/A'}`,
      `Cambió de estado visible/culled reiteradamente en < 2.5s`
    ], 'HIGH');
  }

  public recordShadowPopIn(lightUid: string, lightName: string, distance: number): void {
    this.recordSpecificIncident('SHADOW_POP_IN', `Sombra de la luz "${lightName}" demoró en renderizar sus casters a ${this.round1(distance)}m`, [
      `Light UID: ${lightUid}`,
      `RenderList estaba vacía al encender`
    ], 'HIGH');
  }

  public recordFastMove(speed: number, pos: Vector3): void {
    if (this.framesSinceTransitionEnd <= 45 || this.context.isTransitioning()) {
      return;
    }

    this.recordSpecificIncident('FAST_PLAYER_MOVE', `Movimiento veloz del jugador a ${this.round1(speed)} m/s`, [
      `Posición: (${this.round1(pos.x)}, ${this.round1(pos.y)}, ${this.round1(pos.z)})`
    ], 'MEDIUM');
  }

  private recordSpecificIncident(
    category: IncidentCategory, 
    diagnosis: string, 
    secondarySuspects: string[], 
    confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  ): void {
    const now = performance.now();
    const lastTime = this.lastSpecificIncidentTime.get(category) || 0;
    if (now - lastTime < 2500) {
      return;
    }
    this.lastSpecificIncidentTime.set(category, now);

    const snap = this.profiler.getSnapshot(false);
    const recentHistory = this.profiler.getRecentHistory();
    const stableSample = recentHistory.length > 5 ? recentHistory[recentHistory.length - 5] : recentHistory[0];
    const frameNum = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1].frameId : 0;

    const incident: PerformanceIncident = {
      id: 'inc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      sessionId: snap.session.sessionId,
      entryNumber: snap.session.entryNumber,
      timestamp: new Date().toLocaleTimeString(),
      frameNumber: frameNum,
      durationMs: 16,
      status: 'RECOVERED',
      category,
      primarySuspect: diagnosis,
      secondarySuspects,
      confidence,
      fps: snap.fps,
      minFps: snap.fps,
      frameTime: snap.frameTimeAvg,
      maxFrameTime: snap.frameTimeMax,
      spatialContext: {
        sceneId: snap.session.sceneId,
        sceneName: snap.session.sceneName,
        mode: snap.session.mode,
        stage: this.determineContextStage(),
        playerCoordinates: snap.session.playerPosition ? { ...snap.session.playerPosition } : null,
        cameraCoordinates: { ...snap.session.cameraPosition },
        cameraRotation: { ...snap.session.cameraRotation },
        cameraDirection: { ...snap.session.cameraDirection },
        cameraFov: snap.session.cameraFov,
        distanceCameraToPlayer: snap.session.distanceCameraToPlayer,
        selectedObject: snap.session.selectedObjectName
      },
      delta: this.calculateDelta(snap, stableSample),
      diagnosis,
      metrics: snap,
      previousStableMetrics: stableSample,
      recentHistory: recentHistory.slice(-30),
      preIncidentEvents: this.profiler.getTimelineEvents().slice(-20),
      snapshotStatus: 'SKIPPED'
    };

    this.incidents.unshift(incident);
    if (this.incidents.length > this.MAX_INCIDENTS) this.incidents.pop();

    this.profiler.recordTimelineEvent('SPIKE', `SPECIFIC_INCIDENT_${category}`, {
      incidentId: incident.id,
      diagnosis,
      fps: snap.fps,
      confidence
    });

    this.onIncidentUpdated.next(incident);
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
    
    // Le pasamos true explícitamente porque queremos un deep snapshot forense para este incidente
    const snap = this.profiler.getSnapshot(true);
    const recentHistory = this.profiler.getRecentHistory();
    const stableSample = recentHistory.length > 10 ? recentHistory[recentHistory.length - 10] : recentHistory[0];
    const frameNum = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1].frameId : 0;

    const contextStage = this.determineContextStage();
    const delta = this.calculateDelta(snap, stableSample);
    const classification = this.classifyIncident(snap, delta, contextStage);
    
    const incident: PerformanceIncident = {
      id: 'inc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      sessionId: snap.session.sessionId,
      entryNumber: snap.session.entryNumber,
      timestamp: new Date().toLocaleTimeString(),
      frameNumber: frameNum,
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
        playerCoordinates: snap.session.playerPosition ? { ...snap.session.playerPosition } : null,
        cameraCoordinates: { ...snap.session.cameraPosition },
        cameraRotation: { ...snap.session.cameraRotation },
        cameraDirection: { ...snap.session.cameraDirection },
        cameraFov: snap.session.cameraFov,
        distanceCameraToPlayer: snap.session.distanceCameraToPlayer,
        selectedObject: snap.session.selectedObjectName
      },
      delta,
      diagnosis: classification.diagnosis,
      metrics: snap,
      previousStableMetrics: stableSample,
      recentHistory: recentHistory.slice(-60),
      preIncidentEvents: this.profiler.getTimelineEvents().slice(-30),
      snapshotStatus: 'SKIPPED'
    };

    this.activeIncident = incident;
    this.incidents.unshift(incident);
    
    if (this.incidents.length > this.MAX_INCIDENTS) this.incidents.pop();

    this.profiler.recordTimelineEvent('SPIKE', 'FRAME_SPIKE_BEGIN', {
      incidentId: incident.id,
      category: classification.category,
      fps,
      frameTime,
      primarySuspect: classification.primarySuspect
    });

    console.warn(`🚨 [PerformanceIncident] [${classification.category}] [Confidence: ${classification.confidence}] ${classification.diagnosis} | FPS: ${fps.toFixed(1)}`);
    
    this.onIncidentUpdated.next(incident);
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
        activeSequencesDelta: 0,
        heapDeltaMb: 0,
        newLightsDetected: []
      };
    }

    const curHeap = typeof curr.memory.usedJSHeapSizeMb === 'number' ? curr.memory.usedJSHeapSizeMb : 0;
    return {
      fpsDelta: this.round1(curr.fps - prev.fps),
      frameTimeDeltaMs: this.round2(curr.frameTimeAvg - prev.frameTime),
      drawCallsDelta: curr.gpu.drawCalls - prev.drawCalls,
      activeMeshesDelta: curr.gpu.activeMeshes - prev.activeMeshes,
      activeLightsDelta: curr.lights.activePool - prev.activeLights,
      shadowedLightsDelta: curr.lights.shadowedPool - prev.shadowedLights,
      shadowRebuildsDelta: curr.shadows.renderListRebuilds - prev.shadowRebuilds,
      activeSequencesDelta: curr.sequences.activeCount - (prev.activeSequences || 0),
      heapDeltaMb: this.round2(curHeap - prev.usedHeapMb),
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

    const recentShaderEvents = (m.timelineEvents || []).slice(-10).filter(e => e.category === 'SHADER' && e.name === 'NEW_SHADER_VARIANT_DETECTED');

    if (m.shaders.compilingCount > 0 && recentShaderEvents.length > 0) {
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

    if (typeof m.gpu.gpuFrameTime === 'number' && m.gpu.gpuFrameTime > 14.5) {
      if (m.gpu.drawCalls > 180) secondaries.push(`Alta cantidad de Draw Calls (${m.gpu.drawCalls})`);
      if (m.shadows.activeGenerators > 0) secondaries.push(`${m.shadows.activeGenerators} generadores de sombra procesados`);
      return {
        category: 'GPU_BOUND_SPIKE',
        primarySuspect: `Saturación de GPU por Renderizado y Sombras (${m.gpu.gpuFrameTime.toFixed(1)} ms GPU)`,
        secondarySuspects: secondaries,
        confidence: 'HIGH',
        diagnosis: `La GPU tardó ${m.gpu.gpuFrameTime.toFixed(1)}ms en resolver el framebuffer con ${m.gpu.drawCalls} draw calls`
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

    if (d.activeSequencesDelta > 2 && m.sequences.activeCount > 3) {
      return {
        category: 'SEQUENCE_SPIKE',
        primarySuspect: `Sobrecarga de Secuencias (+${d.activeSequencesDelta} concurrentes)`,
        secondarySuspects: m.sequences.details.map(s => `${s.entityName}:${s.action}`),
        confidence: 'HIGH',
        diagnosis: `Activación masiva de ${m.sequences.activeCount} secuencias evaluadas simultáneamente`
      };
    }

    if (m.cpuSystems[m.dominantSystem] > 5.0) {
      return {
        category: 'CPU_SYSTEM_SPIKE',
        primarySuspect: `Sobrecarga de CPU en sistema '${m.dominantSystem}' (${this.round1(m.cpuSystems[m.dominantSystem])} ms)`,
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
      this.profiler.recordTimelineEvent('SPIKE', 'FRAME_SPIKE_END', {
        incidentId: this.activeIncident.id,
        durationMs: this.round1(this.activeIncident.durationMs)
      });
      console.log(`✅ [PerformanceIncident] Incidente ${this.activeIncident.id} recuperado tras ${this.activeIncident.durationMs.toFixed(0)}ms`);
      this.onIncidentUpdated.next(this.activeIncident);
    }
    this.state = 'NORMAL';
    this.activeIncident = null;
    this.cooldownTimer = this.COOLDOWN_MS;
  }

  public getIncidents(): PerformanceIncident[] {
    return this.incidents;
  }
}