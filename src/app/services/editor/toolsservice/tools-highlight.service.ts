
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

    this.motor3d.scene.meshes.forEach(m => {
      if (Tags.MatchesQuery(m, "fog_element || debug_element || editor_only")) {
        try {
          this.hlHover.addExcludedMesh(m as Mesh);
          this.hlSelected.addExcludedMesh(m as Mesh);
        } catch (e) {}
      }
    });

    const mode = this.state.playState();
    const isAdmin = this.state.checkIsAdmin();

    if (mode !== 'EDITOR' && mode !== 'EDITING_IN_GAME' && !(mode === 'PLAYING' && isAdmin)) return;

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    const addHighlightToAllVisible = (mesh: Mesh, hl: HighlightLayer, color: Color3) => {
      if (Tags.MatchesQuery(mesh, "fog_element || debug_element || editor_only || system_element")) return;

      const entity = this.entityManager.getEntityByMesh(mesh);
      const isTrigger = entity?.type === 'trigger' || entity?.type === 'trigger_compuesto';
      
      const canHighlight = mode === 'EDITOR' || isAdmin || !isTrigger;

      if (mesh.isVisible && canHighlight) {
        hl.addMesh(mesh, color);
      }
      
      mesh.getChildMeshes().forEach(c => {
        if (!c.isVisible || Tags.MatchesQuery(c, "proxy_collider || debug_element || fog_element || editor_only || system_element")) return;

        const cEntity = this.entityManager.getEntityByMesh(c);
        
        if (cEntity && cEntity.uid !== entity?.uid) {
            return; 
        }

        const childIsTrigger = cEntity?.type === 'trigger' || cEntity?.type === 'trigger_compuesto';
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