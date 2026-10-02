
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

  public tab = signal<'metrics' | 'incidents'>('metrics');

  private intervalId: any;

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => {
        if (this.profiler.isProfilingEnabled) {
          this.metrics.set(this.profiler.getSnapshot());
          
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

  public printToConsole() {
    this.profiler.printSnapshotToConsole();
  }

  private getEmptyMetrics(): ProfilerMetrics {
    return {
      fps: 0, frameTimeAvg: 0, frameTimeP50: 0, frameTimeP95: 0, frameTimeP99: 0,
      cpuPhases: {}, cpuSystems: {},
      gpu: { drawCalls: 0, activeMeshes: 0, activeIndices: 0, gpuFrameTime: 0, hardwareScaling: 1.0, qualityTier: 'HIGH', transparentMeshes: 0 },
      lights: { totalVirtual: 0, activePool: 0, shadowedPool: 0 },
      shadows: { activeGenerators: 0, totalCasters: 0, csmMaxZ: 0, csmCascades: 0, invalidations: 0, renderListRebuilds: 0, staticCastersFrozen: 0, dynamicCastersActive: 0 },
      spaces: { containmentRebuilds: 0, cacheHits: 0, cacheMisses: 0 }
    };
  }
}