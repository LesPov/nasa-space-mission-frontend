import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorMapaService, ToolMode } from '../../services/editor-mapa.service';
import { EditorSceneService } from '../../services/editor/editor-scene.service'; // Importar esto

@Component({
  selector: 'app-toolbar-escena',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar-escena.html', 
  styleUrls: ['./toolbar-escena.css'] 
})
export class ToolbarEscena {
  public editorSvc = inject(EditorMapaService);
  private sceneSvc = inject(EditorSceneService); // Injectarlo

  get currentTool() {
    return this.editorSvc.currentTool();
  }

  setTool(tool: ToolMode) {
    this.editorSvc.setToolMode(tool);
  }

  abrirModalAnadir() {
    this.editorSvc.showAddObjectModal.set(true);
  }

  // Permite saltarse el modal y crear el trigger de inmediato en el mapa
  crearTriggerDirecto(isComposite: boolean) {
    const sufijo = isComposite ? 'Compuesto_' : 'Normal_';
    const nombre = 'Trigger_' + sufijo + Math.floor(Math.random() * 1000);
    this.sceneSvc.agregarTriggerCustom(nombre, 'cube', isComposite, '', 2, 2, 2);
  }
}