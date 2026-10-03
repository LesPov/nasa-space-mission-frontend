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

  public isMinimized = signal<boolean>(false);
  public tab = signal<'metrics' | 'incidents' | 'lights' | 'shadows'>('metrics');
  public selectedIncident = signal<PerformanceIncident | null>(null);

  private intervalId: any;

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => {
        if (this.profiler.isProfilingEnabled) {
          // Captura completa incluyendo luces en profundidad cuando el tab de luces está activo
          const deepLights = this.tab() === 'lights' || this.selectedIncident() !== null;
          this.metrics.set(this.profiler.getSnapshot(deepLights));
          
          const currentIncidents = this.incidentSvc.getIncidents();
          if (this.incidents().length !== currentIncidents.length || 
              (currentIncidents.length > 0 && this.incidents()[0]?.id !== currentIncidents[0]?.id) ||
              (currentIncidents.length > 0 && this.incidents()[0]?.status !== currentIncidents[0]?.status)) {
              this.incidents.set([...currentIncidents]);
          }
        }
      }, 300);
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

  public copySummary(inc?: PerformanceIncident) {
    const snap = inc ? inc.metrics : this.metrics();
    const summary = `INCIDENT / SNAPSHOT SUMMARY\nMode: ${snap.session.mode}\nFPS: ${snap.fps.toFixed(1)} | Frame: ${snap.frameTimeAvg.toFixed(2)}ms\nGPU DrawCalls: ${snap.gpu.drawCalls} | Active Meshes: ${snap.gpu.activeMeshes}\nLights Pool: ${snap.lights.activePool} active / ${snap.lights.shadowedPool} shadowed\nShadow Rebuilds: ${snap.shadows.renderListRebuilds} | Quality: ${snap.gpu.qualityTier}\nCulling: Visible: ${snap.culling.visibleObjects} | Fading: ${snap.culling.fadingObjects} | Culled: ${snap.culling.hardCulledObjects} | Restoring: ${snap.culling.restoringObjects} | ShadowProtected: ${snap.culling.shadowProtectedObjects}`;
    navigator.clipboard.writeText(summary);
    alert('📋 Resumen copiado al portapapeles');
  }

  public copyJson(inc?: PerformanceIncident) {
    const snap = inc ? inc.metrics : this.profiler.getSnapshot(true);
    navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    alert('📋 JSON forense completo copiado al portapapeles');
  }

  private getEmptyMetrics(): ProfilerMetrics {
    return {
      fps: 0,
      frameTimeAvg: 0,
      frameTimeP50: 0,
      frameTimeP95: 0,
      frameTimeP99: 0,
      cpuPhases: {},
      cpuSystems: {},
      gpu: {
        drawCalls: 0,
        activeMeshes: 0,
        activeIndices: 0,
        gpuFrameTime: 0,
        hardwareScaling: 1.0,
        qualityTier: 'HIGH',
        transparentMeshes: 0,
        totalMeshes: 0,
        visibleMeshes: 0
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
        visibleObjects: 0,
        fadingObjects: 0,
        hardCulledObjects: 0,
        restoringObjects: 0,
        shadowProtectedObjects: 0
      },
      session: {
        mode: 'EDITOR',
        cameraView: 'FPS',
        timestamp: ''
      }
    };
  }
}