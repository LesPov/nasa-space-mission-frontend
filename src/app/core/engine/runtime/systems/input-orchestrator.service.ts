// src/app/core/engine/runtime/systems/input-orchestrator.service.ts

import { Injectable, inject } from '@angular/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { GameEventBusService } from '../../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class InputOrchestratorService {
  private motor3d = inject(Motor3dService);
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
    const canvas = this.motor3d.engine?.getRenderingCanvas();
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