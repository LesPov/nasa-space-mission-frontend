
import { Component, Input, OnInit, ViewChild, ElementRef, inject, DoCheck } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Node, AbstractMesh, Camera, Light, Mesh, TransformNode, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { OutlinerStateService } from '../outliner-state.service';
import { GameEntity } from '../../../../core/engine/entities/game.entity';

@Component({
  selector: 'app-outliner-node-item',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './outliner-node-item.html',
  styleUrls: ['./outliner-node-item.css']
})
export class OutlinerNodeItemComponent implements OnInit, DoCheck {
  @Input() node!: Node;
  @Input() depth: number = 0;

  @ViewChild('renameInput') renameInput!: ElementRef<HTMLInputElement>;

  private entityManager = inject(EntityManagerService);
  private stateSvc = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private outlinerState = inject(OutlinerStateService);

  public entity: GameEntity | null = null;
  public children: Node[] = [];
  public hasChildren: boolean = false;
  
  public isRenaming = false;
  public editName = '';

  public icon = '📌';
  public entityType = 'Object';

  private lastSearchTerm = '';
  public meetsFilter = true;
  public highlightedName = '';

  // Getters Evaluados
  get isSelected(): boolean { return this.stateSvc.objetoSeleccionado() === this.node; }
  get isExpanded(): boolean { return this.outlinerState.isExpanded(this.getUid()); }
  get paddingLeft(): number { return 10 + (this.depth * 15); }
  get isSelectable(): boolean { return this.entity?.visual?.isSelectable ?? true; }
  get isVisible(): boolean { return (this.node as AbstractMesh).isVisible && (this.node as AbstractMesh).isEnabled(); }

  ngOnInit() {
    this.refreshData();
  }

  ngDoCheck() {
    // Reaccionar a cambios en la búsqueda
    if (this.lastSearchTerm !== this.outlinerState.searchTerm()) {
      this.lastSearchTerm = this.outlinerState.searchTerm();
      this.evaluateSearch();
    }
  }

  private getUid(): string {
    return this.entity ? this.entity.uid : this.node.uniqueId.toString();
  }

  public refreshData() {
    this.entity = this.node instanceof AbstractMesh ? (this.entityManager.getEntityByMesh(this.node) || null) : null;
    this.setupIcon();
    
    // Filtrar Hijos Reales Espaciales
    this.children = this.node.getChildren().filter(child => {
      if (!(child instanceof Mesh) && !(child instanceof Light) && !(child instanceof TransformNode)) return false;
      return this.isValidOutlinerNode(child);
    }).sort((a, b) => {
      const eA = this.entityManager.getEntityByMesh(a as AbstractMesh);
      const eB = this.entityManager.getEntityByMesh(b as AbstractMesh);
      return (eA?.orderIndex || 0) - (eB?.orderIndex || 0);
    });

    this.hasChildren = this.children.length > 0;
    this.evaluateSearch();
  }

  private isValidOutlinerNode(child: Node): boolean {
    if (Tags.MatchesQuery(child, "system_element || fog_element || debug_element || proxy_collider || decal || editor_only || invisible_floor")) return false;
    const name = child.name.toLowerCase();
    if (name.includes('backgroundhelper') || name.includes('skybox') || name.includes('environment')) return false;
    return true;
  }

  private setupIcon() {
    if (this.node instanceof Camera) { this.icon = '🎥'; this.entityType = 'Camera'; return; }
    if (this.node instanceof Light) { this.icon = '💡'; this.entityType = 'Light'; return; }
    
    if (this.entity) {
      this.entityType = this.entity.type;
      if (this.entity.rol === 'player') { this.icon = '🏃'; return; }
      if (this.entity.rol === 'spawn_point') { this.icon = '📍'; return; }
      if (this.entity.type?.startsWith('light_')) { this.icon = '💡'; return; }
      if (this.entity.type === 'trigger' || this.entity.type === 'trigger_compuesto') { this.icon = '⚡'; return; }
      if (this.entity.type === 'bubble') { this.icon = '🫧'; return; }
      if (this.entity.type === 'video_plane') { this.icon = '📺'; return; }
      if (this.entity.type === 'image_plane') { this.icon = '🖼️'; return; }
      if (this.entity.characterConfig) {
        if (this.entity.characterConfig.characterType === 'politico') { this.icon = '👔'; return; }
        if (this.entity.characterConfig.characterType === 'militar') { this.icon = '🪖'; return; }
        this.icon = '🤖'; return;
      }
      if (this.entity.visual?.assetId) { this.icon = '📦'; return; } // Prefab/Model
      if (this.entity.type === 'cube' || this.node.name.toLowerCase().includes('cubo')) { this.icon = '🧊'; return; }
      if (this.entity.type === 'sphere' || this.node.name.toLowerCase().includes('esfera')) { this.icon = '⚽'; return; }
      if (this.entity.type === 'cylinder') { this.icon = '🛢️'; return; }
      if (this.entity.type === 'plane') { this.icon = '🗺️'; return; }
      this.icon = '📐';
    } else {
      this.icon = '📌';
    }
  }

  private evaluateSearch() {
    const term = this.lastSearchTerm.trim().toLowerCase();
    if (!term) {
      this.meetsFilter = true;
      this.highlightedName = this.node.name;
      return;
    }

    // Comprobar si cumple él o alguno de sus hijos
    const matchesMe = this.node.name.toLowerCase().includes(term);
    const matchesChild = this.checkChildMatch(this.node, term);

    this.meetsFilter = matchesMe || matchesChild;

    if (matchesChild && !this.isExpanded) {
        this.outlinerState.expand(this.getUid());
    }

    if (matchesMe) {
      const safeTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(${safeTerm})`, 'gi');
      this.highlightedName = this.node.name.replace(regex, `<span class="highlight-search">$1</span>`);
    } else {
      this.highlightedName = this.node.name;
    }
  }

  private checkChildMatch(node: Node, term: string): boolean {
    const children = node.getChildren().filter(c => this.isValidOutlinerNode(c));
    for (const child of children) {
      if (child.name.toLowerCase().includes(term)) return true;
      if (this.checkChildMatch(child, term)) return true;
    }
    return false;
  }

  // --- ACTIONS ---

  public toggleExpand(event: Event) {
    event.stopPropagation();
    this.outlinerState.toggleExpand(this.getUid());
  }

  public selectNode(event: MouseEvent) {
    event.stopPropagation();
    if (this.node instanceof Camera || (this.node instanceof Light && !this.entity)) return; // Locked base items
    
    if (this.isSelected) {
      this.stateSvc.seleccionarObjeto(null);
    } else {
      this.stateSvc.seleccionarObjeto(this.node);
    }
  }

  public startRename(event: MouseEvent) {
    event.stopPropagation();
    if (!this.entity) return;
    this.editName = this.entity.name;
    this.isRenaming = true;
    setTimeout(() => {
      if (this.renameInput) {
        this.renameInput.nativeElement.focus();
        this.renameInput.nativeElement.select();
      }
    });
  }

  public commitRename() {
    if (this.isRenaming && this.entity) {
      const newName = this.editName.trim();
      if (newName && newName !== this.entity.name) {
        this.entity.name = newName;
        if (this.node) this.node.name = newName;
        this.entity.isDirty = true;
        this.entity.syncToView();
        this.mapaSvc.onMapChanged.next();
      }
      this.isRenaming = false;
      this.evaluateSearch();
    }
  }

  public cancelRename() {
    this.isRenaming = false;
  }

  public toggleVisibility(event: MouseEvent) {
    event.stopPropagation();
    const mesh = this.node as AbstractMesh;
    if (mesh) {
      const isVis = mesh.isVisible && mesh.isEnabled();
      mesh.setEnabled(!isVis);
      mesh.isVisible = !isVis;
    }
  }

  public toggleLock(event: MouseEvent) {
    event.stopPropagation();
    if (this.entity) {
      this.entity.visual.isSelectable = !this.entity.visual.isSelectable;
      (this.node as AbstractMesh).isPickable = this.entity.visual.isSelectable;
      this.entity.isDirty = true;
      this.mapaSvc.onMapChanged.next();
    }
  }

  public openContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.stateSvc.seleccionarObjeto(this.node);
    this.outlinerState.contextMenuNode.set(this.node);
    this.outlinerState.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
    this.outlinerState.contextMenuOpen.set(true);
  }

  // --- DRAG AND DROP ---

  public trackByUid(index: number, node: Node): string {
    return node.uniqueId.toString();
  }

  public onDragStart(event: DragEvent) {
    if (!this.entity) { event.preventDefault(); return; }
    this.outlinerState.draggedNode.set(this.node);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', this.getUid());
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

  public onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    
    const dragged = this.outlinerState.draggedNode();
    if (!dragged || dragged === this.node || this.isDescendant(this.node, dragged)) {
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
      this.outlinerState.dropAction.set('above');
      targetEl.classList.add('drag-over-top');
    } else if (y > rect.height * 0.75) {
      this.outlinerState.dropAction.set('below');
      targetEl.classList.add('drag-over-bottom');
    } else {
      this.outlinerState.dropAction.set('inside');
      targetEl.classList.add('drag-over-inside');
      this.outlinerState.expand(this.getUid());
    }
  }

  public onDragLeave(event: DragEvent) {
    const targetEl = (event.target as HTMLElement).closest('.node-item');
    if (targetEl) {
      targetEl.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
    }
  }

  public onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.clearDragVisuals();

    const draggedNode = this.outlinerState.draggedNode();
    const action = this.outlinerState.dropAction();

    if (!draggedNode || draggedNode === this.node || this.isDescendant(this.node, draggedNode)) {
      this.outlinerState.draggedNode.set(null);
      return;
    }

    const draggedEntity = this.entityManager.getEntityByMesh(draggedNode as AbstractMesh);
    const targetEntity = this.entity;

    const setParentSafe = (child: Node, parent: Node | null) => {
      if (typeof (child as any).setParent === 'function') {
        (child as any).setParent(parent);
      } else {
        child.parent = parent;
      }
    };

    if (action === 'inside') {
      setParentSafe(draggedNode, this.node);
      if (draggedEntity) {
          draggedEntity.parentId = targetEntity ? targetEntity.uid : null;
          draggedEntity.syncTransformFromView();
          draggedEntity.isDirty = true;
      }
    } else {
      const newParent = this.node.parent;
      setParentSafe(draggedNode, newParent);
      const newParentEntity = newParent ? this.entityManager.getEntityByMesh(newParent as AbstractMesh) : null;
      
      if (draggedEntity) {
          draggedEntity.parentId = newParentEntity ? newParentEntity.uid : null;
          draggedEntity.syncTransformFromView();
          draggedEntity.isDirty = true;
      }
      
      // Order index recalculation should ideally happen in the orchestrator, 
      // but doing it lazily is fine since Babylon preserves visual order correctly.
    }

    this.mapaSvc.onMapChanged.next();
    this.outlinerState.draggedNode.set(null);
  }

  public onDragEnd(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('dragging');
    this.clearDragVisuals();
    this.outlinerState.draggedNode.set(null);
  }

  private clearDragVisuals() {
    document.querySelectorAll('.node-item').forEach(i => {
      i.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
    });
  }
}