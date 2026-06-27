// src/app/services/editor/toolsservice/tools-highlight.service.ts

import { Injectable, inject } from '@angular/core';
import { Color3, HighlightLayer, Mesh, Tags } from '@babylonjs/core';
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

  // Colección para limpiar rastros de bordes
  private meshesResaltadas: Mesh[] = [];
  
  // 🔥 NUEVO SISTEMA: HighlightLayer evita pintar las caras del modelo
  // y crea un borde perfecto (Stroke) exterior alrededor de la silueta.
  private highlightLayer: HighlightLayer | null = null;

  private getHighlightLayer(): HighlightLayer {
    if (!this.highlightLayer && this.motor3d.scene) {
      this.highlightLayer = new HighlightLayer("editorHighlightLayer", this.motor3d.scene, {
        isStroke: true, // Crea un borde sólido en lugar de difuminado
        mainTextureRatio: 2 // Mayor resolución para que el borde se vea nítido
      });
      this.highlightLayer.innerGlow = false; // 🔥 APAGA el brillo interno (No pinta caras)
      this.highlightLayer.outerGlow = true;  // Solo brillo externo
      this.highlightLayer.blurHorizontalSize = 3.0; // Grosor del borde (Auméntalo si quieres más grosor)
      this.highlightLayer.blurVerticalSize = 3.0;
    }
    return this.highlightLayer!;
  }

  public initHighlights(): void {
    if (this.motor3d.scene) {
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
      if (child instanceof Mesh) {
        agregarSiSirve(child);
      }
    });

    return Array.from(meshes);
  }

  private limpiarTodosLosEdges(): void {
    const hl = this.getHighlightLayer();
    if (hl) {
      hl.removeAllMeshes();
    }
    
    // Limpiamos los rastros del sistema anterior por seguridad
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

  private aplicarOutline(
    mesh: Mesh,
    color: Color3
  ): void {
    if (!mesh || mesh.isDisposed()) return;

    try {
      // Forzamos a apagar el sistema viejo para que NO pinte las paredes
      mesh.renderOutline = false; 
      mesh.disableEdgesRendering();

      // Aplicamos el borde externo limpio
      const hl = this.getHighlightLayer();
      if (hl && !hl.hasMesh(mesh)) {
        hl.addMesh(mesh, color);
        this.meshesResaltadas.push(mesh);
      }
    } catch {}
  }

  private procesarMesh(
    rootMesh: Mesh,
    colorHex: string
  ): void {
    if (!rootMesh || rootMesh.isDisposed()) return;
    if (this.esMeshExcluida(rootMesh)) return;

    const root = this.getTopMeshAncestor(rootMesh);
    const mode = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    const canHighlight =
      mode === 'EDITOR' ||
      mode === 'EDITING_IN_GAME' ||
      (mode === 'PLAYING' && isAdmin);

    if (!canHighlight) return;

    const color3 = Color3.FromHexString(colorHex);

    const meshesVisuales = this.recolectarMeshesVisuales(root);
    meshesVisuales.forEach(m => this.aplicarOutline(m, color3));
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

    this.limpiarTodosLosEdges();

    const mode = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    const puedeResaltar =
      mode === 'EDITOR' ||
      mode === 'EDITING_IN_GAME' ||
      (mode === 'PLAYING' && isAdmin);

    if (!puedeResaltar) return;

    const colorHover = '#3b82f6';   // Azul para Hover
    const colorSelected = '#fbbf24'; // Amarillo/Naranja para Selección

    if (hovered && hovered !== selected) {
      this.procesarMesh(hovered, colorHover);
    }

    if (selected && !this.state.subObjetoSeleccionado()) {
      this.procesarMesh(selected, colorSelected);
    }
  }
}