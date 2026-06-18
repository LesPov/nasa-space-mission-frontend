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
      const n = mesh.name.toLowerCase();
      // 🔥 FIX: Jamás aplicarle Outline a las capas de niebla volumétrica
      if (n.includes('fogshell') || n.includes('fogwallgroup')) return;

      const entity = this.entityManager.getEntityByMesh(mesh);
      const isTrigger = entity?.type === 'trigger' || entity?.type === 'trigger_compuesto' || n.includes('trigger');
      
      const canHighlight = mode === 'EDITOR' || isAdmin || !isTrigger;

      if (mesh.isVisible && !n.includes('proxycol') && !n.includes('debug') && !n.includes('camerapivot') && canHighlight) {
        hl.addMesh(mesh, color);
      }
      
      mesh.getChildMeshes().forEach(c => {
        const cn = c.name.toLowerCase();
        // 🔥 FIX HIJOS: Lo mismo para los hijos de la niebla
        if (!c.isVisible || cn.includes('proxycol') || cn.includes('debug') || cn.includes('camerapivot') || cn.includes('fogshell') || cn.includes('fogwallgroup')) return;

        const cEntity = this.entityManager.getEntityByMesh(c);
        
        // 🔥 FIX VITAL: Si el hijo pertenece a OTRA entidad (ej. un cofre encima del piso), NO LO RESALTES!
        if (cEntity && cEntity.uid !== entity?.uid) {
            return; 
        }

        const childIsTrigger = cEntity?.type === 'trigger' || cEntity?.type === 'trigger_compuesto' || cn.includes('trigger');
        const childCanHighlight = mode === 'EDITOR' || isAdmin || !childIsTrigger;

        if (c instanceof Mesh && childCanHighlight) {
          hl.addMesh(c, color);
        }
      });
    };

    if (hovered && hovered !== selected) addHighlightToAllVisible(hovered, this.hlHover, colorHover);
    if (selected && !this.state.subObjetoSeleccionado()) addHighlightToAllVisible(selected, this.hlSelected, colorSelected);
  }
}