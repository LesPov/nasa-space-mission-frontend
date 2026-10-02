
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

  // 🔥 SOLUCIÓN NG0100: Arquitectura puramente reactiva Zoneless con Signals
  public metrics = signal<ProfilerMetrics>(this.getEmptyMetrics());
  public incidents = signal<PerformanceIncident[]>([]);
  public incidentsCount = computed(() => this.incidents().length);
  
  // 🔥 OPTIMIZACIÓN UI: Evitamos ejecutar Object.keys() 60 veces por segundo en el HTML
  public cpuPhasesKeys = computed(() => Object.keys(this.metrics().cpuPhases || {}));
  public cpuSystemsKeys = computed(() => Object.keys(this.metrics().cpuSystems || {}));

  public tab = signal<'metrics' | 'incidents'>('metrics');

  private intervalId: any;

  ngOnInit() {
    // El timer corre fuera de Angular para no disparar detecciones globales,
    // y solo actualiza las señales, lo cual es ultra-eficiente en Zoneless.
    this.ngZone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => {
        if (this.profiler.isProfilingEnabled) {
          this.metrics.set(this.profiler.getSnapshot());
          
          // Actualización superficial para triggerear reactividad solo si cambió la longitud o hay updates
          const currentIncidents = this.incidentSvc.getIncidents();
          
          // 🔥 FIX: Prevenir que Angular asigne un Array nuevo cada 250ms sin justificación
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
      gpu: { drawCalls: 0, activeMeshes: 0, activeIndices: 0, gpuFrameTime: 0 },
      lights: { totalVirtual: 0, activePool: 0, shadowedPool: 0 },
      shadows: { activeGenerators: 0, totalCasters: 0, csmMaxZ: 0 }
    };
  }
}