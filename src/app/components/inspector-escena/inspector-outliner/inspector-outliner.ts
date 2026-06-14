import { Component, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Node, AbstractMesh, Camera, Light, Mesh } from '@babylonjs/core';

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

  obtenerHijos(nodo: Node): Node[] {
    if (!nodo || !nodo.getChildren) return [];
    
    return nodo.getChildren().filter(child => {
        if (!(child instanceof Mesh) && !(child instanceof Light)) return false;
        if (child.name.includes('proxyCol') || child.name.includes('debug') || child.name.includes('gizmo')) return false;
        
        if (nodo.metadata?.type === 'model') {
           return !!child.metadata && child.metadata.type; 
        }
        
        return true;
    });
  }

  tieneHijos(nodo: Node): boolean {
    return this.obtenerHijos(nodo).length > 0;
  }

  esSeleccionado(nodo: Node): boolean { return this.editorSvc.objetoSeleccionado() === nodo; }
  esBloqueado(nodo: Node): boolean { return nodo instanceof Camera || nodo instanceof Light && !nodo.metadata; }
  
  toggleExpandir(nodo: Node, event: Event) { 
    event.stopPropagation(); 
    const id = (nodo as any).metadata?.uid || nodo.uniqueId.toString();
    if (this.nodosExpandidos.has(id)) this.nodosExpandidos.delete(id); 
    else this.nodosExpandidos.add(id); 
  }
  
  estaExpandido(nodo: Node): boolean { 
    const id = (nodo as any).metadata?.uid || nodo.uniqueId.toString();
    return this.nodosExpandidos.has(id); 
  }
  
  seleccionarSubItem(pestana: string, subObj: 'collider' | 'camera' | null, nodo: Node, event: Event) { 
    event.stopPropagation(); 
    if (this.esBloqueado(nodo)) return; 
    
    // 🔥 LÓGICA DE DESELECCIÓN PARA SUB-ITEMS
    if (this.esSubSeleccionado(nodo, subObj as any)) {
      this.editorSvc.subObjetoSeleccionado.set(null); 
    } else {
      this.editorSvc.seleccionarObjeto(nodo); 
      this.editorSvc.subObjetoSeleccionado.set(subObj); 
      this.tabSelect.emit(pestana); 
    }
  }
  
  seleccionarDesdeLista(nodo: Node) { 
    if (this.esBloqueado(nodo)) return; 
    
    // 🔥 LÓGICA DE DESELECCIÓN: Si el objeto clickeado ya está seleccionado, lo deselecciona.
    if (this.esSeleccionado(nodo)) {
      this.editorSvc.seleccionarObjeto(null);
      this.editorSvc.subObjetoSeleccionado.set(null);
    } else {
      this.editorSvc.seleccionarObjeto(nodo); 
    }
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
      if (nodo.metadata?.type?.startsWith('light_')) return '💡'; 
      if (nodo.metadata?.type === 'trigger') return '📍';
      if (nodo.metadata?.type === 'model') return '🧍';
      if (nodo.name.toLowerCase().includes('cubo')) return '🧊';
      if (nodo.name.toLowerCase().includes('esfera')) return '⚽';
      return '📐';
    }
    return '📌';
  }
}