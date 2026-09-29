import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Node, AbstractMesh, Tags, Mesh, Camera, Light } from '@babylonjs/core';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { OutlinerStateService } from '../outliner-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { PartOverridesComponent } from '../../../../core/engine/entities/game.entity';

@Component({
  selector: 'app-scene-outliner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scene-outliner.html',
  styleUrls: ['./scene-outliner.css']
})
export class SceneOutlinerComponent implements OnInit, OnDestroy {
  @Input() nodes: Node[] = [];
  @Input() depth: number = 0;

  public stateSvc = inject(EditorStateService);
  public mapaSvc = inject(EditorMapaService);
  public outlinerState = inject(OutlinerStateService);
  public entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  public editingNodeId: string | null = null;
  public editingName: string = '';

  ngOnInit() {
    if (this.depth === 0) {
      this.mapaSvc.onMapChanged.subscribe(() => {
        this.cdr.detectChanges();
      });
    }
  }

  ngOnDestroy() {}

  // ========================================================
  // FILTROS Y BÚSQUEDA
  // ========================================================
  
  get searchTerm(): string {
    return this.outlinerState.searchTerm().toLowerCase().trim();
  }

  get filteredNodes(): Node[] {
    let list = this.depth === 0 ? this.stateSvc.nodosEscena() : this.nodes;
    
    if (this.depth > 0) {
       list = list.filter(n => {
           if (n.name.includes('proxycol')) return false;
           if (n.name.startsWith('decal_')) return false;
           if (Tags.MatchesQuery(n, "system_element || editor_only || fog_element || debug_element || proxy_collider")) return false;
           return true;
       });
    }

    const term = this.searchTerm;
    if (term) {
      return list.filter(n => this.nodeOrChildMatches(n, term));
    }
    return list;
  }

  private nodeOrChildMatches(node: Node, term: string): boolean {
    if (this.getDisplayName(node).toLowerCase().includes(term) || node.name.toLowerCase().includes(term)) {
        return true;
    }
    const children = this.getUsefulChildren(node);
    return children.some(c => this.nodeOrChildMatches(c, term));
  }

  public matchesSearch(node: Node): boolean {
    const term = this.searchTerm;
    if (!term) return false;
    const children = this.getUsefulChildren(node);
    return children.some(c => this.nodeOrChildMatches(c, term));
  }

  // ========================================================
  // REPRESENTACIÓN DERIVADA
  // ========================================================

  getUsefulChildren(node: Node): Node[] {
    const result: Node[] = [];
    const children = node.getChildren();
    
    for (const child of children) {
      if (Tags.MatchesQuery(child, "system_element || editor_only || fog_element || debug_element || proxy_collider")) continue;
      if (child.name.includes('proxycol') || child.name.startsWith('decal_')) continue;

      if (this.isTechnicalWrapper(child)) {
        result.push(...this.getUsefulChildren(child));
      } else {
        result.push(child);
      }
    }
    return result;
  }

  isTechnicalWrapper(node: Node): boolean {
    if (node instanceof AbstractMesh) {
      const entity = this.entityManager.getEntityByMesh(node);
      if (entity && entity.view === node) return false;

      const rootMesh = this.stateSvc.encontrarRaiz(node);
      if (rootMesh) {
        const rootEnt = this.entityManager.getEntityByMesh(rootMesh as AbstractMesh);
        if (rootEnt?.partOverrides?.overrides[node.name]) return false;
      }
    }

    if (node instanceof Mesh && node.getTotalVertices() > 0) return false;
    if (node.getClassName() === "InstancedMesh") {
         const source = (node as any).sourceMesh;
         if (source && source.getTotalVertices() > 0) return false;
    }

    if (node.getClassName().includes("Light") || node.getClassName().includes("Camera")) return false;
    return true;
  }

  getDisplayName(node: Node): string {
    if (!(node instanceof AbstractMesh)) return node.name;
    const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh) as AbstractMesh;
    if (!rootMesh) return node.name;
    
    const entity = this.entityManager.getEntityByMesh(rootMesh);
    
    if (node === rootMesh && entity) {
        return entity.name;
    }

    if (!entity || !entity.partOverrides) return node.name;

    const override = entity.partOverrides.overrides[node.name];
    return override?.displayName || node.name;
  }

  getIcon(node: Node): string {
    if (node instanceof Camera) return '🎥';
    if (node instanceof AbstractMesh) {
        const rootMesh = this.stateSvc.encontrarRaiz(node);
        if (rootMesh !== node) return '🧩'; // Es una parte

        const entity = this.entityManager.getEntityByMesh(node);
        if (entity) {
            if (entity.rol === 'player') return '🎮';
            if (entity.rol === 'spawn_point') return '📍';
            if (entity.type === 'trigger') return '⚡';
            if (entity.type === 'trigger_compuesto') return '💠';
            if (entity.type === 'bubble') return '🫧';
            if (entity.type === 'video_plane') return '📺';
            if (entity.type === 'image_plane') return '🖼️';
            if (entity.type.startsWith('light_')) return '💡';
            if (entity.characterConfig) {
                if (entity.characterConfig.characterType === 'politico') return '👔';
                if (entity.characterConfig.characterType === 'militar') return '🪖';
                return '🤖';
            }
            if (entity.visual?.assetId) return '📦';
            if (entity.type === 'cube') return '🧊';
            if (entity.type === 'sphere') return '⚽';
            if (entity.type === 'cylinder') return '🛢️';
            if (entity.type === 'plane') return '🗺️';
            return '📦'; 
        }
    }
    return '📌';
  }

  trackById(index: number, node: Node): string {
    return node.uniqueId.toString();
  }

  toggleExpand(node: Node, event: Event) {
    event.stopPropagation();
    this.outlinerState.toggleExpand(node.uniqueId.toString());
  }

  isExpanded(node: Node): boolean {
    return this.outlinerState.isExpanded(node.uniqueId.toString());
  }

  // ========================================================
  // SELECCIÓN Y ESTADOS (VISIBILIDAD / BLOQUEO)
  // ========================================================

  selectNode(node: Node, event: Event) {
    event.stopPropagation();
    if (this.editingNodeId) return; 

    if (!(node instanceof AbstractMesh)) return;

    const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh);
    
    if (rootMesh === node) {
       this.stateSvc.seleccionarObjeto(node);
       this.stateSvc.setSubObjetoSeleccionado(null);
    } else {
       this.stateSvc.seleccionarObjeto(node); 
    }
  }

  isSelected(node: Node): boolean {
    return this.stateSvc.objetoSeleccionado() === node;
  }

  isNodeVisible(node: Node): boolean {
    if (node instanceof AbstractMesh) {
      return node.isVisible && node.isEnabled();
    }
    return true;
  }

  toggleVisibility(node: Node, event: Event) {
    event.stopPropagation();
    if (node instanceof AbstractMesh) {
      const isVis = node.isVisible && node.isEnabled();
      node.setEnabled(!isVis);
      node.isVisible = !isVis;
    }
  }

  isNodeLocked(node: Node): boolean {
    if (node instanceof Camera) return true;
    if (node instanceof AbstractMesh) {
      const rootMesh = this.stateSvc.encontrarRaiz(node);
      const baseNode: AbstractMesh = rootMesh instanceof AbstractMesh ? rootMesh : node;
      const entity = this.entityManager.getEntityByMesh(baseNode);
      if (entity && entity.visual) {
        return !entity.visual.isSelectable;
      }
    }
    return false;
  }

  toggleLock(node: Node, event: Event) {
    event.stopPropagation();
    if (node instanceof Camera) return; 
    if (node instanceof AbstractMesh) {
      const rootMesh = this.stateSvc.encontrarRaiz(node);
      const baseNode: AbstractMesh = rootMesh instanceof AbstractMesh ? rootMesh : node;
      const entity = this.entityManager.getEntityByMesh(baseNode);
      if (entity && entity.visual) {
        entity.visual.isSelectable = !entity.visual.isSelectable;
        baseNode.isPickable = entity.visual.isSelectable;
        baseNode.getChildMeshes().forEach(m => m.isPickable = entity.visual.isSelectable);
        entity.isDirty = true;
        this.mapaSvc.onMapChanged.next();
      }
    }
  }

  // ========================================================
  // DRAG & DROP
  // ========================================================

  isDraggable(node: Node): boolean {
    if (node instanceof Camera) return false;
    if (node instanceof AbstractMesh) {
      const rootMesh = this.stateSvc.encontrarRaiz(node);
      if (rootMesh === node) return true; // Objetos Raíz sí se mueven
    }
    return false; // Partes bloqueadas en su modelo
  }

  onDragStart(node: Node, event: DragEvent) {
    if (!this.isDraggable(node)) {
      event.preventDefault();
      return;
    }
    this.outlinerState.draggedNode.set(node);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', node.uniqueId.toString());
      event.dataTransfer.effectAllowed = 'move';
    }
    setTimeout(() => (event.target as HTMLElement).classList.add('dragging'), 10);
  }

  onDragOver(node: Node, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    
    const dragged = this.outlinerState.draggedNode();
    if (!dragged || dragged === node || this.isDescendant(node, dragged)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }

    if (!this.isDraggable(node)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }

    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const targetEl = (event.target as HTMLElement).closest('.outliner-item');
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const y = event.clientY - rect.top;

    this.clearDragVisuals();

    if (y < rect.height * 0.25) {
      this.outlinerState.dropAction.set('above');
      targetEl.classList.add('drag-over-top');
    } else if (y > rect.height * 0.75) {
      this.outlinerState.dropAction.set('below');
      targetEl.classList.add('drag-over-bottom');
    } else {
      this.outlinerState.dropAction.set('inside');
      targetEl.classList.add('drag-over-inside');
      this.outlinerState.expand(node.uniqueId.toString());
    }
  }

  onDragLeave(event: DragEvent) {
    const targetEl = (event.target as HTMLElement).closest('.outliner-item');
    if (targetEl) {
      targetEl.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
    }
  }

  onDrop(node: Node, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.clearDragVisuals();

    const draggedNode = this.outlinerState.draggedNode();
    const action = this.outlinerState.dropAction();

    if (!draggedNode || draggedNode === node || this.isDescendant(node, draggedNode)) {
      this.outlinerState.draggedNode.set(null);
      return;
    }

    if (!this.isDraggable(draggedNode) || !this.isDraggable(node)) {
      this.outlinerState.draggedNode.set(null);
      return;
    }

    const draggedEntity = this.entityManager.getEntityByMesh(draggedNode as AbstractMesh);
    const targetEntity = this.entityManager.getEntityByMesh(node as AbstractMesh);

    const setParentSafe = (child: Node, parent: Node | null) => {
      if (typeof (child as any).setParent === 'function') {
        (child as any).setParent(parent);
      } else {
        child.parent = parent;
      }
    };

    if (action === 'inside') {
      setParentSafe(draggedNode, node);
      if (draggedEntity) {
          draggedEntity.parentId = targetEntity ? targetEntity.uid : null;
          draggedEntity.syncTransformFromView();
          draggedEntity.isDirty = true;
      }
    } else {
      const newParent = node.parent;
      setParentSafe(draggedNode, newParent);
      const newParentEntity = newParent ? this.entityManager.getEntityByMesh(newParent as AbstractMesh) : null;
      
      if (draggedEntity) {
          draggedEntity.parentId = newParentEntity ? newParentEntity.uid : null;
          draggedEntity.syncTransformFromView();
          draggedEntity.isDirty = true;
      }
    }

    this.mapaSvc.onMapChanged.next();
    this.outlinerState.draggedNode.set(null);
  }

  onDragEnd(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('dragging');
    this.clearDragVisuals();
    this.outlinerState.draggedNode.set(null);
  }

  private clearDragVisuals() {
    document.querySelectorAll('.outliner-item').forEach(i => {
      i.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
    });
  }

  private isDescendant(target: Node, potentialParent: Node): boolean {
    let current = target.parent;
    while (current) {
      if (current === potentialParent) return true;
      current = current.parent;
    }
    return false;
  }

  // ========================================================
  // EDICIÓN EN LÍNEA
  // ========================================================
  
  startEditing(node: Node, event: Event) {
    event.stopPropagation();
    this.editingNodeId = node.uniqueId.toString();
    this.editingName = this.getDisplayName(node);
    
    setTimeout(() => {
        const input = document.getElementById('editInput_' + node.uniqueId) as HTMLInputElement;
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
  }

  saveEdit(node: Node) {
    if (!this.editingNodeId) return;
    
    const safeName = this.editingName.trim();
    if (safeName !== '') {
       if (node instanceof AbstractMesh) {
          const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh) as AbstractMesh;
          if (rootMesh) {
              const entity = this.entityManager.getEntityByMesh(rootMesh);
              if (entity) {
                  if (node === rootMesh) {
                      entity.name = safeName;
                      entity.isDirty = true;
                      this.mapaSvc.onMapChanged.next();
                  } else {
                      if (!entity.partOverrides) entity.partOverrides = new PartOverridesComponent();
                      if (!entity.partOverrides.overrides[node.name]) entity.partOverrides.overrides[node.name] = {};
                      
                      entity.partOverrides.overrides[node.name].displayName = safeName;
                      entity.isDirty = true;
                      this.mapaSvc.onMapChanged.next();
                  }
              }
          }
       }
    }
    
    this.editingNodeId = null;
  }

  cancelEdit() {
    this.editingNodeId = null;
  }
  
  handleKeyDown(event: KeyboardEvent, node: Node) {
      if (event.key === 'Enter') {
          this.saveEdit(node);
      } else if (event.key === 'Escape') {
          this.cancelEdit();
      }
  }
}