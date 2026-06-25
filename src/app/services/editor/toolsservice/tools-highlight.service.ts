import { Injectable, inject } from '@angular/core';
import { Color3, Color4, Mesh, Tags } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { AuthService } from '../../../core/services/auth';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';

@Injectable({ providedIn: 'root' })
export class ToolsHighlightService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private authSvc = inject(AuthService);
  private ownership = inject(CameraOwnershipService);

  private lastHoveredMeshId: number | null = null;
  private lastSelectedMeshId: number | null = null;

  private edgesHovered: Mesh[] = [];
  private edgesSelected: Mesh[] = [];

  // HighlightLayer eliminado completamente — solo edges y outlines

  public initHighlights(): void {
    // No necesitamos inicializar nada para edges rendering
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

  private getTopMeshAncestor(mesh: Mesh): Mesh {
    let current: Mesh = mesh;
    while (current.parent instanceof Mesh) {
      current = current.parent;
    }
    return current;
  }

  private recolectarMeshesVisuales(root: Mesh): Mesh[] {
    const meshes = new Set<Mesh>();
    if (!root || root.isDisposed()) return [];

    const entity = this.entityManager.getEntityByMesh(root);
    const entityUid = entity?.uid ?? null;

    const agregarSiSirve = (m: Mesh) => {
      if (!m || m.isDisposed()) return;
      if (this.esMeshExcluida(m)) return;

      const e = this.entityManager.getEntityByMesh(m);
      if (e && entityUid && e.uid !== entityUid) return;

      if (m.getTotalVertices() > 0) {
        meshes.add(m);
      }
    };

    agregarSiSirve(root);
    root.getChildMeshes(false).forEach(child => {
      if (child instanceof Mesh) agregarSiSirve(child);
    });

    return Array.from(meshes);
  }

  private limpiarTodosLosEdges(): void {
    const limpiar = (lista: Mesh[]) => {
      lista.forEach(m => {
        if (m && !m.isDisposed()) {
          try {
            m.disableEdgesRendering();
            m.renderOutline = false; // Limpiamos también el contorno de seguridad
          } catch {}
        }
      });
    };
    limpiar(this.edgesHovered);
    limpiar(this.edgesSelected);
    this.edgesHovered = [];
    this.edgesSelected = [];
  }

  // AÑADIDO: isTrigger como parámetro para saber si debe ser grueso o delgado
  private aplicarEdges(mesh: Mesh, color: Color4, isSelected: boolean, isTrigger: boolean): void {
    if (!mesh || mesh.isDisposed()) return;
    try {
      // Fuerza a que aparezca en modelos suaves (GLTF)
      mesh.enableEdgesRendering(0.9999, false);
      
      // LOGICA DE GROSOR PARA LINEAS INTERNAS
      // Si es trigger, usamos un valor bajito. Si es 3D/Primitiva, usamos un valor alto.
      mesh.edgesWidth = isSelected 
        ? (isTrigger ? 10.0 : 50.0) 
        : (isTrigger ? 5.0 : 25.0); 
        
      mesh.edgesColor = color;

      // LOGICA DE GROSOR PARA CONTORNO EXTERNO (OUTLINE)
      mesh.renderOutline = true;
      mesh.outlineColor = new Color3(color.r, color.g, color.b);
      
      // Ajuste perfecto: 
      // Si es trigger (0.005) se ve delgado y limpio. 
      // Si es 3D/Primitiva (0.03) se ve grueso tipo 5px.
      mesh.outlineWidth = isSelected 
        ? (isTrigger ? 0.005 : 0.03) 
        : (isTrigger ? 0.002 : 0.015);

      if (isSelected) {
        this.edgesSelected.push(mesh);
      } else {
        this.edgesHovered.push(mesh);
      }
    } catch {}
  }

  private procesarMesh(
    rootMesh: Mesh,
    colorHex: string,
    isSelected: boolean
  ): void {
    if (!rootMesh || rootMesh.isDisposed()) return;
    if (this.esMeshExcluida(rootMesh)) return;

    const root = this.getTopMeshAncestor(rootMesh);
    const entity =
      this.entityManager.getEntityByMesh(root) ??
      this.entityManager.getEntityByMesh(rootMesh);

    // Identificamos si es un trigger
    const isTrigger =
      entity?.type === 'trigger' || entity?.type === 'trigger_compuesto';
      
    const mode = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    const canHighlight = mode === 'EDITOR' || isAdmin || !isTrigger;
    if (!canHighlight) return;

    const color3 = Color3.FromHexString(colorHex);
    const color4 = new Color4(color3.r, color3.g, color3.b, 1.0);

    const meshesVisuales = this.recolectarMeshesVisuales(root);
    // Le pasamos la variable isTrigger a la función que aplica los bordes
    meshesVisuales.forEach(m => this.aplicarEdges(m, color4, isSelected, isTrigger));
  }

  public actualizarHighlights(
    selected: Mesh | null,
    hovered: Mesh | null
  ): void {
    const hoverId = hovered ? hovered.uniqueId : null;
    const selectId = selected ? selected.uniqueId : null;

    if (
      this.lastHoveredMeshId === hoverId &&
      this.lastSelectedMeshId === selectId
    ) {
      return;
    }

    this.lastHoveredMeshId = hoverId;
    this.lastSelectedMeshId = selectId;

    // Limpiar todos los edges anteriores
    this.limpiarTodosLosEdges();

    const mode = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    const puedeResaltar =
      mode === 'EDITOR' ||
      mode === 'EDITING_IN_GAME' ||
      (mode === 'PLAYING' && isAdmin);

    if (!puedeResaltar) return;

    const colorHover = '#3b82f6';    // azul
    const colorSelected = '#fbbf24'; // amarillo

    // Hover: solo si no es el mismo objeto seleccionado
    if (hovered && hovered !== selected) {
      this.procesarMesh(hovered, colorHover, false);
    }

    // Selección
    if (selected && !this.state.subObjetoSeleccionado()) {
      this.procesarMesh(selected, colorSelected, true);
    }
  }
}