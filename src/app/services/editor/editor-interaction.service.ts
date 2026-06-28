

import { Injectable, inject } from '@angular/core';
import { Node } from '@babylonjs/core';
import { EditorStateService } from './editor-state.service';
import { PlayerInputService } from '../../core/engine/runtime/systems/player-input.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';

@Injectable({ providedIn: 'root' })
export class EditorInteractionService {
  private state = inject(EditorStateService);
  private transitionSvc = inject(EditorModeTransitionService);
  private inputSvc = inject(PlayerInputService);
  private eventBus = inject(GameEventBusService);
  private inputOrchestrator = inject(InputOrchestratorService);

  abrirInteraccionJugador(nodo: Node): void {
    // 🔥 FIX: Uso del sistema de transiciones en vez de escritura directa
    this.transitionSvc.enterInteraction();
    
    this.state.objetoInteractuado.set(nodo);
    this.state.objetoSeleccionado.set(nodo);
    this.state.objetoHovereado.set(null);
    this.state.ratonBloqueado.set(false);

    this.inputOrchestrator.unlockPointer();
    this.inputSvc.resetearInputs();
  }

  cerrarInteraccionJugador(): void {
    // 🔥 FIX: Uso del sistema de transiciones en vez de escritura directa
    this.transitionSvc.exitInteraction();
    
    this.state.objetoInteractuado.set(null);
    this.state.objetoSeleccionado.set(null);
    this.state.objetoHovereado.set(null);

    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });

    this.inputSvc.resetearInputs();
    this.inputOrchestrator.lockPointer();
  }
}
