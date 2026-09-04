import { Injectable } from '@angular/core';
import { Scene, Observer } from '@babylonjs/core';
import { TransformTelemetryService } from '../../telemetry/transform-telemetry.service';

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
    
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      this.frameCount++;
      this.telemetry.beginFrame(this.frameCount);
      
      const dtMs = this.scene!.getEngine().getDeltaTime();
      this.executeFrame(dtMs);
      
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

  private executeFrame(dtMs: number): void {
    this.executePhase(GamePhase.PRE_UPDATE, dtMs);
    this.executePhase(GamePhase.PHYSICS, dtMs);
    this.executePhase(GamePhase.LOGIC, dtMs);
    this.executePhase(GamePhase.ANIMATION, dtMs);
    this.executePhase(GamePhase.CAMERA, dtMs);
    this.executePhase(GamePhase.POST_UPDATE, dtMs);
  }

  private executePhase(phase: GamePhase, dtMs: number): void {
    this.telemetry.setPhase(GamePhase[phase]);
    
    const phaseMap = this.phases.get(phase);
    if (phaseMap) {
      for (const [id, callback] of phaseMap.entries()) {
        try {
          callback(dtMs);
        } catch (error) {
          console.error(`[LoopManager] Error ejecutando callback '${id}' en fase ${GamePhase[phase]}:`, error);
        }
      }
    }

    for (let i = 0; i < this.updatablesList.length; i++) {
      const sys = this.updatablesList[i];
      try {
        if (phase === GamePhase.PRE_UPDATE && sys.preUpdate) sys.preUpdate(dtMs);
        if (phase === GamePhase.PHYSICS && sys.physicsUpdate) sys.physicsUpdate(dtMs);
        if (phase === GamePhase.LOGIC && sys.update) sys.update(dtMs);
        if (phase === GamePhase.ANIMATION && sys.animationUpdate) sys.animationUpdate(dtMs);
        if (phase === GamePhase.CAMERA && sys.cameraUpdate) sys.cameraUpdate(dtMs);
        if (phase === GamePhase.POST_UPDATE && sys.postUpdate) sys.postUpdate(dtMs);
      } catch (error) {
        console.error(`[LoopManager] Error ejecutando sistema '${sys.id}' en fase ${GamePhase[phase]}:`, error);
      }
    }
  }
}