
import { Injectable, inject } from '@angular/core';
import { Node } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { PlayerInputService } from './playerservice/player-input.service';

@Injectable({ providedIn: 'root' })
export class EditorInteractionService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private inputSvc = inject(PlayerInputService);

  abrirInteraccionJugador(nodo: Node): void {
    this.state.playState.set('INTERACTING');
    this.state.objetoInteractuado.set(nodo);
    this.state.objetoSeleccionado.set(nodo);
    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.ratonBloqueado.set(false);

    document.exitPointerLock();
    this.inputSvc.resetearInputs();
  }

  cerrarInteraccionJugador(): void {
    this.state.playState.set('PLAYING');
    this.state.objetoInteractuado.set(null);
    this.state.objetoSeleccionado.set(null);
    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);

    this.inputSvc.resetearInputs();

    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      canvas.focus();
      try {
        canvas.requestPointerLock();
      } catch (e) {
        console.error("No se pudo obtener el bloqueo del puntero", e);
      }
    }
  }
}