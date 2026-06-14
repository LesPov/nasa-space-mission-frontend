import { Injectable, inject } from '@angular/core';
import { Color3, HighlightLayer, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsHighlightService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  public hlHover!: HighlightLayer;
  public hlSelected!: HighlightLayer;

  private lastHoveredMesh: Mesh | null = null;
  private lastSelectedMesh: Mesh | null = null;

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

    if (this.lastHoveredMesh === hovered && this.lastSelectedMesh === selected) return;
    
    this.lastHoveredMesh = hovered;
    this.lastSelectedMesh = selected;

    this.hlHover.removeAllMeshes();
    this.hlSelected.removeAllMeshes();

    const mode = this.state.playState();
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (mode !== 'EDITOR' && mode !== 'EDITING_IN_GAME' && !(mode === 'PLAYING' && isAdmin)) return;
    if (!isAdmin && (mode === 'EDITOR' || mode === 'EDITING_IN_GAME')) return;

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    const addHighlightToAllVisible = (mesh: Mesh, hl: HighlightLayer, color: Color3) => {
      const isTrigger = mesh.metadata?.type === 'trigger' || mesh.name.toLowerCase().includes('trigger');
      // 🔥 LÓGICA DE PRESELECCIÓN: Los triggers solo se iluminan en MODO EDITOR puro.
      const canHighlight = mode === 'EDITOR' || !isTrigger;

      if (mesh.isVisible && !mesh.name.includes('proxyCol') && !mesh.name.includes('debug') && !mesh.name.includes('cameraPivot') && canHighlight) {
        hl.addMesh(mesh, color);
      }
      mesh.getChildMeshes().forEach(c => {
        const childIsTrigger = c.metadata?.type === 'trigger' || c.name.toLowerCase().includes('trigger');
        const childCanHighlight = mode === 'EDITOR' || !childIsTrigger;

        if (c instanceof Mesh && c.isVisible && !c.name.includes('proxyCol') && !c.name.includes('debug') && !c.name.includes('cameraPivot') && childCanHighlight) {
          hl.addMesh(c, color);
        }
      });
    };

    if (hovered && hovered !== selected) addHighlightToAllVisible(hovered, this.hlHover, colorHover);
    if (selected && !this.state.subObjetoSeleccionado()) addHighlightToAllVisible(selected, this.hlSelected, colorSelected);
  }
}