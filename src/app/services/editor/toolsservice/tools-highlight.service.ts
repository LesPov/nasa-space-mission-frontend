import { Injectable, inject } from '@angular/core';
import { Color3, HighlightLayer, Mesh } from '@babylonjs/core';
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

  public initHighlights(): void {
    const scene = this.motor3d.scene;
    this.hlHover = new HighlightLayer('hlHover', scene, { isStroke: true, mainTextureRatio: 2 });
    this.hlHover.blurHorizontalSize = 1.0;
    this.hlHover.blurVerticalSize = 1.0;
    this.hlHover.innerGlow = false;

    this.hlSelected = new HighlightLayer('hlSelected', scene, { isStroke: true, mainTextureRatio: 2 });
    this.hlSelected.blurHorizontalSize = 2.0;
    this.hlSelected.blurVerticalSize = 2.0;
    this.hlSelected.innerGlow = false;
  }

  public actualizarHighlights(selected: Mesh | null, hovered: Mesh | null): void {
    if (!this.hlHover || !this.hlSelected) return;

    const hoverId = hovered ? hovered.uniqueId : null;
    const selectId = selected ? selected.uniqueId : null;

    // CULLING DE CPU: Evita recomputar si seguimos mirando el mismo objeto.
    if (this.lastHoveredMeshId === hoverId && this.lastSelectedMeshId === selectId) return;
    
    this.lastHoveredMeshId = hoverId;
    this.lastSelectedMeshId = selectId;

    this.hlHover.removeAllMeshes();
    this.hlSelected.removeAllMeshes();

    const mode = this.state.playState();
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (mode !== 'EDITOR' && mode !== 'EDITING_IN_GAME' && !(mode === 'PLAYING' && isAdmin)) return;
    if (!isAdmin && (mode === 'EDITOR' || mode === 'EDITING_IN_GAME')) return;

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    const addHighlightToAllVisible = (mesh: Mesh, hl: HighlightLayer, color: Color3) => {
      const entity = this.entityManager.getEntityByMesh(mesh);
      const isTrigger = entity?.type === 'trigger' || mesh.name.toLowerCase().includes('trigger');
      
      const canHighlight = mode === 'EDITOR' || !isTrigger;

      if (mesh.isVisible && !mesh.name.includes('proxyCol') && !mesh.name.includes('debug') && !mesh.name.includes('cameraPivot') && canHighlight) {
        hl.addMesh(mesh, color);
      }
      
      mesh.getChildMeshes().forEach(c => {
        if (!c.isVisible || c.name.includes('proxyCol') || c.name.includes('debug') || c.name.includes('cameraPivot')) return;

        const cEntity = this.entityManager.getEntityByMesh(c);
        const childIsTrigger = cEntity?.type === 'trigger' || c.name.toLowerCase().includes('trigger');
        const childCanHighlight = mode === 'EDITOR' || !childIsTrigger;

        if (c instanceof Mesh && childCanHighlight) {
          hl.addMesh(c, color);
        }
      });
    };

    if (hovered && hovered !== selected) addHighlightToAllVisible(hovered, this.hlHover, colorHover);
    if (selected && !this.state.subObjetoSeleccionado()) addHighlightToAllVisible(selected, this.hlSelected, colorSelected);
  }
}