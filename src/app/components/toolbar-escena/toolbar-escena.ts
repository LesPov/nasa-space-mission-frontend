
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorMapaService, ToolMode } from '../../services/editor-mapa.service';
import { EditorSceneService } from '../../services/editor/editor-scene.service';

@Component({
  selector: 'app-toolbar-escena',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar-escena.html', 
  styleUrls: ['./toolbar-escena.css'] 
})
export class ToolbarEscena {
  public editorSvc = inject(EditorMapaService);
  private sceneSvc = inject(EditorSceneService); 

  get currentTool() {
    return this.editorSvc.currentTool();
  }

  setTool(tool: ToolMode) {
    this.editorSvc.setToolMode(tool);
  }

  abrirModalAnadir() {
    this.editorSvc.showAddObjectModal.set(true);
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
