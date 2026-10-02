
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
  
  private consecutiveBadFrames = 0;
  private consecutiveGoodFrames = 0;
  private cooldownTimer = 0;
  
  private state: 'NORMAL' | 'ACTIVE' = 'NORMAL';
  private activeIncident: PerformanceIncident | null = null;
  private incidentStartTime = 0;

  private metricsHistory: ProfilerMetrics[] = [];
  private historyTimer = 0;

  private readonly FPS_THRESHOLD = 45;
  private readonly FRAMETIME_THRESHOLD = 22.22; 
  private readonly COOLDOWN_MS = 10000; 

  public updateHistory(dtMs: number) {
    this.historyTimer += dtMs;
    if (this.historyTimer >= 1000) { 
      this.historyTimer = 0;
      this.metricsHistory.push(this.profiler.getSnapshot());
      if (this.metricsHistory.length > 5) this.metricsHistory.shift();
    }
  }

  public checkFrame(frameTimeMs: number, fps: number) {
    this.updateHistory(frameTimeMs);

    if (this.cooldownTimer > 0 && this.state === 'NORMAL') {
      this.cooldownTimer -= frameTimeMs;
      return;
    }

    const mode = this.context.mode();
    const isEditor = mode === 'EDITOR' || mode === 'EDITING_IN_GAME';
    const toleranceFactor = isEditor ? 1.5 : 1.0; 

    if (fps < (this.FPS_THRESHOLD / toleranceFactor) || frameTimeMs > (this.FRAMETIME_THRESHOLD * toleranceFactor)) {
      this.consecutiveBadFrames++;
      this.consecutiveGoodFrames = 0;

      const triggerLimit = isEditor ? 30 : 15;

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

      if (this.state === 'ACTIVE' && this.consecutiveGoodFrames > 60) {
         this.recoverIncident();
      }
    }
  }

  public simulateIncident() {
    this.triggerIncident(30, 33.3);
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
    const snap = this.profiler.getSnapshot();
    const prevSnap = this.metricsHistory.length > 0 ? this.metricsHistory[0] : undefined;
    
    const contextStage = this.determineContextStage();
    const diagnosis = this.analyzeCausality(snap, prevSnap, contextStage);
    
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
      previousMetrics: prevSnap,
      status: 'ACTIVE',
      durationMs: 0
    };

    this.activeIncident = incident;
    this.incidents.unshift(incident);
    
    if (this.incidents.length > 15) this.incidents.pop();

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

  private analyzeCausality(m: ProfilerMetrics, prev?: ProfilerMetrics, contextStage?: string): string {
    let text = '';
    
    if (contextStage === 'SCENE_LOADING_OR_TRANSITION') {
        return 'Shader Compilation / Scene Load (Spike Esperado)';
    }
    
    if (prev) {
        const gpuDiff = m.gpu.gpuFrameTime - prev.gpu.gpuFrameTime;
        const drawDiff = m.gpu.drawCalls - prev.gpu.drawCalls;
        const meshDiff = m.gpu.activeMeshes - prev.gpu.activeMeshes;
        const transDiff = m.gpu.transparentMeshes - prev.gpu.transparentMeshes;
        const lightDiff = m.lights.activePool - prev.lights.activePool;
        const shadowDiff = m.lights.shadowedPool - prev.lights.shadowedPool;

        if (gpuDiff > 5) text += `[GPU Spike +${gpuDiff.toFixed(1)}ms] `;
        if (drawDiff > 30) text += `[DrawCalls +${drawDiff}] `;
        if (meshDiff > 20) text += `[ActiveMeshes +${meshDiff}] `;
        if (transDiff > 10) text += `[Transparent +${transDiff}] `;
        if (lightDiff > 0) text += `[Lights +${lightDiff}] `;
        if (shadowDiff > 0) text += `[Shadows +${shadowDiff}] `;
        
        if (text) text += ' ➔ ';
    }

    if (m.gpu.transparentMeshes > 60) return text + 'Fill-Rate / Overdraw Saturado (Mucha Niebla/Cristales)';
    if (m.gpu.gpuFrameTime > 18.0) return text + 'Límite GPU Alcanzado (GPU Bound)';
    if (m.cpuSystems['DynamicLightingSystem'] > 3.0) return text + 'Cuello de Botella: DynamicLightingSystem';
    if (m.cpuSystems['ShadowOrchestratorSystem'] > 3.0) return text + 'Cuello de Botella: ShadowOrchestrator';
    if (m.cpuSystems['CharacterKinematicsSystem'] > 5.0) return text + 'Sobrecarga en Físicas de Personajes';
    if (m.gpu.drawCalls > 300) return text + 'Exceso Absoluto de Draw Calls';
    if (m.gpu.activeMeshes > 200) return text + 'Demasiados Meshes Activos (Falta Culling)';
    if (m.cpuPhases['PHYSICS'] > 8.0) return text + 'Saturación en Motor Físico';
    
    return text ? text + 'Carga excesiva de geometría o materiales' : 'Pérdida de rendimiento no identificada (Micro-Stutter)';
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