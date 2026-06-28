
import { Injectable, inject } from '@angular/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { GameEventBusService } from '../../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class InputOrchestratorService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private isListening = false;

  constructor() {
    this.initializeListeners();
  }

  public initializeListeners(): void {
    if (this.isListening) return;
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    this.isListening = true;
  }

  public disposeListeners(): void {
    if (!this.isListening) return;
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.isListening = false;
  }

  public lockPointer(): void {
    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
    if (canvas && document.pointerLockElement !== canvas) {
      try { 
        canvas.focus();
        canvas.requestPointerLock(); 
      } catch (e) { 
        console.warn('[InputOrchestrator] Fallo al bloquear el ratón:', e); 
      }
    }
  }

  public unlockPointer(): void {
    if (document.pointerLockElement) {
      try { 
        document.exitPointerLock(); 
      } catch (e) { 
        console.warn('[InputOrchestrator] Fallo al liberar el ratón:', e); 
      }
    }
  }

  private handlePointerLockChange = () => {
    const isLocked = !!document.pointerLockElement;
    if (isLocked) {
      this.eventBus.emit({ type: 'GameResumed' });
    } else {
      this.eventBus.emit({ type: 'GamePaused' });
    }
  };
}