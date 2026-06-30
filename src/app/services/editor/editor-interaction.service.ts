
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
    this.transitionSvc.enterInteraction();
    
    this.state.setObjetoInteractuado(nodo);
    this.state.seleccionarObjeto(nodo);
    this.state.setObjetoHovereado(null);

    this.inputOrchestrator.unlockPointer();
    this.inputSvc.resetearInputs();
  }

  cerrarInteraccionJugador(): void {
    this.transitionSvc.exitInteraction();
    
    this.state.setObjetoInteractuado(null);
    this.state.seleccionarObjeto(null);
    this.state.setObjetoHovereado(null);

    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });

    this.inputSvc.resetearInputs();
    this.inputOrchestrator.lockPointer();
  }
}