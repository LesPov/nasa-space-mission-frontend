import { Component, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Node, AbstractMesh, Camera, Light } from '@babylonjs/core';

import { EditorMapaService } from '../../../services/editor-mapa.service';

@Component({
  selector: 'app-inspector-outliner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inspector-outliner.html',
  styleUrl: './inspector-outliner.css'
})
export class InspectorOutliner {
  public editorSvc = inject(EditorMapaService);
  
  @Output() tabSelect = new EventEmitter<string>();

  public nodosExpandidos = new Set<string>();

  get listaNodos() { return this.editorSvc.nodosEscena(); }

  esSeleccionado(nodo: Node): boolean { return this.editorSvc.objetoSeleccionado() === nodo; }
  esBloqueado(nodo: Node): boolean { return nodo instanceof Camera || nodo instanceof Light; }
  
  toggleExpandir(nodo: Node, event: Event) { 
    event.stopPropagation(); 
    if (this.nodosExpandidos.has(nodo.name)) this.nodosExpandidos.delete(nodo.name); 
    else this.nodosExpandidos.add(nodo.name); 
  }
  
  estaExpandido(nodo: Node): boolean { return this.nodosExpandidos.has(nodo.name); }
  
  seleccionarSubItem(pestana: string, subObj: 'collider' | 'camera' | null, nodo: Node, event: Event) { 
    event.stopPropagation(); 
    if (this.esBloqueado(nodo)) return; 
    this.editorSvc.seleccionarObjeto(nodo); 
    this.editorSvc.subObjetoSeleccionado.set(subObj); 
    this.tabSelect.emit(pestana); 
  }
  
  seleccionarDesdeLista(nodo: Node) { 
    if (this.esBloqueado(nodo)) return; 
    this.editorSvc.seleccionarObjeto(nodo); 
  }
  
  esSubSeleccionado(nodo: Node, subObj: 'collider' | 'camera'): boolean { 
    return this.esSeleccionado(nodo) && this.editorSvc.subObjetoSeleccionado() === subObj; 
  }

  esPersonajeOModelo(nodo: Node): boolean { 
    if (!nodo || !(nodo as AbstractMesh).metadata) return false; 
    const meta = (nodo as AbstractMesh).metadata; 
    return meta.type === 'model' || meta.rol === 'npc' || meta.rol === 'spawn_point'; 
  }
  
  tieneAnimaciones(nodo: Node): boolean { 
    return nodo instanceof AbstractMesh && !!(nodo.metadata?.animationNames && nodo.metadata.animationNames.length > 0); 
  }
  
  tieneCapsula(nodo: Node): boolean { return nodo instanceof AbstractMesh && !!nodo.metadata?.collider; }
  tieneCamara(nodo: Node): boolean { return this.esPersonajeOModelo(nodo); }
  
  getIcono(nodo: Node): string {
    if (nodo instanceof Camera) return '🎥';
    if (nodo instanceof Light) return '💡';
    if (nodo instanceof AbstractMesh) {
      if (nodo.metadata?.type === 'trigger') return '📍';
      if (nodo.metadata?.type === 'model') return '🧍';
      if (nodo.name.toLowerCase().includes('cubo')) return '🧊';
      if (nodo.name.toLowerCase().includes('esfera')) return '⚽';
      return '📐';
    }
    return '📌';
  }
}