import { Injectable, inject } from '@angular/core';
import { Color3, HighlightLayer, Mesh, Tags } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class ToolsHighlightService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);

  public hlHover!: HighlightLayer;
  public hlSelected!: HighlightLayer;

  private lastHoveredMeshId: number | null = null;
  private lastSelectedMeshId: number | null = null;

  private edgesHovered: Mesh[] = [];
  private edgesSelected: Mesh[] = [];
  private outlinedHovered: Mesh[] = [];
  private outlinedSelected: Mesh[] = [];

  public initHighlights(): void {
    const scene = this.motor3d.scene;

    this.hlHover = new HighlightLayer('hlHover', scene, {
      isStroke: true,
      mainTextureRatio: 1,
    });
    this.hlHover.blurHorizontalSize = 0.8;
    this.hlHover.blurVerticalSize = 0.8;
    this.hlHover.innerGlow = false;

    this.hlSelected = new HighlightLayer('hlSelected', scene, {
      isStroke: true,
      mainTextureRatio: 1,
    });
    this.hlSelected.blurHorizontalSize = 1.0;
    this.hlSelected.blurVerticalSize = 1.0;
    this.hlSelected.innerGlow = false;
  }

  private esMeshExcluida(mesh: Mesh): boolean {
    const n = mesh.name?.toLowerCase?.() ?? '';
    return (
      Tags.MatchesQuery(mesh, 'fog_element || debug_element || editor_only || system_element || proxy_collider') ||
      n.includes('proxycol') ||
      n.includes('collider') ||
      n.includes('gizmo') ||
      n.includes('highlight') ||
      n.includes('camerapivot')
    );
  }

  private esTransparenteVirtual(entityType?: string): boolean {
    if (!entityType) return false;
    return (
      ['trigger', 'trigger_compuesto', 'bubble', 'image_plane', 'video_plane'].includes(entityType) ||
      entityType.startsWith('light_')
    );
  }

  private limpiarEdges(): void {
    this.edgesHovered.forEach(m => {
      if (m && !m.isDisposed()) {
        try {
          m.disableEdgesRendering();
        } catch {}
      }
    });

    this.edgesSelected.forEach(m => {
      if (m && !m.isDisposed()) {
        try {
          m.disableEdgesRendering();
        } catch {}
      }
    });

    this.edgesHovered = [];
    this.edgesSelected = [];
  }

  private limpiarOutlines(): void {
    this.outlinedHovered.forEach(m => {
      if (m && !m.isDisposed()) {
        m.renderOutline = false;
      }
    });

    this.outlinedSelected.forEach(m => {
      if (m && !m.isDisposed()) {
        m.renderOutline = false;
      }
    });

    this.outlinedHovered = [];
    this.outlinedSelected = [];
  }

  private getCameraDistanceToMesh(mesh: Mesh): number {
    const cam = this.motor3d.scene.activeCamera;
    if (!cam) return 0;

    const camPos = cam.globalPosition ?? cam.position;
    const center =
      mesh.getBoundingInfo().boundingSphere.centerWorld ??
      mesh.getAbsolutePosition();

    if (!camPos || !center) return 0;

    return center.subtract(camPos).length();
  }

  private calcularEdgeWidth(mesh: Mesh, isSelected: boolean): number {
    const dist = this.getCameraDistanceToMesh(mesh);

    const boundsRadius = Math.max(
      0.5,
      mesh.getBoundingInfo()?.boundingSphere?.radiusWorld || 1
    );

    // Normaliza según el tamaño del objeto:
    // un objeto pequeño lejos necesita más grosor para seguir viéndose.
    const normalizedDist = dist / Math.max(1, boundsRadius * 6);

    const base = isSelected ? 2.4 : 1.5;

    // Más agresivo cuando está lejos, más suave cuando está cerca.
    const factor = 1 + Math.min(5, normalizedDist * 0.45);

    const width = base * factor;

    return Math.min(isSelected ? 6.0 : 4.5, Math.max(isSelected ? 2.1 : 1.15, width));
  }

  private calcularOutlineWidth(mesh: Mesh, isSelected: boolean): number {
    const dist = this.getCameraDistanceToMesh(mesh);

    const boundsRadius = Math.max(
      0.5,
      mesh.getBoundingInfo()?.boundingSphere?.radiusWorld || 1
    );

    const normalizedDist = dist / Math.max(1, boundsRadius * 6);

    const base = isSelected ? 0.085 : 0.055;
    const factor = 1 + Math.min(4, normalizedDist * 0.4);
    const width = base * factor;

    return Math.min(isSelected ? 0.24 : 0.18, Math.max(isSelected ? 0.08 : 0.045, width));
  }

  private getTopMeshAncestor(mesh: Mesh): Mesh {
    let current: Mesh = mesh;

    while (current.parent instanceof Mesh) {
      current = current.parent;
    }

    return current;
  }

  private esModelo3D(root: Mesh): boolean {
    if (!root || root.isDisposed()) return false;

    const hijos = root.getChildMeshes(false);
    const tieneHijosConGeometria = hijos.some(h => h instanceof Mesh && h.getTotalVertices() > 0);

    return root.getTotalVertices() === 0 && tieneHijosConGeometria;
  }

  private recolectarMeshesVisuales(root: Mesh): Mesh[] {
    const meshes = new Set<Mesh>();

    if (!root || root.isDisposed()) return [];

    const entity = this.entityManager.getEntityByMesh(root);
    const entityUid = entity?.uid ?? null;

    const agregarSiSirve = (m: Mesh) => {
      if (!m || m.isDisposed()) return;
      if (!m.isVisible) return;
      if (this.esMeshExcluida(m)) return;

      const e = this.entityManager.getEntityByMesh(m);
      if (e && entityUid && e.uid !== entityUid) return;

      if (m.getTotalVertices() > 0) {
        meshes.add(m);
      }
    };

    agregarSiSirve(root);

    root.getChildMeshes(false).forEach(child => {
      if (child instanceof Mesh) {
        agregarSiSirve(child);
      }
    });

    return Array.from(meshes);
  }

  private aplicarEdges(mesh: Mesh, color: Color3, isSelected: boolean): void {
    if (!mesh || mesh.isDisposed()) return;

    try {
      mesh.enableEdgesRendering();
      mesh.edgesWidth = this.calcularEdgeWidth(mesh, isSelected);
      mesh.edgesColor = color.toColor4(1);

      if (isSelected) {
        this.edgesSelected.push(mesh);
      } else {
        this.edgesHovered.push(mesh);
      }
    } catch {
      // ignorar
    }
  }

  private aplicarOutline(mesh: Mesh, color: Color3, isSelected: boolean): void {
    if (!mesh || mesh.isDisposed()) return;

    try {
      mesh.renderOutline = true;
      mesh.outlineColor = color;
      mesh.outlineWidth = this.calcularOutlineWidth(mesh, isSelected);

      if (isSelected) {
        this.outlinedSelected.push(mesh);
      } else {
        this.outlinedHovered.push(mesh);
      }
    } catch {
      // ignorar
    }
  }

  private procesarMesh(rootMesh: Mesh, color: Color3, isSelected: boolean): void {
    if (!rootMesh || rootMesh.isDisposed()) return;
    if (!rootMesh.isVisible) return;
    if (this.esMeshExcluida(rootMesh)) return;

    const root = this.getTopMeshAncestor(rootMesh);
    const entity = this.entityManager.getEntityByMesh(root) ?? this.entityManager.getEntityByMesh(rootMesh);
    const isTrigger = entity?.type === 'trigger' || entity?.type === 'trigger_compuesto';

    const mode = this.state.playState();
    const isAdmin = this.state.checkIsAdmin();

    const canHighlight = mode === 'EDITOR' || isAdmin || !isTrigger;
    if (!canHighlight) return;

    const isVirtualTransparent = this.esTransparenteVirtual(entity?.type);
    const esModelo = this.esModelo3D(root);

    const meshesVisuales = this.recolectarMeshesVisuales(root);

    if (esModelo) {
      meshesVisuales.forEach(m => this.aplicarOutline(m, color, isSelected || isVirtualTransparent));
    } else {
      meshesVisuales.forEach(m => this.aplicarEdges(m, color, isSelected || isVirtualTransparent));
    }
  }

  public actualizarHighlights(selected: Mesh | null, hovered: Mesh | null): void {
    if (!this.hlHover || !this.hlSelected) return;

    const hoverId = hovered ? hovered.uniqueId : null;
    const selectId = selected ? selected.uniqueId : null;

    if (this.lastHoveredMeshId === hoverId && this.lastSelectedMeshId === selectId) {
      return;
    }

    this.lastHoveredMeshId = hoverId;
    this.lastSelectedMeshId = selectId;

    this.hlHover.removeAllMeshes();
    this.hlSelected.removeAllMeshes();
    this.limpiarEdges();
    this.limpiarOutlines();

    this.motor3d.scene.meshes.forEach(m => {
      if (m instanceof Mesh && this.esMeshExcluida(m)) {
        try {
          this.hlHover.addExcludedMesh(m);
          this.hlSelected.addExcludedMesh(m);
        } catch {}
      }
    });

    const mode = this.state.playState();
    const isAdmin = this.state.checkIsAdmin();

    const puedeResaltar =
      mode === 'EDITOR' ||
      mode === 'EDITING_IN_GAME' ||
      (mode === 'PLAYING' && isAdmin);

    if (!puedeResaltar) return;

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    if (hovered && hovered !== selected) {
      this.procesarMesh(hovered, colorHover, false);
    }

    if (selected && !this.state.subObjetoSeleccionado()) {
      this.procesarMesh(selected, colorSelected, true);
    }
  }
}