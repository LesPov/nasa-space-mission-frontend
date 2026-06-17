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

@Injectable({ providedIn: 'root' })
export class LoopManagerService {
  private scene: Scene | null = null;
  private observer: Observer<Scene> | null = null;

  // Colecciones separadas por fase para garantizar el orden de ejecución
  private phases: Map<GamePhase, Map<string, LoopCallback>> = new Map();

  constructor() {
    // Inicializar mapas para cada fase
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
    
    // ANCLAJE ÚNICO AL MOTOR DE BABYLON
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
    this.observer = null;
    this.scene = null;
  }

  /**
   * Registra una función para que se ejecute cada frame en una fase específica.
   */
  public register(id: string, phase: GamePhase, callback: LoopCallback): void {
    const phaseMap = this.phases.get(phase);
    if (phaseMap) {
      phaseMap.set(id, callback);
    }
  }

  /**
   * Elimina una función registrada del loop.
   */
  public unregister(id: string): void {
    this.phases.forEach(map => {
      if (map.has(id)) {
        map.delete(id);
      }
    });
  }

  private executeFrame(dtMs: number): void {
    // Garantizamos el orden estricto de ejecución
    this.executePhase(GamePhase.PRE_UPDATE, dtMs);
    this.executePhase(GamePhase.PHYSICS, dtMs);
    this.executePhase(GamePhase.LOGIC, dtMs);
    this.executePhase(GamePhase.ANIMATION, dtMs);
    this.executePhase(GamePhase.CAMERA, dtMs);
    this.executePhase(GamePhase.POST_UPDATE, dtMs);
  }

  private executePhase(phase: GamePhase, dtMs: number): void {
    const phaseMap = this.phases.get(phase);
    if (!phaseMap) return;

    // Usamos forEach para iterar de manera segura
    phaseMap.forEach((callback, id) => {
      try {
        callback(dtMs);
      } catch (error) {
        console.error(`[LoopManager] Error ejecutando callback '${id}' en fase ${GamePhase[phase]}:`, error);
      }
    });
  }
}