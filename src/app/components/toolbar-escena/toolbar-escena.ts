

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { EditorStateService, ToolMode } from '../../services/editor/editor-state.service';
import { EditorSceneService } from '../../services/editor/editor-scene.service';
import { EditorToolsService } from '../../services/editor/editor-tools.service';

@Component({
  selector: 'app-toolbar-escena',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar-escena.html', 
  styleUrls: ['./toolbar-escena.css'] 
})
export class ToolbarEscena {
  public stateSvc = inject(EditorStateService);
  private sceneSvc = inject(EditorSceneService); 
  private toolsSvc = inject(EditorToolsService);

  get currentTool() {
    return this.stateSvc.currentTool();
  }

  setTool(tool: ToolMode) {
    this.toolsSvc.setToolMode(tool);
  }

  abrirModalAnadir() {
    this.stateSvc.showAddObjectModal.set(true);
  }

  crearTriggerDirecto(isComposite: boolean) {
    const sufijo = isComposite ? 'Compuesto_' : 'Normal_';
    const nombre = 'Trigger_' + sufijo + Math.floor(Math.random() * 1000);
    this.sceneSvc.agregarTriggerCustom(nombre, 'cube', isComposite, '', 2, 2, 2, null, 'show_message');
  }

  crearTriggerTransicion() {
    const nombre = 'Frontera_Transicion_' + Math.floor(Math.random() * 1000);
    this.sceneSvc.agregarTriggerCustom(nombre, 'cube', false, '', 4, 4, 1, null, 'change_scene');
  }
}
