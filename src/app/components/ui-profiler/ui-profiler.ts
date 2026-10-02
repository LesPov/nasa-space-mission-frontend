
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineProfilerService, ProfilerMetrics } from '../../core/engine/telemetry/engine-profiler.service';
import { ProfilerTogglesService } from '../../core/engine/telemetry/profiler-toggles.service';

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
  private cdr = inject(ChangeDetectorRef);

  public metrics: ProfilerMetrics = this.getEmptyMetrics();
  private intervalId: any;

  ngOnInit() {
    // Para no afectar el profiling con el propio Change Detection de Angular, 
    // actualizamos la UI de forma controlada a 4 Hz (250ms).
    this.intervalId = setInterval(() => {
      if (this.profiler.isProfilingEnabled) {
        this.metrics = this.profiler.getSnapshot();
        this.cdr.detectChanges();
      }
    }, 250);
  }

  ngOnDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  public objectKeys(obj: any): string[] {
    return Object.keys(obj || {});
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