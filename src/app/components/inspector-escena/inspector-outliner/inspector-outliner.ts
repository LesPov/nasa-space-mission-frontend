
import { Component, Output, EventEmitter, inject, effect, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Node, AbstractMesh, Camera, Light, Mesh, TransformNode, Tags } from '@babylonjs/core';

import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { EditorCameraService } from '../../../services/editor/editor-camera.service';

@Component({
  selector: 'app-inspector-outliner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspector-outliner.html',
  styleUrl: './inspector-outliner.css'
})
export class InspectorOutliner {
  public editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private cameraSvc = inject(EditorCameraService);
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
          const entityCurrent = this.entityManager.getEntityByMesh(current as AbstractMesh);
          const id = entityCurrent ? entityCurrent.uid : current.uniqueId.toString();
          if (!this.nodosExpandidos.has(id)) {
            this.nodosExpandidos.add(id);
            changed = true;
          }
          current = current.parent;
        }
        
        const entitySel = this.entityManager.getEntityByMesh(seleccionado as AbstractMesh);
        const myId = entitySel ? entitySel.uid : seleccionado.uniqueId.toString();
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

  get plataformas() {
    return this.editorSvc.plataformasEscena();
  }

  get plataformaActivaId() {
    return this.editorSvc.escenaIdActiva();
  }

  cambiarPlataforma(id: number) {
    if (this.plataformaActivaId !== id) {
      this.editorSvc.onRequestPlatformChange.next(id);
    }
  }

  // 🔥 NUEVO: Filtro estricto para evitar que objetos huérfanos/sistema/babylon-native salgan en el Outliner
  esNodoValidoParaOutliner(child: Node, parentNodo: Node | null = null): boolean {
    if (Tags.MatchesQuery(child, "system_element || fog_element || debug_element || proxy_collider || decal || editor_only || invisible_floor")) return false;
    
    const name = child.name.toLowerCase();
    if (name.includes('backgroundhelper') || name.includes('skybox') || name.includes('environment')) return false;

    const childEntity = child instanceof AbstractMesh ? this.entityManager.getEntityByMesh(child) : null;

    // Si es una malla o nodo pero no tiene GameEntity asignado, NO mostrarlo (filtra sub-partes del glb, huesos o guías)
    if ((child instanceof Mesh || child instanceof TransformNode) && !childEntity) {
        return false;
    }

    // Si el padre es una entidad válida (ej: un GLB importado), solo permitimos hijos que también sean entidades configuradas
    if (parentNodo) {
        const parentEntity = parentNodo instanceof AbstractMesh ? this.entityManager.getEntityByMesh(parentNodo) : null;
        if (parentEntity && !childEntity) {
            return false;
        }
    }

    return true;
  }

  get listaNodos() { 
    const todosLosNodos = this.editorSvc.nodosEscena();
    
    const nodosRaiz = todosLosNodos.filter(n => {
      if (n.parent && n.parent.name !== '__root__') return false;
      return this.esNodoValidoParaOutliner(n, null);
    });
    
    return nodosRaiz.sort((a, b) => {
      const eA = this.entityManager.getEntityByMesh(a as AbstractMesh);
      const eB = this.entityManager.getEntityByMesh(b as AbstractMesh);
      const orderA = eA ? eA.orderIndex : 0;
      const orderB = eB ? eB.orderIndex : 0;
      return orderA - orderB;
    });
  }

  obtenerHijos(nodo: Node): Node[] {
    if (!nodo || !nodo.getChildren) return [];
    
    const hijosValidos = nodo.getChildren().filter(child => {
        if (!(child instanceof Mesh) && !(child instanceof Light) && !(child instanceof TransformNode)) return false;
        return this.esNodoValidoParaOutliner(child, nodo);
    });

    return hijosValidos.sort((a, b) => {
      const eA = this.entityManager.getEntityByMesh(a as AbstractMesh);
      const eB = this.entityManager.getEntityByMesh(b as AbstractMesh);
      const orderA = eA ? eA.orderIndex : 0;
      const orderB = eB ? eB.orderIndex : 0;
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
    const entity = this.entityManager.getEntityByMesh(nodo as AbstractMesh);
    const id = entity ? entity.uid : nodo.uniqueId.toString();
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
    const entity = this.entityManager.getEntityByMesh(nodo as AbstractMesh);
    return nodo instanceof Camera || nodo instanceof Light && !entity; 
  }

  tieneCapsula(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    if (entity.type === 'trigger' || entity.type === 'trigger_compuesto' || entity.type === 'bubble' || entity.type === 'video_plane' || entity.type === 'image_plane') return false;
    return !!entity.collider && entity.collider.type !== 'mesh';
  }

  tieneCamara(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    return !!entity.characterConfig;
  }

  tieneAnimaciones(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    return !!(entity.animationNames && entity.animationNames.length > 0);
  }

  tieneSecuencias(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    const seqs = entity.playerConfig?.sequences;
    return !!(seqs && seqs.length > 0);
  }

  tieneLuzInterna(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    return !!(entity.type?.startsWith('light_'));
  }

  tieneNiebla(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    return !!entity.playerConfig?.fog?.enabled;
  }

  esTrigger(nodo: Node): boolean {
    if (!(nodo instanceof AbstractMesh)) return false;
    const entity = this.entityManager.getEntityByMesh(nodo);
    if (!entity) return false;
    return entity.type === 'trigger' || entity.type === 'trigger_compuesto';
  }

  getTriggerConditions(nodo: Node): string[] {
    if (!this.esTrigger(nodo)) return [];
    const entity = this.entityManager.getEntityByMesh(nodo as AbstractMesh);
    if (!entity || !entity.trigger) return [];
    
    if (entity.trigger.isComposite) {
      return entity.trigger.conditions || [];
    } else {
      return entity.trigger.condition ? [entity.trigger.condition] : [];
    }
  }

  puedeExpandirse(nodo: Node): boolean {
    return this.tieneHijos(nodo) || 
           this.tieneCapsula(nodo) || 
           this.tieneCamara(nodo) || 
           this.tieneLuzInterna(nodo) || 
           this.tieneNiebla(nodo) ||
           this.tieneAnimaciones(nodo) || 
           this.tieneSecuencias(nodo) ||
           this.esTrigger(nodo);
  }
  
  toggleExpandir(nodo: Node, event: Event) { 
    event.stopPropagation(); 
    const entity = this.entityManager.getEntityByMesh(nodo as AbstractMesh);
    const id = entity ? entity.uid : nodo.uniqueId.toString();
    if (this.nodosExpandidos.has(id)) this.nodosExpandidos.delete(id); 
    else this.nodosExpandidos.add(id); 
  }
  
  estaExpandido(nodo: Node): boolean { 
    const entity = this.entityManager.getEntityByMesh(nodo as AbstractMesh);
    const id = entity ? entity.uid : nodo.uniqueId.toString();
    return this.nodosExpandidos.has(id); 
  }
  
  seleccionarSubItem(pestana: string, subObj: 'collider' | 'camera' | 'light' | 'fog' | null, nodo: Node, event: Event) { 
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
      this.cameraSvc.enfocarObjetoEnEditor(nodo); 
    }
  }
  
  esSubSeleccionado(nodo: Node, subObj: 'collider' | 'camera' | 'light' | 'fog'): boolean { 
    return this.esSeleccionado(nodo) && this.editorSvc.subObjetoSeleccionado() === subObj; 
  }
  
  getIcono(nodo: Node): string {
    if (nodo instanceof Camera) return '🎥';
    if (nodo instanceof Light) return '💡';
    if (nodo instanceof AbstractMesh) {
      const entity = this.entityManager.getEntityByMesh(nodo);
      if (!entity) return '📌';
      
      if (entity.rol === 'player') return '🏃'; // 🔥 Jugador Principal
      if (entity.rol === 'spawn_point') return '📍'; // 🔥 Spawn Point visual
      
      if (entity.type?.startsWith('light_')) return '💡'; 
      if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') return '📍';
      if (entity.type === 'bubble') return '🫧';
      if (entity.type === 'video_plane') return '📺';
      if (entity.type === 'image_plane') return '🖼️';
      
      if (entity.characterConfig) {
        if (entity.characterConfig.characterType === 'politico') return '👔';
        if (entity.characterConfig.characterType === 'militar') return '🪖';
        return '🤖';
      }
      
      if (entity.type === 'model') return '✨';
      
      if (entity.type === 'cube' || nodo.name.toLowerCase().includes('cubo')) return '🧊';
      if (entity.type === 'sphere' || nodo.name.toLowerCase().includes('esfera')) return '⚽';
      if (entity.type === 'cylinder') return '🛢️';
      if (entity.type === 'plane') return '🗺️';
      
      return '📐';
    }
    return '📌';
  }

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
      
      const entity = this.entityManager.getEntityByMesh(targetNode as AbstractMesh);
      const id = entity ? entity.uid : targetNode.uniqueId.toString();
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

    const draggedEntity = this.entityManager.getEntityByMesh(this.draggedNode as AbstractMesh);
    const targetEntity = this.entityManager.getEntityByMesh(targetNode as AbstractMesh);

    if (this.dropAction === 'inside') {
      this.setParentSafe(this.draggedNode, targetNode);
      if (draggedEntity) {
          draggedEntity.parentId = targetEntity ? targetEntity.uid : null;
          
          // 🔥 FIX: Actualizar transformada local TRAS el setParent nativo de Babylon para no dañar posiciones
          draggedEntity.syncTransformFromView();
          
          const siblings = this.obtenerHijos(targetNode);
          draggedEntity.orderIndex = siblings.length;
          draggedEntity.isDirty = true;
      }
    } else {
      const newParent = targetNode.parent;
      this.setParentSafe(this.draggedNode, newParent);
      const newParentEntity = newParent ? this.entityManager.getEntityByMesh(newParent as AbstractMesh) : null;
      
      if (draggedEntity) {
          draggedEntity.parentId = newParentEntity ? newParentEntity.uid : null;
          
          // 🔥 FIX: Actualizar transformada local TRAS el setParent
          draggedEntity.syncTransformFromView();
      }

      const siblings = newParent ? this.obtenerHijos(newParent) : this.editorSvc.nodosEscena().filter(n => !n.parent || n.parent.name === '__root__');
      const arraySinArrastrado = siblings.filter(n => n !== this.draggedNode);
      const indexDelTarget = arraySinArrastrado.indexOf(targetNode);

      if (this.dropAction === 'above') {
        arraySinArrastrado.splice(indexDelTarget, 0, this.draggedNode);
      } else {
        arraySinArrastrado.splice(indexDelTarget + 1, 0, this.draggedNode);
      }

      arraySinArrastrado.forEach((node, i) => {
        const ent = this.entityManager.getEntityByMesh(node as AbstractMesh);
        if (ent) {
            ent.orderIndex = i;
            ent.isDirty = true;
        }
      });
      if (draggedEntity) draggedEntity.isDirty = true;
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
      
      const draggedEntity = this.entityManager.getEntityByMesh(this.draggedNode as AbstractMesh);
      if (draggedEntity) {
          draggedEntity.parentId = null;
          
          // 🔥 FIX: Actualizar transformada local al mandarlo a root
          draggedEntity.syncTransformFromView();
      }

      const roots = this.editorSvc.nodosEscena().filter(n => !n.parent || n.parent.name === '__root__');
      const arraySinArrastrado = roots.filter(n => n !== this.draggedNode);
      arraySinArrastrado.push(this.draggedNode);
      
      arraySinArrastrado.forEach((n, i) => { 
        const ent = this.entityManager.getEntityByMesh(n as AbstractMesh);
        if (ent) {
            ent.orderIndex = i;
            ent.isDirty = true;
        }
      });

      this.editorSvc.triggerUpdate();
      this.cdr.detectChanges();
    }
    this.draggedNode = null;
  }

  private clearDragVisuals() {
    const items = this.el.nativeElement.querySelectorAll('.node-item');
    items.forEach((i: HTMLElement) => i.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside'));
  }}