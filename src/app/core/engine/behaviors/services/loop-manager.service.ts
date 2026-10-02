
import { Injectable, inject, Injector } from '@angular/core';
import { Scene, Observer } from '@babylonjs/core';
import { TransformTelemetryService } from '../../telemetry/transform-telemetry.service';
import { SimulationClockService } from '../../runtime/time/simulation-clock.service';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
 
export enum GamePhase {
  PRE_UPDATE = 0,
  PHYSICS = 1,
  LOGIC = 2,
  ANIMATION = 3,
  CAMERA = 4,
  POST_UPDATE = 5
}

type LoopCallback = (deltaTimeMs: number) => void;

export interface IUpdatable {
  id: string;
  preUpdate?(dtMs: number): void;
  physicsUpdate?(dtMs: number): void;
  update?(dtMs: number): void;
  animationUpdate?(dtMs: number): void;
  cameraUpdate?(dtMs: number): void;
  postUpdate?(dtMs: number): void;
}

@Injectable({ providedIn: 'root' })
export class LoopManagerService {
  private scene: Scene | null = null;
  private observer: Observer<Scene> | null = null;

  private phases: Map<GamePhase, Map<string, LoopCallback>> = new Map();
  private updatablesMap = new Map<string, IUpdatable>();
  private updatablesList: IUpdatable[] = [];

  private frameCount = 0;
  private clock = inject(SimulationClockService);
  private injector = inject(Injector);

  private _profiler: EngineProfilerService | null = null;
  private get profiler(): EngineProfilerService {
    if (!this._profiler) {
      this._profiler = this.injector.get(EngineProfilerService);
    }
    return this._profiler;
  }

  constructor(private telemetry: TransformTelemetryService) {
    Object.values(GamePhase).forEach(phase => {
      if (typeof phase === 'number') {
        this.phases.set(phase as GamePhase, new Map());
      }
    });
  }

  public initialize(scene: Scene): void {
    if (this.observer) {
      this.scene?.onBeforeRenderObservable.remove(this.observer);
    }
    
    this.scene = scene;
    this.clock.reset();
    
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      this.frameCount++;
      this.telemetry.beginFrame(this.frameCount);
      
      const rawDtMs = this.scene!.getEngine().getDeltaTime();
      this.executeFrame(rawDtMs);
      
      this.telemetry.endFrame();
    });
  }

  public dispose(): void {
    if (this.observer && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
    }
    this.phases.forEach(map => map.clear());
    this.updatablesMap.clear();
    this.updatablesList = [];
    this.observer = null;
    this.scene = null;
    this.clock.reset();
  }

  public registerSystem(system: IUpdatable): void {
    if (!this.updatablesMap.has(system.id)) {
      this.updatablesMap.set(system.id, system);
      this.updatablesList.push(system);
    }
  }

  public unregisterSystem(id: string): void {
    if (this.updatablesMap.has(id)) {
      this.updatablesMap.delete(id);
      this.updatablesList = this.updatablesList.filter(s => s.id !== id);
    }
  }

  public register(id: string, phase: GamePhase, callback: LoopCallback): void {
    const phaseMap = this.phases.get(phase);
    if (phaseMap) {
      phaseMap.set(id, callback);
    }
  }

  public unregister(id: string): void {
    this.phases.forEach(map => {
      if (map.has(id)) {
        map.delete(id);
      }
    });
  }

  private executeFrame(rawDtMs: number): void {
    const clock = this.clock;
    clock.advance(rawDtMs);

    const renderDt = clock.renderDeltaTimeMs;
    const simSteps = clock.substeps;

    this.executePhase(GamePhase.PRE_UPDATE, renderDt);

    if (clock.timeScale > 0 && simSteps.length > 0) {
      for (let s = 0; s < simSteps.length; s++) {
        const stepDt = simSteps[s];
        this.executePhase(GamePhase.PHYSICS, stepDt);
        this.executePhase(GamePhase.LOGIC, stepDt);
      }
    } else if (clock.timeScale === 0) {
      this.executePhase(GamePhase.PHYSICS, 0);
      this.executePhase(GamePhase.LOGIC, 0);
    }

    const animDt = clock.timeScale === 0 ? 0 : renderDt;
    this.executePhase(GamePhase.ANIMATION, animDt);

    this.executePhase(GamePhase.CAMERA, renderDt);
    this.executePhase(GamePhase.POST_UPDATE, renderDt);
  }

  private executePhase(phase: GamePhase, dtMs: number): void {
    const phaseName = GamePhase[phase];
    this.telemetry.setPhase(phaseName);
    
    const phaseStart = performance.now();

    const phaseMap = this.phases.get(phase);
    if (phaseMap) {
      for (const [id, callback] of phaseMap.entries()) {
        try {
          const start = performance.now();
          callback(dtMs);
          this.profiler.recordSystemTime(id, performance.now() - start);
        } catch (error) {
          console.error(`[LoopManager] Error ejecutando callback '${id}' en fase ${phaseName}:`, error);
        }
      }
    }

    for (let i = 0; i < this.updatablesList.length; i++) {
      const sys = this.updatablesList[i];
      try {
        const sysStart = performance.now();
        if (phase === GamePhase.PRE_UPDATE && sys.preUpdate) sys.preUpdate(dtMs);
        if (phase === GamePhase.PHYSICS && sys.physicsUpdate) sys.physicsUpdate(dtMs);
        if (phase === GamePhase.LOGIC && sys.update) sys.update(dtMs);
        if (phase === GamePhase.ANIMATION && sys.animationUpdate) sys.animationUpdate(dtMs);
        if (phase === GamePhase.CAMERA && sys.cameraUpdate) sys.cameraUpdate(dtMs);
        if (phase === GamePhase.POST_UPDATE && sys.postUpdate) sys.postUpdate(dtMs);
        this.profiler.recordSystemTime(sys.id, performance.now() - sysStart);
      } catch (error) {
        console.error(`[LoopManager] Error ejecutando sistema '${sys.id}' en fase ${phaseName}:`, error);
      }
    }

    this.profiler.recordPhaseTime(phaseName, performance.now() - phaseStart);
  }
}