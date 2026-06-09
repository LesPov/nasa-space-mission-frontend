import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorMapaService, ToolMode } from '../../services/editor-mapa.service';

@Component({
  selector: 'app-toolbar-escena',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar-escena.html', 
  styleUrls: ['./toolbar-escena.css'] 
})
export class ToolbarEscena {
  public editorSvc = inject(EditorMapaService);

  get currentTool() {
    return this.editorSvc.currentTool();
  }

  setTool(tool: ToolMode) {
    this.editorSvc.setToolMode(tool);
  }

  abrirModalAnadir() {
    this.editorSvc.showAddObjectModal.set(true);
  }
}