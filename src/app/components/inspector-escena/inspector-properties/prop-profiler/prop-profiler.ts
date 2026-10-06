
// file: src/app/components/inspector-escena/inspector-properties/prop-profiler/prop-profiler.ts
import { Component, OnInit, OnDestroy, inject, NgZone, signal, computed, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { EngineProfilerService, ProfilerMetrics, TimelineEvent, EntrySummaryComparison, TelemetryTier } from '../../../../core/engine/telemetry/engine-profiler.service';
import { ProfilerTogglesService } from '../../../../core/engine/telemetry/profiler-toggles.service';
import { PerformanceIncidentService, PerformanceIncident } from '../../../../core/engine/telemetry/performance-incident.service';

export type ProfilerSection = 
  | 'overview' 
  | 'timeline'
  | 'compare'
  | 'cpu' 
  | 'gpu' 
  | 'hub'
  | 'lights' 
  | 'shadows' 
  | 'shaders' 
  | 'culling' 
  | 'sequences' 
  | 'context' 
  | 'incidents';

@Component({
  selector: 'app-prop-profiler',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-profiler.html',
  styleUrls: ['./prop-profiler.css']
})
export class PropProfilerComponent implements OnInit, OnDestroy {
  public profiler = inject(EngineProfilerService);
  public toggles = inject(ProfilerTogglesService);
  public incidentSvc = inject(PerformanceIncidentService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  public metrics = signal<ProfilerMetrics>(this.getEmptyMetrics());
  public incidents = signal<PerformanceIncident[]>([]);
  public incidentsCount = computed(() => this.incidents().length);

  public activeSection = signal<ProfilerSection>('overview');
  public selectedIncident = signal<PerformanceIncident | null>(null);

  public timelineFilter = signal<string>('ALL');

  public expandedLightUids = signal<Set<string>>(new Set());
  public expandedIncidentSections = signal<Set<string>>(new Set([
    'summary', 'location', 'performance', 'changes', 'timeline'
  ]));

  public cpuPhasesKeys = computed(() => Object.keys(this.metrics().cpuPhases || {}));
  public cpuSystemsList = computed(() => {
    const sys = this.metrics().cpuSystems || {};
    return Object.keys(sys)
      .map(name => ({ name, time: sys[name] }))
      .filter(item => item.time > 0.05)
      .sort((a, b) => b.time - a.time);
  });
  public distanceSystemsKeys = computed(() => Object.keys(this.metrics().distances.evaluationsBySystem || {}));

  public filteredTimelineEvents = computed(() => {
    const events = this.metrics().timelineEvents || [];
    const filter = this.timelineFilter();
    if (filter === 'ALL') return events.slice(-60).reverse();
    return events.filter(e => e.category === filter).slice(-60).reverse();
  });

  public systemHealthStatus = computed<'NORMAL' | 'WARNING' | 'CRITICAL'>(() => {
    const inc = this.incidentSvc.getIncidents().find(i => i.status === 'ACTIVE');
    if (inc) return 'CRITICAL';
    const m = this.metrics();
    if (m.fps < 45 || m.frameTimeP95 > 22.0 || m.shaders.compilingCount > 0) return 'WARNING';
    return 'NORMAL';
  });

  private intervalId: any = null;
  private incidentSub: Subscription | null = null;

  ngOnInit(): void {
    // Al abrir el Profiler, habilitamos inspecciones pesadas
    this.profiler.setTier(TelemetryTier.FORENSIC);
    this.incidents.set([...this.incidentSvc.getIncidents()]);

    this.incidentSub = this.incidentSvc.onIncidentUpdated.subscribe((updatedInc: PerformanceIncident) => {
      this.incidents.update(list => {
        const idx = list.findIndex(i => i.id === updatedInc.id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = { ...updatedInc };
          return next;
        }
        return [updatedInc, ...list];
      });

      if (this.selectedIncident()?.id === updatedInc.id) {
        this.selectedIncident.set({ ...updatedInc });
      }

      this.cdr.markForCheck();
    });

    this.ngZone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => {
        if (this.selectedIncident() !== null) {
          return;
        }

        if (this.profiler.isProfilingEnabled) {
          const deepLights = this.activeSection() === 'lights';
          const fresh = this.profiler.getSnapshot(deepLights);
          const currentIncidents = this.incidentSvc.getIncidents();

          this.metrics.set(fresh);

          if (this.incidents().length !== currentIncidents.length ||
              (currentIncidents.length > 0 && this.incidents()[0]?.id !== currentIncidents[0]?.id) ||
              (currentIncidents.length > 0 && this.incidents()[0]?.status !== currentIncidents[0]?.status)) {
            this.incidents.set([...currentIncidents]);
          }

          this.cdr.markForCheck();
        }
      }, 300);
    });
  }

  ngOnDestroy(): void {
    // Al cerrar, volvemos a BALANCED para salvar recursos de CPU (Render Loop seguro)
    this.profiler.setTier(TelemetryTier.BALANCED);

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.incidentSub) {
      this.incidentSub.unsubscribe();
      this.incidentSub = null;
    }
  }

  public setSection(sec: ProfilerSection): void {
    this.activeSection.set(sec);
  }

  public selectIncident(inc: PerformanceIncident): void {
    const latest = this.incidentSvc.getIncidents().find(i => i.id === inc.id) || inc;
    this.selectedIncident.set({ ...latest });
  }

  public exitIncidentView(): void {
    this.selectedIncident.set(null);
  }

  public onFilterChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (target) {
      this.timelineFilter.set(target.value);
    }
  }

  public toggleLightExpand(uid: string): void {
    const current = new Set(this.expandedLightUids());
    if (current.has(uid)) current.delete(uid);
    else current.add(uid);
    this.expandedLightUids.set(current);
  }

  public isLightExpanded(uid: string): boolean {
    return this.expandedLightUids().has(uid);
  }

  public toggleIncidentSection(key: string): void {
    const current = new Set(this.expandedIncidentSections());
    if (current.has(key)) current.delete(key);
    else current.add(key);
    this.expandedIncidentSections.set(current);
  }

  public isIncidentSectionExpanded(key: string): boolean {
    return this.expandedIncidentSections().has(key);
  }

  public formatCoords(pos: { x: number; y: number; z: number } | null | undefined, fallback = 'N/A'): string {
    if (!pos) return fallback;
    return `X: ${pos.x.toFixed(1)} | Y: ${pos.y.toFixed(1)} | Z: ${pos.z.toFixed(1)}`;
  }

  public copySummary(inc?: PerformanceIncident): void {
    const snap = inc ? inc.metrics : this.metrics();
    const snapInfo = inc?.snapshotInfo;
    const summary = `=== MOTOR 3D FORENSIC TELEMETRY ===\n` +
      `Incident ID: ${inc ? inc.id : 'N/A'} | Snapshot Status: ${snapInfo ? snapInfo.status : 'N/A'}\n` +
      `Incident Frame: ${inc ? inc.frameNumber : 'N/A'} | Snapshot Frame: ${snapInfo?.capturedAtFrame ?? 'N/A'} (Latency: ${snapInfo?.captureLatencyMs ?? 'N/A'}ms)\n` +
      `Session ID: ${snap.session.sessionId} | Entry #: ${snap.session.entryNumber}\n` +
      `Mode: ${snap.session.mode} | View: ${snap.session.cameraView} | Platform: ${snap.session.sceneName} (ID: ${snap.session.sceneId})\n` +
      `CamPos: (${snap.session.cameraPosition.x}, ${snap.session.cameraPosition.y}, ${snap.session.cameraPosition.z}) | FOV: ${snap.session.cameraFov}\n` +
      `PlayerPos: ${snap.session.playerPosition ? `(${snap.session.playerPosition.x}, ${snap.session.playerPosition.y}, ${snap.session.playerPosition.z})` : 'N/A'}\n` +
      `Dist Cam-Player: ${snap.session.distanceCameraToPlayer}m\n` +
      `FPS: ${snap.fps} (Min: ${snap.frameTimeMin}ms, Max: ${snap.frameTimeMax}ms, Avg: ${snap.frameTimeAvg}ms, p99: ${snap.frameTimeP99}ms)\n` +
      `Dominant System: ${snap.dominantSystem} (Telemetry CPU: ${snap.telemetryCpuTimeMs}ms)\n` +
      `DrawCalls: ${snap.gpu.drawCalls} | Active Meshes: ${snap.gpu.activeMeshes}/${snap.gpu.totalMeshes} | Transparent: ${snap.gpu.transparentMeshes}\n` +
      `GPU FrameTime: ${snap.gpu.gpuFrameTime}\n` +
      `Heap: ${typeof snap.memory.usedJSHeapSizeMb === 'number' ? snap.memory.usedJSHeapSizeMb + ' MB' : 'unavailable'} (Delta: ${snap.memory.heapDeltaMb} MB)\n` +
      `Lights: ${snap.lights.activePool}/${snap.lights.totalVirtual} active | Shadowed: ${snap.lights.shadowedPool}\n` +
      `Shadows: Quality ${snap.shadows.shadowQualityLevel} | Casters: ${snap.shadows.totalCasters} | Rebuilds: ${snap.shadows.renderListRebuilds} | Invalidations: ${snap.shadows.invalidations}\n` +
      `Shaders: ${snap.shaders.compilingCount} compiling | MaxLights: ${snap.shaders.maxLightsObserved}\n` +
      `Culling: Evaluated: ${snap.culling.evaluatedEntities} | Changed: ${snap.culling.modifiedEntities} | HardCulled: ${snap.culling.hardCulledObjects} | ShadowProtected: ${snap.culling.shadowProtectedObjects}\n` +
      `Transition to Live: ${snap.transition.lastTransitionTotalMs}ms`;

    navigator.clipboard.writeText(summary);
    alert('📋 Resumen técnico copiado al portapapeles');
  }

  public copyJson(inc?: PerformanceIncident): void {
    const data = inc ? inc : this.profiler.getSnapshot(true);
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    alert('📋 JSON forense completo copiado al portapapeles');
  }

  public downloadJson(inc?: PerformanceIncident): void {
    const data = inc ? inc : this.profiler.getSnapshot(true);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incident_forensic_${inc?.id || Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private getEmptyMetrics(): ProfilerMetrics {
    return {
      fps: 0,
      frameTimeAvg: 0,
      frameTimeMin: 0,
      frameTimeMax: 0,
      frameTimeP50: 0,
      frameTimeP90: 0,
      frameTimeP95: 0,
      frameTimeP99: 0,
      worstFrameTime: 0,
      latencyBuckets: {
        framesAbove33ms: 0,
        framesAbove50ms: 0,
        framesAbove100ms: 0,
        framesAbove250ms: 0,
        framesAbove500ms: 0,
        framesAbove1000ms: 0
      },
      cpuPhases: {},
      cpuSystems: {},
      dominantSystem: 'None',
      telemetryCpuTimeMs: 0,
      gpu: {
        drawCalls: 0,
        activeMeshes: 0,
        activeIndices: 0,
        gpuFrameTime: 'unavailable',
        hardwareScaling: 1.0,
        qualityTier: 'HIGH',
        transparentMeshes: 0,
        totalMeshes: 0,
        visibleMeshes: 0
      },
      memory: {
        usedJSHeapSizeMb: 'unavailable',
        totalJSHeapSizeMb: 'unavailable',
        jsHeapSizeLimitMb: 'unavailable',
        heapDeltaMb: 0
      },
      lights: {
        totalVirtual: 0,
        activePool: 0,
        shadowedPool: 0,
        fadingInCount: 0,
        fadingOutCount: 0,
        inactiveCount: 0,
        details: []
      },
      shadows: {
        shadowQualityLevel: 'MEDIUM',
        activeGenerators: 0,
        totalCasters: 0,
        csmMaxZ: 0,
        csmCascades: 0,
        invalidations: 0,
        renderListRebuilds: 0,
        staticCastersFrozen: 0,
        dynamicCastersActive: 0
      },
      spaces: { containmentRebuilds: 0, cacheHits: 0, cacheMisses: 0 },
      culling: {
        evaluatedEntities: 0,
        modifiedEntities: 0,
        visibleObjects: 0,
        fadingObjects: 0,
        hardCulledObjects: 0,
        restoringObjects: 0,
        shadowProtectedObjects: 0
      },
      shaders: {
        totalMaterials: 0,
        standardMaterials: 0,
        pbrMaterials: 0,
        multiMaterials: 0,
        compilingCount: 0,
        totalCompilationsDetected: 0,
        maxLightsObserved: 0
      },
      sequences: { activeCount: 0, details: [] },
      distances: { evaluationsBySystem: {} },
      transition: { lastTransitionTotalMs: 0, milestones: [] },
      session: {
        mode: 'EDITOR',
        cameraView: 'FPS',
        timestamp: '',
        runtimeReadyStage: '',
        sceneId: null,
        sceneName: '',
        playerPosition: null,
        playerRotation: null,
        cardinalDirection: '',
        fogCenter: { x: 0, y: 0, z: 0 },
        fogRingDistances: [],
        cameraPosition: { x: 0, y: 0, z: 0 },
        cameraRotation: { x: 0, y: 0, z: 0 },
        cameraDirection: { x: 0, y: 0, z: 1 },
        cameraFov: 0.8,
        distanceCameraToPlayer: 0,
        selectedObjectName: null,
        sessionId: 'init_session',
        entryNumber: 0
      },
      timelineEvents: [],
      sessionComparisons: []
    };
  }
}