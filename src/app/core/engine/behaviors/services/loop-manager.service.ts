import { Injectable } from '@angular/core';
import { Scene, Observer } from '@babylonjs/core';

export enum GamePhase {
  PRE_UPDATE = 0,
  PHYSICS = 1,
  LOGIC = 2,
  ANIMATION = 3,
  CAMERA = 4,
  POST_UPDATE = 5
}

type LoopCallback = (deltaTimeMs: number) => void;

// 🔥 NUEVO: Interfaz ECS para que el motor ejecute sistemas completos
export interface IUpdatable {
  id: string;
  preUpdate?(dtMs: number): void;
  physicsUpdate?(dtMs: number): void;
  update?(dtMs: number): void; // Fase Lógica
  animationUpdate?(dtMs: number): void;
  cameraUpdate?(dtMs: number): void;
  postUpdate?(dtMs: number): void;
}

@Injectable({ providedIn: 'root' })
export class LoopManagerService {
  private scene: Scene | null = null;
  private observer: Observer<Scene> | null = null;

  // Colecciones de funciones legadas (Para compatibilidad con Behaviors antiguos)
  private phases: Map<GamePhase, Map<string, LoopCallback>> = new Map();

  // 🔥 NUEVO: Registro central de Controladores y Sistemas
  private updatables = new Map<string, IUpdatable>();

  constructor() {
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
      const dtMs = this.scene!.getEngine().getDeltaTime();
      this.executeFrame(dtMs);
    });
  }

  public dispose(): void {
    if (this.observer && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
    }
    this.phases.forEach(map => map.clear());
    this.updatables.clear();
    this.observer = null;
    this.scene = null;
  }

  // 🔥 NUEVO: Registra un Controlador/Sistema en el motor
  public registerSystem(system: IUpdatable): void {
    this.updatables.set(system.id, system);
  }

  public unregisterSystem(id: string): void {
    this.updatables.delete(id);
  }

  // Mantiene compatibilidad con módulos que aún no sean IUpdatable
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
    const phaseMap = this.phases.get(phase);
    if (phaseMap) {
      phaseMap.forEach((callback, id) => {
        try {
          callback(dtMs);
        } catch (error) {
          console.error(`[LoopManager] Error ejecutando callback '${id}' en fase ${GamePhase[phase]}:`, error);
        }
      });
    }

    // 🔥 NUEVO: Ejecutar los Controladores registrados según la fase actual
    this.updatables.forEach((sys) => {
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
    });
  }
}