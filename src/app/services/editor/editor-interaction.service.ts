// src/app/services/editor/editor-interaction.service.ts

import { Injectable, inject } from '@angular/core';
import { Node } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { PlayerInputService } from '../../core/engine/runtime/systems/player-input.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';

@Injectable({ providedIn: 'root' })
export class EditorInteractionService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private inputSvc = inject(PlayerInputService);
  private eventBus = inject(GameEventBusService);
  private inputOrchestrator = inject(InputOrchestratorService);

  abrirInteraccionJugador(nodo: Node): void {
    this.state.playState.set('INTERACTING');
    this.state.objetoInteractuado.set(nodo);
    this.state.objetoSeleccionado.set(nodo);
    this.state.objetoHovereado.set(null);
    this.state.ratonBloqueado.set(false);

    this.inputOrchestrator.unlockPointer();
    this.inputSvc.resetearInputs();
  }

  cerrarInteraccionJugador(): void {
    this.state.playState.set('PLAYING');
    this.state.objetoInteractuado.set(null);
    this.state.objetoSeleccionado.set(null);
    this.state.objetoHovereado.set(null);

    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });

    this.inputSvc.resetearInputs();
    this.inputOrchestrator.lockPointer();
  }
}