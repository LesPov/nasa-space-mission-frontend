import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Node, AbstractMesh, Tags, Mesh, Camera, Light } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { OutlinerStateService } from '../outliner-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { PartOverridesComponent } from '../../../../core/engine/entities/game.entity';
import { SceneNodesService } from '../../../../services/editor/sceneservice/scene-nodes.service';

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
  private nodesSvc = inject(SceneNodesService);
  private cdr = inject(ChangeDetectorRef);

  public editingNodeId: string | null = null;
  public editingName: string = '';

  private sub: Subscription | null = null;

  // 🔥 SOLUCIÓN NG0100: Caché estricto para estabilizar las referencias de los arrays en Angular
  private filteredNodesCache: Node[] | null = null;
  private childrenCache = new Map<number, Node[]>();
  private lastSearchTermCache: string | null = null;

  ngOnInit() {
    this.sub = this.mapaSvc.onMapChanged.subscribe(() => {
      this.clearCaches();
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    this.childrenCache.clear();
  }

  private clearCaches(): void {
    this.filteredNodesCache = null;
    this.childrenCache.clear();
  }

  get searchTerm(): string {
    return this.outlinerState.searchTerm().toLowerCase().trim();
  }

  private getOrderIndex(node: Node): number {
      if (node instanceof AbstractMesh) {
          const ent = this.entityManager.getEntityByMesh(node);
          if (ent) return ent.orderIndex || 0;
      }
      return (node as any).metadata?.orderIndex || 0;
  }

  get filteredNodes(): Node[] {
    const currentTerm = this.searchTerm;
    
    // Si el término de búsqueda cambió, invalidamos el caché
    if (this.lastSearchTermCache !== currentTerm) {
       this.clearCaches();
       this.lastSearchTermCache = currentTerm;
    }

    // 🔥 Retorna la misma referencia en memoria para evitar el NG0100
    if (this.filteredNodesCache) {
       return this.filteredNodesCache;
    }

    let list = this.depth === 0 ? this.stateSvc.nodosEscena() : this.nodes;
    
    if (this.depth > 0) {
       list = list.filter(n => {
           if (n.name.includes('proxycol')) return false;
           if (n.name.startsWith('decal_')) return false;
           if (Tags.MatchesQuery(n, "light_visual") || (n as any).metadata?.isLightVisual) return false;
           if (Tags.MatchesQuery(n, "light_entity")) return true;
           
           const childEntity = n instanceof AbstractMesh ? this.entityManager.getEntityByMesh(n) : null;
           if (childEntity && childEntity.type.startsWith('light_')) return true;

           if (Tags.MatchesQuery(n, "system_element || editor_only || fog_element || debug_element || proxy_collider")) return false;
           return true;
       });
    } else {
       list = list.filter(n => {
           if (n.parent !== null) return false;
           if (n instanceof AbstractMesh) {
               const entity = this.entityManager.getEntityByMesh(n);
               if (entity && entity.parentId) {
                   const parentEnt = this.entityManager.getEntityByUid(entity.parentId);
                   if (parentEnt && parentEnt.view) return false;
               }
           }
           return true;
       });
    }

    if (currentTerm) {
      list = list.filter(n => this.nodeOrChildMatches(n, currentTerm));
    }
    
    this.filteredNodesCache = list.sort((a, b) => this.getOrderIndex(a) - this.getOrderIndex(b));
    return this.filteredNodesCache;
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

  getUsefulChildren(node: Node): Node[] {
    // 🔥 SOLUCIÓN NG0100: Retornar caché para mantener la estabilidad del Virtual DOM
    if (this.childrenCache.has(node.uniqueId)) {
       return this.childrenCache.get(node.uniqueId)!;
    }

    const result: Node[] = [];
    const children = node.getChildren();
    
    if (node instanceof AbstractMesh) {
        const entity = this.entityManager.getEntityByMesh(node);
        if (entity) {
            const logicalChildren = this.entityManager.getAllEntities().filter(e => e.parentId === entity.uid);
            for (const lc of logicalChildren) {
                if (lc.view && lc.view.parent === null && !children.includes(lc.view)) {
                    children.push(lc.view);
                }
            }
        }
    }

    for (const child of children) {
      if (Tags.MatchesQuery(child, "light_visual") || (child as any).metadata?.isLightVisual) {
        continue;
      }
      
      if (Tags.MatchesQuery(child, "light_entity")) {
        result.push(child);
        continue;
      }

      const childEntity = child instanceof AbstractMesh ? this.entityManager.getEntityByMesh(child) : null;
      if (childEntity && childEntity.type.startsWith('light_')) {
        result.push(child);
        continue;
      }

      if (Tags.MatchesQuery(child, "system_element || editor_only || fog_element || debug_element || proxy_collider")) continue;
      if (child.name.includes('proxycol') || child.name.startsWith('decal_')) continue;

      if (this.isTechnicalWrapper(child)) {
        result.push(...this.getUsefulChildren(child)); // Recursividad segura gracias al caché
      } else {
        result.push(child);
      }
    }
    
    const sortedResult = result.sort((a, b) => this.getOrderIndex(a) - this.getOrderIndex(b));
    this.childrenCache.set(node.uniqueId, sortedResult);
    
    return sortedResult;
  }

  isTechnicalWrapper(node: Node): boolean {
    if (Tags.MatchesQuery(node, "light_visual || light_entity") || (node as any).metadata?.isLightVisual) {
      return false;
    }

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
    
    if (Tags.MatchesQuery(node, "light_visual") || (node as any).metadata?.isLightVisual) {
      return '◉ Cuerpo visual';
    }

    const entity = this.entityManager.getEntityByMesh(node);
    if (entity) {
      return entity.name;
    }

    const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh) as AbstractMesh;
    if (!rootMesh) return node.name;
    
    const rootEntity = this.entityManager.getEntityByMesh(rootMesh);
    if (node === rootMesh && rootEntity) {
        return rootEntity.name;
    }

    if (!rootEntity || !rootEntity.partOverrides) return node.name;

    const override = rootEntity.partOverrides.overrides[node.name];
    return override?.displayName || node.name;
  }

  getIcon(node: Node): string {
    if (node instanceof Camera) return '🎥';
    if (Tags.MatchesQuery(node, "light_visual") || (node as any).metadata?.isLightVisual) return '◉';

    if (node instanceof AbstractMesh) {
        const entity = this.entityManager.getEntityByMesh(node);
        if (entity) {
            if (entity.type.startsWith('light_')) return '💡';
            if (entity.rol === 'player') return '🎮';
            if (entity.rol === 'spawn_point') return '📍';
            if (entity.type === 'trigger') return '⚡';
            if (entity.type === 'trigger_compuesto') return '💠';
            if (entity.type === 'bubble') return '🫧';
            if (entity.type === 'video_plane') return '📺';
            if (entity.type === 'image_plane') return '🖼️';
            if (entity.characterConfig) {
                if (entity.characterConfig.characterType === 'politico') return '👔';
                if (entity.characterConfig.characterType === 'militar') return '🪖';
                return '🤖';
            }
            if (entity.visual?.assetId || entity.type === 'model') return '📦';
            if (entity.type === 'cube') return '🧊';
            if (entity.type === 'sphere') return '⚽';
            if (entity.type === 'cylinder') return '🛢️';
            if (entity.type === 'plane') return '🗺️';
            return '📦'; 
        }
        const rootMesh = this.stateSvc.encontrarRaiz(node);
        if (rootMesh !== node) return '🧩'; 
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

  selectNode(node: Node, event: Event) {
    event.stopPropagation();
    if (this.editingNodeId) return; 

    if (!(node instanceof AbstractMesh)) return;

    if (Tags.MatchesQuery(node, "light_visual") || (node as any).metadata?.isLightVisual) {
       const entityUid = (node as any).metadata?.entityUid;
       if (entityUid) {
         const ent = this.entityManager.getEntityByUid(entityUid);
         if (ent && ent.view) {
           this.stateSvc.seleccionarObjeto(ent.view);
           this.stateSvc.setSubObjetoSeleccionado(null);
           return;
         }
       }
       if (node.parent instanceof AbstractMesh) {
         this.stateSvc.seleccionarObjeto(node.parent);
         this.stateSvc.setSubObjetoSeleccionado(null);
         return;
       }
       this.stateSvc.seleccionarObjeto(node);
       this.stateSvc.setSubObjetoSeleccionado(null);
       return;
    }

    const selfEntity = this.entityManager.getEntityByMesh(node);
    if (selfEntity && selfEntity.type.startsWith('light_')) {
       this.stateSvc.seleccionarObjeto(node);
       this.stateSvc.setSubObjetoSeleccionado(null);
       return;
    }

    const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh);
    if (rootMesh === node) {
       this.stateSvc.seleccionarObjeto(node);
       this.stateSvc.setSubObjetoSeleccionado(null);
    } else {
       this.stateSvc.seleccionarObjeto(node);
       this.stateSvc.setSubObjetoSeleccionado(null);
    }
  }

  isSelected(node: Node): boolean {
    const selected = this.stateSvc.objetoSeleccionado();
    if (selected === node) return true;
    
    if (selected instanceof AbstractMesh && node instanceof AbstractMesh) {
      const selectedEntity = this.entityManager.getEntityByMesh(selected);
      const nodeEntity = this.entityManager.getEntityByMesh(node);
      if (selectedEntity && nodeEntity && selectedEntity.uid === nodeEntity.uid) {
        return true;
      }
      if ((selected as any).metadata?.entityUid && (selected as any).metadata?.entityUid === (node as any).metadata?.entityUid) {
        return true;
      }
    }
    return false;
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

  isDraggable(node: Node): boolean {
    if (node instanceof Camera) return false;
    if (node instanceof AbstractMesh) {
      if (Tags.MatchesQuery(node, "light_visual") || (node as any).metadata?.isLightVisual) return false;
      const rootMesh = this.stateSvc.encontrarRaiz(node);
      if (rootMesh === node) return true;
    }
    return false;
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

  private isDescendant(target: Node, potentialParent: Node): boolean {
    let current = target.parent;
    while (current) {
      if (current === potentialParent) return true;
      current = current.parent;
    }
    return false;
  }

  onDragOver(node: Node, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    
    const dragged = this.outlinerState.draggedNode();
    if (!dragged || dragged === node || !this.isDraggable(dragged) || !this.isDraggable(node)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }

    if (this.isDescendant(node, dragged)) {
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

    if (!draggedNode || draggedNode === node) {
      this.outlinerState.draggedNode.set(null);
      return;
    }

    if (this.isDescendant(node, draggedNode)) {
      this.outlinerState.draggedNode.set(null);
      return;
    }

    const newParentNode = action === 'inside' ? node : node.parent;

    if (draggedNode.parent !== newParentNode) {
        const draggedEntity = this.entityManager.getEntityByMesh(draggedNode as AbstractMesh);
        const newParentEntity = newParentNode ? this.entityManager.getEntityByMesh(newParentNode as AbstractMesh) : null;
        
        if (draggedEntity) {
            draggedEntity.parentId = newParentEntity ? newParentEntity.uid : null;
            
            if (typeof (draggedNode as any).setParent === 'function') {
                (draggedNode as any).setParent(newParentNode);
            } else {
                draggedNode.parent = newParentNode;
            }
            draggedEntity.syncTransformFromView();
            draggedEntity.isDirty = true;
        }
    }

    const allSiblings = newParentNode ? newParentNode.getChildren() : this.stateSvc.nodosEscena();

    const validSiblings = allSiblings.filter(s => {
       if (Tags.MatchesQuery(s, "light_visual") || (s as any).metadata?.isLightVisual) return false;
       if (Tags.MatchesQuery(s, "system_element || editor_only || fog_element || debug_element || proxy_collider")) return false;
       return true;
    }).sort((a, b) => this.getOrderIndex(a) - this.getOrderIndex(b));

    const draggedIdx = validSiblings.indexOf(draggedNode);
    if (draggedIdx > -1) validSiblings.splice(draggedIdx, 1);

    let targetIdx = validSiblings.length;
    if (action === 'above') {
        targetIdx = validSiblings.indexOf(node);
    } else if (action === 'below') {
        targetIdx = validSiblings.indexOf(node) + 1;
    }

    if (targetIdx > -1 && targetIdx <= validSiblings.length) {
        validSiblings.splice(targetIdx, 0, draggedNode);
    } else {
        validSiblings.push(draggedNode);
    }

    validSiblings.forEach((sibling, i) => {
        if (sibling instanceof AbstractMesh) {
            const entity = this.entityManager.getEntityByMesh(sibling);
            if (entity) {
                entity.orderIndex = i;
                entity.isDirty = true;
            } else {
                if (!sibling.metadata) sibling.metadata = {};
                sibling.metadata.orderIndex = i;
            }
        }
    });

    this.nodesSvc.actualizarListaNodos();
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
                  if (node === rootMesh || (node as any).metadata?.isLightVisual) {
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