
import { Component, Output, EventEmitter, inject, effect, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Node, AbstractMesh, Camera, Light, Mesh, TransformNode } from '@babylonjs/core';

import { EditorMapaService } from '../../../services/editor-mapa.service';

@Component({
  selector: 'app-inspector-outliner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspector-outliner.html',
  styleUrl: './inspector-outliner.css'
})
export class InspectorOutliner {
  public editorSvc = inject(EditorMapaService);
  private el = inject(ElementRef);
  private cdr = inject(ChangeDetectorRef);
  
  @Output() tabSelect = new EventEmitter<string>();

  public nodosExpandidos = new Set<string>();
  
  public searchTerm: string = '';

  private draggedNode: Node | null = null;
  private dropAction: 'above' | 'below' | 'inside' | null = null;

  constructor() {
    effect(() => {
      const seleccionado = this.editorSvc.objetoSeleccionado();
      const subSeleccionado = this.editorSvc.subObjetoSeleccionado(); 

      if (seleccionado) {
        let current = seleccionado.parent;
        let changed = false;

        if (!subSeleccionado && !this.draggedNode) {
           this.nodosExpandidos.clear();
        }
        
        while (current && current.name !== '__root__') {
          const id = (current as any).metadata?.uid || current.uniqueId.toString();
          if (!this.nodosExpandidos.has(id)) {
            this.nodosExpandidos.add(id);
            changed = true;
          }
          current = current.parent;
        }
        
        const myId = (seleccionado as any).metadata?.uid || seleccionado.uniqueId.toString();
        if (!this.nodosExpandidos.has(myId)) {
          this.nodosExpandidos.add(myId);
          changed = true;
        }

        if (changed) this.cdr.detectChanges();

        setTimeout(() => {
          const selectedEl = this.el.nativeElement.querySelector('.node-item.selected');
          if (selectedEl) selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      } else if (!this.searchTerm) {
        this.nodosExpandidos.clear();
        this.cdr.detectChanges();
      }
    });
  }

  get listaNodos() { 
    const todosLosNodos = this.editorSvc.nodosEscena();
    const nodosRaiz = todosLosNodos.filter(n => !n.parent || n.parent.name === '__root__');
    
    return nodosRaiz.sort((a, b) => {
      const orderA = (a as any).metadata?.orderIndex ?? 0;
      const orderB = (b as any).metadata?.orderIndex ?? 0;
      return orderA - orderB;
    });
  }

  obtenerHijos(nodo: Node): Node[] {
    if (!nodo || !nodo.getChildren) return [];
    
    const hijosValidos = nodo.getChildren().filter(child => {
        if (!(child instanceof Mesh) && !(child instanceof Light) && !(child instanceof TransformNode)) return false;
        const nName = child.name.toLowerCase();
        
        // 🔥 FIX OUTLINER: Ocultamos las mallas "decal_" para que no saturen el inspector
        if (nName.includes('proxycol') || nName.includes('debug') || nName.includes('gizmo') || nName.includes('camerapivot') || nName.startsWith('l_') || nName.startsWith('decal_')) return false;
        
        if (nodo.metadata?.type === 'model' || nodo.metadata?.type?.startsWith('light_')) {
           return !!child.metadata && child.metadata.type; 
        }
        return true;
    });

    return hijosValidos.sort((a, b) => {
      const orderA = (a as any).metadata?.orderIndex ?? 0;
      const orderB = (b as any).metadata?.orderIndex ?? 0;
      return orderA - orderB;
    });
  }

  onSearchChange() {
    if (this.searchTerm.trim() !== '') {
      this.listaNodos.forEach(n => this.expandirRecursivo(n));
    } else {
      this.nodosExpandidos.clear();
    }
  }

  expandirRecursivo(nodo: Node) {
    const id = (nodo as any).metadata?.uid || nodo.uniqueId.toString();
    this.nodosExpandidos.add(id);
    this.obtenerHijos(nodo).forEach(h => this.expandirRecursivo(h));
  }

  cumpleFiltro(nodo: Node): boolean {
    if (!this.searchTerm.trim()) return true;
    const term = this.searchTerm.toLowerCase();
    
    if (nodo.name.toLowerCase().includes(term)) return true;
    
    const hijos = this.obtenerHijos(nodo);
    return hijos.some(h => this.cumpleFiltro(h));
  }

  resaltarTexto(texto: string): string {
    if (!this.searchTerm) return texto;
    const safeTerm = this.searchTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${safeTerm})`, 'gi');
    return texto.replace(regex, `<span class="highlight-search">$1</span>`);
  }

  tieneHijos(nodo: Node): boolean { 
    return this.obtenerHijos(nodo).length > 0; 
  }
  
  esSeleccionado(nodo: Node): boolean { 
    return this.editorSvc.objetoSeleccionado() === nodo; 
  }
  
  esBloqueado(nodo: Node): boolean { 
    return nodo instanceof Camera || nodo instanceof Light && !nodo.metadata; 
  }

  tieneCapsula(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh) || !nodo.metadata) return false;
    const meta = nodo.metadata;
    if (meta.type === 'trigger' || meta.type === 'trigger_compuesto' || meta.type === 'bubble' || meta.type === 'video_plane' || meta.type === 'image_plane') return false;
    return !!meta.collider && meta.collider.type !== 'mesh';
  }

  tieneCamara(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh) || !nodo.metadata) return false;
    const meta = nodo.metadata;
    return meta.rol === 'npc' || meta.rol === 'spawn_point';
  }

  tieneAnimaciones(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh) || !nodo.metadata) return false;
    return !!(nodo.metadata.animationNames && nodo.metadata.animationNames.length > 0);
  }

  tieneSecuencias(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh) || !nodo.metadata) return false;
    const seqs = nodo.metadata.playerConfig?.sequences;
    return !!(seqs && seqs.length > 0);
  }

  tieneLuzInterna(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh) || !nodo.metadata) return false;
    return !!(nodo.metadata.type?.startsWith('light_'));
  }

  esTrigger(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh) || !nodo.metadata) return false;
    return nodo.metadata.type === 'trigger' || nodo.metadata.type === 'trigger_compuesto';
  }

  getTriggerConditions(nodo: Node): string[] {
    if (!this.esTrigger(nodo)) return [];
    const meta = (nodo as AbstractMesh).metadata;
    if (meta.isComposite) {
      return meta.conditions || [];
    } else {
      return meta.condition ? [meta.condition] : [];
    }
  }

  puedeExpandirse(nodo: Node): boolean {
    return this.tieneHijos(nodo) || 
           this.tieneCapsula(nodo) || 
           this.tieneCamara(nodo) || 
           this.tieneLuzInterna(nodo) || 
           this.tieneAnimaciones(nodo) || 
           this.tieneSecuencias(nodo) ||
           this.esTrigger(nodo);
  }
  
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
  
  seleccionarSubItem(pestana: string, subObj: 'collider' | 'camera' | 'light' | null, nodo: Node, event: Event) { 
    event.stopPropagation(); 
    if (this.esBloqueado(nodo)) return; 
    
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
    
    if (this.esSeleccionado(nodo)) {
      this.editorSvc.seleccionarObjeto(null);
      this.editorSvc.subObjetoSeleccionado.set(null);
    } else {
      this.editorSvc.seleccionarObjeto(nodo); 
    }
  }
  
  esSubSeleccionado(nodo: Node, subObj: 'collider' | 'camera' | 'light'): boolean { 
    return this.esSeleccionado(nodo) && this.editorSvc.subObjetoSeleccionado() === subObj; 
  }
  
  getIcono(nodo: Node): string {
    if (nodo instanceof Camera) return '🎥';
    if (nodo instanceof Light) return '💡';
    if (nodo instanceof AbstractMesh) {
      const meta = nodo.metadata;
      if (!meta) return '📌';
      
      if (meta.type?.startsWith('light_')) return '💡'; 
      if (meta.type === 'trigger' || meta.type === 'trigger_compuesto') return '📍';
      if (meta.type === 'bubble') return '🫧';
      if (meta.type === 'video_plane') return '📺';
      if (meta.type === 'image_plane') return '🖼️';
      
      if (meta.rol === 'spawn_point') return '🧍‍♂️';
      if (meta.rol === 'npc') return '🤖';
      
      if (meta.type === 'model') return '✨';
      
      if (meta.type === 'cube' || nodo.name.toLowerCase().includes('cubo')) return '🧊';
      if (meta.type === 'sphere' || nodo.name.toLowerCase().includes('esfera')) return '⚽';
      if (meta.type === 'cylinder') return '🛢️';
      if (meta.type === 'plane') return '🗺️';
      
      return '📐';
    }
    return '📌';
  }

  // ==========================================
  // 🔥 LÓGICA DE DRAG & DROP Y ORDENAMIENTO
  // ==========================================
  
  private isDescendant(target: Node, potentialParent: Node): boolean {
    let current = target.parent;
    while (current) {
      if (current === potentialParent) return true;
      current = current.parent;
    }
    return false;
  }

  private setParentSafe(child: Node, parent: Node | null) {
    if (typeof (child as any).setParent === 'function') {
      (child as any).setParent(parent);
    } else {
      child.parent = parent;
    }
  }

  onDragStart(event: DragEvent, nodo: Node) {
    if (this.esBloqueado(nodo)) {
      event.preventDefault();
      return;
    }
    this.draggedNode = nodo;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', nodo.uniqueId.toString());
      event.dataTransfer.effectAllowed = 'move';
    }
    setTimeout(() => (event.target as HTMLElement).classList.add('dragging'), 10);
  }

  onDragOver(event: DragEvent, targetNode: Node) {
    event.preventDefault();
    if (!this.draggedNode || this.draggedNode === targetNode || this.isDescendant(targetNode, this.draggedNode)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }

    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const targetEl = (event.target as HTMLElement).closest('.node-item');
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const y = event.clientY - rect.top;

    this.clearDragVisuals();

    if (y < rect.height * 0.25) {
      this.dropAction = 'above';
      targetEl.classList.add('drag-over-top');
    } else if (y > rect.height * 0.75) {
      this.dropAction = 'below';
      targetEl.classList.add('drag-over-bottom');
    } else {
      this.dropAction = 'inside';
      targetEl.classList.add('drag-over-inside');
      const id = (targetNode as any).metadata?.uid || targetNode.uniqueId.toString();
      this.nodosExpandidos.add(id);
    }
  }

  onDragLeave(event: DragEvent) {
    const targetEl = (event.target as HTMLElement).closest('.node-item');
    if (targetEl) {
      targetEl.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
    }
  }

  onDrop(event: DragEvent, targetNode: Node) {
    event.preventDefault();
    this.clearDragVisuals();

    if (!this.draggedNode || this.draggedNode === targetNode || this.isDescendant(targetNode, this.draggedNode)) {
      this.draggedNode = null;
      return;
    }

    if (!((this.draggedNode as any).metadata)) (this.draggedNode as any).metadata = {};

    if (this.dropAction === 'inside') {
      this.setParentSafe(this.draggedNode, targetNode);
      (this.draggedNode as any).metadata.parentId = (targetNode as any).metadata?.uid;
      
      const siblings = this.obtenerHijos(targetNode);
      (this.draggedNode as any).metadata.orderIndex = siblings.length;

    } else {
      const newParent = targetNode.parent;
      this.setParentSafe(this.draggedNode, newParent);
      (this.draggedNode as any).metadata.parentId = newParent ? (newParent as any).metadata?.uid : null;

      const siblings = newParent ? this.obtenerHijos(newParent) : this.editorSvc.nodosEscena().filter(n => !n.parent || n.parent.name === '__root__');
      const arraySinArrastrado = siblings.filter(n => n !== this.draggedNode);
      const indexDelTarget = arraySinArrastrado.indexOf(targetNode);

      if (this.dropAction === 'above') {
        arraySinArrastrado.splice(indexDelTarget, 0, this.draggedNode);
      } else {
        arraySinArrastrado.splice(indexDelTarget + 1, 0, this.draggedNode);
      }

      arraySinArrastrado.forEach((node, i) => {
        if (!((node as any).metadata)) (node as any).metadata = {};
        (node as any).metadata.orderIndex = i;
      });
    }

    this.editorSvc.triggerUpdate();
    this.cdr.detectChanges();
    this.draggedNode = null;
  }

  onDragEnd(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('dragging');
    this.clearDragVisuals();
    this.draggedNode = null;
  }

  onDragOverRoot(event: DragEvent) {
    event.preventDefault();
    if (this.draggedNode && this.draggedNode.parent) {
      (event.target as HTMLElement).closest('.tree-collection')?.classList.add('drag-over-root');
    }
  }

  onDragLeaveRoot(event: DragEvent) {
    (event.target as HTMLElement).closest('.tree-collection')?.classList.remove('drag-over-root');
  }

  onDropRoot(event: DragEvent) {
    event.preventDefault();
    (event.target as HTMLElement).closest('.tree-collection')?.classList.remove('drag-over-root');
    
    if (this.draggedNode && this.draggedNode.parent) {
      this.setParentSafe(this.draggedNode, null);
      
      if (!((this.draggedNode as any).metadata)) (this.draggedNode as any).metadata = {};
      (this.draggedNode as any).metadata.parentId = null;

      const roots = this.editorSvc.nodosEscena().filter(n => !n.parent || n.parent.name === '__root__');
      const arraySinArrastrado = roots.filter(n => n !== this.draggedNode);
      arraySinArrastrado.push(this.draggedNode);
      
      arraySinArrastrado.forEach((n, i) => { 
        if(!((n as any).metadata)) (n as any).metadata = {};
        (n as any).metadata.orderIndex = i; 
      });

      this.editorSvc.triggerUpdate();
      this.cdr.detectChanges();
    }
    this.draggedNode = null;
  }

  private clearDragVisuals() {
    const items = this.el.nativeElement.querySelectorAll('.node-item');
    items.forEach((i: HTMLElement) => i.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside'));
  }
}