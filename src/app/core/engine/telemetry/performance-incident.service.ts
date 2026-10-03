
import { Injectable, inject } from '@angular/core';
import { EngineProfilerService, ProfilerMetrics } from './engine-profiler.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { GameContextService } from '../session/game-context.service';
import { Tools } from '@babylonjs/core';

export interface PerformanceIncident {
  id: string;
  timestamp: string;
  mode: string;
  contextStage: string;
  fps: number;
  minFps: number;
  frameTime: number;
  maxFrameTime: number;
  diagnosis: string;
  metrics: ProfilerMetrics;
  previousMetrics?: ProfilerMetrics;
  recentHistory?: Array<{ frameId: number; fps: number; frameTime: number; drawCalls: number; activeMeshes: number }>;
  imageUrl?: string;
  status: 'ACTIVE' | 'RECOVERED';
  durationMs: number;
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

  private readonly FPS_THRESHOLD = 42;
  private readonly FRAMETIME_THRESHOLD = 23.8; 
  private readonly COOLDOWN_MS = 8000; 

  public checkFrame(frameTimeMs: number, fps: number) {
    if (this.cooldownTimer > 0 && this.state === 'NORMAL') {
      this.cooldownTimer -= frameTimeMs;
      return;
    }

    const mode = this.context.mode();
    const isEditor = mode === 'EDITOR' || mode === 'EDITING_IN_GAME';
    const toleranceFactor = isEditor ? 1.4 : 1.0; 

    if (fps < (this.FPS_THRESHOLD / toleranceFactor) || frameTimeMs > (this.FRAMETIME_THRESHOLD * toleranceFactor)) {
      this.consecutiveBadFrames++;
      this.consecutiveGoodFrames = 0;

      const triggerLimit = isEditor ? 25 : 12;

      if (this.state === 'NORMAL' && this.consecutiveBadFrames > triggerLimit) {
         this.triggerIncident(fps, frameTimeMs);
      } else if (this.state === 'ACTIVE' && this.activeIncident) {
         if (fps < this.activeIncident.minFps) this.activeIncident.minFps = fps;
         if (frameTimeMs > this.activeIncident.maxFrameTime) this.activeIncident.maxFrameTime = frameTimeMs;
         this.activeIncident.durationMs = performance.now() - this.incidentStartTime;
      }
    } else {
      this.consecutiveBadFrames = 0;
      this.consecutiveGoodFrames++;

      if (this.state === 'ACTIVE' && this.consecutiveGoodFrames > 45) {
         this.recoverIncident();
      }
    }
  }

  public simulateIncident() {
    this.triggerIncident(32, 31.2);
    setTimeout(() => this.recoverIncident(), 2500);
  }
  
  private determineContextStage(): string {
      if (this.context.isTransitioning()) return 'SCENE_LOADING_OR_TRANSITION';
      if (this.context.isInteracting()) return 'EDITOR_INTERACTION';
      if (this.context.isPlaying()) return 'TEST_LIVE_PLAY';
      if (this.context.mode() === 'EDITOR') return 'EDITOR_IDLE';
      if (this.context.mode() === 'EDITING_IN_GAME') return 'EDITING_IN_GAME';
      return 'IDLE_OR_UNKNOWN';
  }

  private triggerIncident(fps: number, frameTime: number) {
    this.state = 'ACTIVE';
    this.incidentStartTime = performance.now();
    
    // Captura profunda (incluye luces detalladas bajo demanda)
    const snap = this.profiler.getSnapshot(true);
    const recentHistory = [...this.profiler.getRecentHistory()];
    const prevSnap = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1] as any : undefined;
    
    const contextStage = this.determineContextStage();
    const diagnosis = this.analyzeCausality(snap, contextStage);
    
    const incident: PerformanceIncident = {
      id: 'inc_' + Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      mode: this.context.mode(),
      contextStage: contextStage,
      fps,
      minFps: fps,
      frameTime,
      maxFrameTime: frameTime,
      diagnosis,
      metrics: snap,
      recentHistory: recentHistory,
      status: 'ACTIVE',
      durationMs: 0
    };

    this.activeIncident = incident;
    this.incidents.unshift(incident);
    
    if (this.incidents.length > this.MAX_INCIDENTS) this.incidents.pop();

    console.warn(`🚨 [PerformanceIncident] [${contextStage}] ${diagnosis} | FPS: ${fps.toFixed(1)}`);

    this.captureVisual(incident);
  }

  private recoverIncident() {
    if (this.activeIncident) {
        this.activeIncident.status = 'RECOVERED';
        this.activeIncident.durationMs = performance.now() - this.incidentStartTime;
        console.log(`✅ [PerformanceIncident] Estabilizado tras ${this.activeIncident.durationMs.toFixed(0)}ms`);
    }
    this.state = 'NORMAL';
    this.activeIncident = null;
    this.cooldownTimer = this.COOLDOWN_MS;
  }

  private analyzeCausality(m: ProfilerMetrics, contextStage?: string): string {
    let text = '';
    
    if (contextStage === 'SCENE_LOADING_OR_TRANSITION') {
        return 'Shader Compilation / Scene Load (Spike Esperado)';
    }

    if (m.gpu.transparentMeshes > 60) text += '[High Overdraw / Transparencias] ';
    if (m.gpu.gpuFrameTime > 18.0) text += '[GPU Bound] ';
    if (m.cpuSystems['DynamicLightingSystem'] > 3.0) text += '[DynamicLightingSystem Overload] ';
    if (m.cpuSystems['ShadowOrchestratorSystem'] > 3.0) text += '[ShadowOrchestrator Overload] ';
    if (m.shadows.renderListRebuilds > 0) text += '[Shadow RenderList Rebuild] ';
    if (m.gpu.drawCalls > 300) text += '[Excessive Draw Calls] ';
    if (m.gpu.activeMeshes > 200) text += '[High Active Meshes] ';
    if (m.cpuPhases['PHYSICS'] > 8.0) text += '[Physics Saturation] ';
    
    return text ? text + '➔ Saturación simultánea de recursos' : 'Pérdida de rendimiento no identificada (Micro-Stutter)';
  }

  private captureVisual(incident: PerformanceIncident) {
    const scene = this.motor3d.getScene();
    const engine = this.motor3d.getEngine();
    const camera = scene?.activeCamera;
    
    if (engine && camera) {
      Tools.CreateScreenshotUsingRenderTarget(engine, camera, { width: 640, height: 360 }, (dataUrl) => {
         incident.imageUrl = dataUrl;
      });
    }
  }

  public getIncidents(): PerformanceIncident[] {
    return this.incidents;
  }
}