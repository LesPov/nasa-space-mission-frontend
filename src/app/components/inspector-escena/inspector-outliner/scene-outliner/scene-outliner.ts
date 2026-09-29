import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Node, AbstractMesh, Tags, Mesh } from '@babylonjs/core';
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
    
    // Filtro para ignorar colisionadores y decals técnicos de Babylon
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
      // Si la búsqueda coincide con el nodo actual O con alguno de sus hijos útiles
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
  // MAGIA VISUAL: REPRESENTACIÓN DERIVADA DE JERARQUÍA
  // ========================================================

  getUsefulChildren(node: Node): Node[] {
    const result: Node[] = [];
    const children = node.getChildren();
    
    for (const child of children) {
      if (Tags.MatchesQuery(child, "system_element || editor_only || fog_element || debug_element || proxy_collider")) continue;
      if (child.name.includes('proxycol') || child.name.startsWith('decal_')) continue;

      if (this.isTechnicalWrapper(child)) {
        // En lugar de renderizar la carpeta inútil, "extraemos" sus hijos hacia este nivel visual recursivamente
        result.push(...this.getUsefulChildren(child));
      } else {
        result.push(child);
      }
    }
    return result;
  }

  isTechnicalWrapper(node: Node): boolean {
    // 1. Si es la raíz oficial de la entidad, NUNCA la ignoramos.
    if (node instanceof AbstractMesh) {
      const entity = this.entityManager.getEntityByMesh(node);
      if (entity && entity.view === node) return false;

      // 2. Si el usuario lo ha modificado (tiene partOverrides), NUNCA lo ignoramos.
      const rootMesh = this.stateSvc.encontrarRaiz(node);
      if (rootMesh) {
        const rootEnt = this.entityManager.getEntityByMesh(rootMesh as AbstractMesh);
        if (rootEnt?.partOverrides?.overrides[node.name]) return false;
      }
    }

    // 3. Si tiene geometría real (polígonos), es una parte física importante.
    if (node instanceof Mesh && node.getTotalVertices() > 0) return false;
    if (node.getClassName() === "InstancedMesh") {
         const source = (node as any).sourceMesh;
         if (source && source.getTotalVertices() > 0) return false;
    }

    // 4. Luces o Cámaras internas nunca se ocultan.
    if (node.getClassName().includes("Light") || node.getClassName().includes("Camera")) return false;

    // Si llegamos aquí, el nodo no tiene polígonos, ni materiales, ni identidad de juego.
    // Es un simple TransformNode estructural creado por Blender (__root__, Armature, Sketchfab...).
    // Se oculta visualmente (Bypass).
    return true;
  }

  getDisplayName(node: Node): string {
    if (!(node instanceof AbstractMesh)) return node.name;
    const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh) as AbstractMesh;
    if (!rootMesh) return node.name;
    
    const entity = this.entityManager.getEntityByMesh(rootMesh);
    
    if (node === rootMesh && entity) {
        return entity.name; // Nombre principal del objeto
    }

    if (!entity || !entity.partOverrides) return node.name;

    const override = entity.partOverrides.overrides[node.name];
    return override?.displayName || node.name; // Nombre amigable o técnico de la parte
  }

  getIcon(node: Node): string {
    if (node instanceof AbstractMesh) {
        const entity = this.entityManager.getEntityByMesh(node);
        // Si la entidad existe y la malla ES la vista principal de la entidad (Objeto Raíz)
        if (entity && entity.view === node) {
            if (entity.rol === 'player') return '🏃';
            if (entity.rol === 'spawn_point') return '📍';
            if (entity.type.startsWith('light_')) return '💡';
            if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') return '⚡';
            if (entity.type === 'bubble') return '🫧';
            if (entity.type === 'video_plane') return '📺';
            if (entity.type === 'image_plane') return '🖼️';
            if (entity.characterConfig) {
                if (entity.characterConfig.characterType === 'politico') return '👔';
                if (entity.characterConfig.characterType === 'militar') return '🪖';
                return '🤖';
            }
            return '📦'; 
        }
        // Si es un AbstractMesh pero NO es la raíz de una entidad, es una parte interna
        return '🧩';
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

    const rootMesh = this.stateSvc.encontrarRaiz(node as AbstractMesh);
    
    if (rootMesh === node) {
       this.stateSvc.seleccionarObjeto(node);
       this.stateSvc.setSubObjetoSeleccionado(null);
    } else {
       // Seleccionamos la raíz y el Motor 3D lo interpretará como Parte Interna
       this.stateSvc.seleccionarObjeto(node); 
    }
  }

  isSelected(node: Node): boolean {
    return this.stateSvc.objetoSeleccionado() === node;
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