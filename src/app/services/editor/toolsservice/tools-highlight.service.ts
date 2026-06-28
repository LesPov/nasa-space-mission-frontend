
import { Injectable, inject } from '@angular/core';
import { Color3, HighlightLayer, Mesh, AbstractMesh, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { AuthService } from '../../../core/services/auth';

@Injectable({ providedIn: 'root' })
export class ToolsHighlightService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private authSvc = inject(AuthService);

  private lastHoveredMeshId: number | null = null;
  private lastSelectedMeshId: number | null = null;

  private meshesResaltadas: Mesh[] = [];
  
  private highlightLayer: HighlightLayer | null = null;

  private getHighlightLayer(): HighlightLayer {
    if (!this.highlightLayer && this.motor3d.getScene()) {
      this.highlightLayer = new HighlightLayer("editorHighlightLayer", this.motor3d.getScene(), {
        isStroke: true, 
        mainTextureRatio: 2 
      });
      this.highlightLayer.innerGlow = false; 
      this.highlightLayer.outerGlow = true;  
      this.highlightLayer.blurHorizontalSize = 3.0; 
      this.highlightLayer.blurVerticalSize = 3.0;
    }
    return this.highlightLayer!;
  }

  public initHighlights(): void {
    if (this.motor3d.getScene()) {
      this.getHighlightLayer();
    }
  }

  private esMeshExcluida(mesh: Mesh): boolean {
    const n = mesh.name?.toLowerCase?.() ?? '';
    return (
      Tags.MatchesQuery(
        mesh,
        'fog_element || debug_element || editor_only || system_element || proxy_collider'
      ) ||
      n.includes('proxycol') ||
      n.includes('collider') ||
      n.includes('gizmo') ||
      n.includes('highlight') ||
      n.includes('camerapivot')
    );
  }

  private recolectarMeshesVisuales(baseMesh: Mesh): Mesh[] {
    const meshes = new Set<Mesh>();
    if (!baseMesh || baseMesh.isDisposed()) return [];

    const entity = this.entityManager.getEntityByMesh(baseMesh);
    const entityUid = entity?.uid ?? null;

    if (!entity) {
       if (!this.esMeshExcluida(baseMesh) && baseMesh.getTotalVertices() > 0) {
          meshes.add(baseMesh);
       }
       return Array.from(meshes);
    }

    const rootView = entity.view as Mesh;
    if (!rootView || rootView.isDisposed()) return [];

    const traverse = (node: AbstractMesh) => {
      if (!node || node.isDisposed()) return;

      const e = this.entityManager.getEntityByMesh(node);
      if (e && entityUid && e.uid !== entityUid) {
        return; 
      }

      if (node instanceof Mesh) {
        if (!this.esMeshExcluida(node) && node.getTotalVertices() > 0) {
          meshes.add(node);
        }
      }

      node.getChildren().forEach(child => {
        if (child instanceof AbstractMesh) {
          traverse(child);
        }
      });
    };

    traverse(rootView);

    return Array.from(meshes);
  }

  private limpiarTodosLosEdges(): void {
    const hl = this.getHighlightLayer();
    if (hl) {
      hl.removeAllMeshes();
    }
    
    this.meshesResaltadas.forEach(m => {
      if (m && !m.isDisposed()) {
        try {
          m.renderOutline = false;
          m.disableEdgesRendering();
        } catch {}
      }
    });
    this.meshesResaltadas = [];
  }

  private aplicarOutline(mesh: Mesh, color: Color3): void {
    if (!mesh || mesh.isDisposed()) return;

    try {
      mesh.renderOutline = false; 
      mesh.disableEdgesRendering();

      const hl = this.getHighlightLayer();
      if (hl && !hl.hasMesh(mesh)) {
        hl.addMesh(mesh, color);
        this.meshesResaltadas.push(mesh);
      }
    } catch {}
  }

  private procesarMesh(pickedMesh: Mesh, colorHex: string): void {
    if (!pickedMesh || pickedMesh.isDisposed()) return;
    if (this.esMeshExcluida(pickedMesh)) return;

    const entity = this.entityManager.getEntityByMesh(pickedMesh);
    
    if (entity) {
      const esPiso = entity.type === 'plane';
      const mostrarBorde = entity.visual?.mostrarBorde;

      if (esPiso && mostrarBorde !== true) {
        return;
      }

      if (mostrarBorde === false) {
        return; 
      }
    }

    const mode = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    const canHighlight =
      mode === 'EDITOR' ||
      mode === 'EDITING_IN_GAME' ||
      (mode === 'PLAYING' && isAdmin);

    if (!canHighlight) return;

    const color3 = Color3.FromHexString(colorHex);
    const meshesVisuales = this.recolectarMeshesVisuales(pickedMesh);
    
    if (meshesVisuales.length === 0 && pickedMesh.getTotalVertices() > 0) {
       this.aplicarOutline(pickedMesh, color3);
    } else {
       meshesVisuales.forEach(m => this.aplicarOutline(m, color3));
    }
  }

  public actualizarHighlights(selected: Mesh | null, hovered: Mesh | null): void {
    const hoverId = hovered ? hovered.uniqueId : null;
    const selectId = selected ? selected.uniqueId : null;

    if (this.lastHoveredMeshId === hoverId && this.lastSelectedMeshId === selectId) {
      return;
    }

    this.lastHoveredMeshId = hoverId;
    this.lastSelectedMeshId = selectId;

    this.limpiarTodosLosEdges();

    const mode = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    const puedeResaltar =
      mode === 'EDITOR' ||
      mode === 'EDITING_IN_GAME' ||
      (mode === 'PLAYING' && isAdmin);

    if (!puedeResaltar) return;

    const colorHover = '#3b82f6';   
    const colorSelected = '#fbbf24'; 

    if (hovered && hovered !== selected) {
      this.procesarMesh(hovered, colorHover);
    }

    if (selected && !this.state.subObjetoSeleccionado()) {
      this.procesarMesh(selected, colorSelected);
    }
  }
}