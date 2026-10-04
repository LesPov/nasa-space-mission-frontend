// file: src/app/components/ui-profiler/ui-profiler.ts
import { Component, OnInit, OnDestroy, inject, NgZone, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineProfilerService, ProfilerMetrics } from '../../core/engine/telemetry/engine-profiler.service';
import { ProfilerTogglesService } from '../../core/engine/telemetry/profiler-toggles.service';
import { PerformanceIncidentService, PerformanceIncident } from '../../core/engine/telemetry/performance-incident.service';

@Component({
  selector: 'app-ui-profiler',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-profiler.html',
  styleUrls: ['./ui-profiler.css']
})
export class UiProfilerComponent implements OnInit, OnDestroy {
  public profiler = inject(EngineProfilerService);
  public toggles = inject(ProfilerTogglesService);
  public incidentSvc = inject(PerformanceIncidentService);
  private ngZone = inject(NgZone);

  public metrics = signal<ProfilerMetrics>(this.getEmptyMetrics());
  public incidents = signal<PerformanceIncident[]>([]);
  public incidentsCount = computed(() => this.incidents().length);
  
  public cpuPhasesKeys = computed(() => Object.keys(this.metrics().cpuPhases || {}));
  public cpuSystemsKeys = computed(() => Object.keys(this.metrics().cpuSystems || {}));
  public distanceSystemsKeys = computed(() => Object.keys(this.metrics().distances.evaluationsBySystem || {}));

  public isMinimized = signal<boolean>(false);
  public tab = signal<'metrics' | 'incidents' | 'lights' | 'shadows' | 'shaders' | 'culling' | 'transition'>('metrics');
  public selectedIncident = signal<PerformanceIncident | null>(null);

  private intervalId: any;

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => {
        if (this.profiler.isProfilingEnabled) {
          const deepLights = this.tab() === 'lights' || this.selectedIncident() !== null;
          this.metrics.set(this.profiler.getSnapshot(deepLights));
          
          const currentIncidents = this.incidentSvc.getIncidents();
          if (this.incidents().length !== currentIncidents.length || 
              (currentIncidents.length > 0 && this.incidents()[0]?.id !== currentIncidents[0]?.id) ||
              (currentIncidents.length > 0 && this.incidents()[0]?.status !== currentIncidents[0]?.status)) {
              this.incidents.set([...currentIncidents]);
          }
        }
      }, 250);
    });
  }

  ngOnDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  public toggleMinimize() {
    this.isMinimized.set(!this.isMinimized());
  }

  public viewIncident(inc: PerformanceIncident) {
    this.selectedIncident.set(inc);
  }

  public backToList() {
    this.selectedIncident.set(null);
  }

  public printToConsole() {
    this.profiler.printSnapshotToConsole();
  }

  public formatCoords(pos: { x: number; y: number; z: number } | null | undefined, fallback = 'N/A'): string {
    if (!pos) return fallback;
    return `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
  }

  public copySummary(inc?: PerformanceIncident) {
    const snap = inc ? inc.metrics : this.metrics();
    const summary = `=== FORENSIC SNAPSHOT ===\n` +
      `Mode: ${snap.session.mode} | View: ${snap.session.cameraView} | Scene: ${snap.session.sceneName} (ID: ${snap.session.sceneId})\n` +
      `CamPos: (${snap.session.cameraPosition.x}, ${snap.session.cameraPosition.y}, ${snap.session.cameraPosition.z}) | FOV: ${snap.session.cameraFov}\n` +
      `PlayerPos: ${snap.session.playerPosition ? `(${snap.session.playerPosition.x}, ${snap.session.playerPosition.y}, ${snap.session.playerPosition.z})` : 'N/A'}\n` +
      `Dist Cam-Player: ${snap.session.distanceCameraToPlayer}m\n` +
      `FPS: ${snap.fps} (Min: ${snap.frameTimeMin}ms, Max: ${snap.frameTimeMax}ms, Avg: ${snap.frameTimeAvg}ms, p99: ${snap.frameTimeP99}ms)\n` +
      `Dominant System: ${snap.dominantSystem}\n` +
      `DrawCalls: ${snap.gpu.drawCalls} | Active Meshes: ${snap.gpu.activeMeshes}/${snap.gpu.totalMeshes} | Transparent: ${snap.gpu.transparentMeshes}\n` +
      `GPU FrameTime: ${snap.gpu.gpuFrameTime}\n` +
      `Heap: ${typeof snap.memory.usedJSHeapSizeMb === 'number' ? snap.memory.usedJSHeapSizeMb + ' MB' : 'unavailable'} (Delta: ${snap.memory.heapDeltaMb} MB)\n` +
      `Lights: ${snap.lights.activePool}/${snap.lights.totalVirtual} active | Shadowed: ${snap.lights.shadowedPool}\n` +
      `Shadows: Quality ${snap.shadows.shadowQualityLevel} | Casters: ${snap.shadows.totalCasters} | Rebuilds: ${snap.shadows.renderListRebuilds} | Invalidations: ${snap.shadows.invalidations}\n` +
      `Shaders: ${snap.shaders.compilingCount} compiling | MaxLights: ${snap.shaders.maxLightsObserved}\n` +
      `Culling: Evaluated: ${snap.culling.evaluatedEntities} | Changed: ${snap.culling.modifiedEntities} | HardCulled: ${snap.culling.hardCulledObjects} | ShadowProtected: ${snap.culling.shadowProtectedObjects}\n` +
      `Transition to Live Duration: ${snap.transition.lastTransitionTotalMs}ms`;

    navigator.clipboard.writeText(summary);
    alert('📋 Resumen forense copiado al portapapeles');
  }

  public copyJson(inc?: PerformanceIncident) {
    const snap = inc ? inc : this.profiler.getSnapshot(true);
    navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    alert('📋 JSON forense completo copiado al portapapeles');
  }

  public downloadJson(inc?: PerformanceIncident) {
    const data = inc ? inc : this.profiler.getSnapshot(true);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incident_forensic_${Date.now()}.json`;
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
      frameTimeP95: 0,
      frameTimeP99: 0,
      cpuPhases: {},
      cpuSystems: {},
      dominantSystem: 'None',
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
      spaces: {
        containmentRebuilds: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
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
      distances: {
        evaluationsBySystem: {}
      },
      transition: {
        lastTransitionTotalMs: 0,
        milestones: []
      },
      session: {
        mode: 'EDITOR',
        cameraView: 'FPS',
        timestamp: '',
        runtimeReadyStage: '',
        sceneId: null,
        sceneName: '',
        playerPosition: null,
        cameraPosition: { x: 0, y: 0, z: 0 },
        cameraDirection: { x: 0, y: 0, z: 1 },
        cameraFov: 0.8,
        distanceCameraToPlayer: 0,
        selectedObjectName: null
      }
    };
  }
}