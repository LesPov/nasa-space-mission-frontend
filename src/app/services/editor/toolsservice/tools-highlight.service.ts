
import { Injectable, inject } from '@angular/core';
import { Color3, Color4, Mesh, AbstractMesh, Tags, HighlightLayer, Node, Scene } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { TriggerVisualizerService } from '../../../core/engine/scene/utils/trigger-visualizer.service';
import { GameContextService } from '../../../core/engine/session/game-context.service';
import { LightVisualVisibilityService } from '../../../core/engine/scene/utils/light-visual-visibility.service';

interface HighlightState {
  color: string;
  forceEdges: boolean;
  state: 'hover' | 'selected';
}

@Injectable({ providedIn: 'root' })
export class ToolsHighlightService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private triggerVisualizer = inject(TriggerVisualizerService);
  private gameContext = inject(GameContextService);
  private lightVisualSvc = inject(LightVisualVisibilityService);

  private lastHoveredMeshId: number | null = null;
  private lastSelectedMeshId: number | null = null;
  private lastMode: string | null = null;

  private highlightLayer: HighlightLayer | null = null;
  private currentScene: Scene | null = null;

  // 🔥 FASE 4 FIX: Estado Diferencial (Diffing)
  private activeHighlights = new Map<AbstractMesh, HighlightState>();
  private activeTriggers = new Map<AbstractMesh, 'hover' | 'selected'>();

  public initHighlights(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (this.highlightLayer && this.currentScene !== scene) {
      this.highlightLayer.dispose();
      this.highlightLayer = null;
    }

    if (!this.highlightLayer) {
      this.highlightLayer = new HighlightLayer("editor_highlights", scene, {
        isStroke: true, 
        mainTextureRatio: 1 
      });
      this.highlightLayer.blurHorizontalSize = 1.5;
      this.highlightLayer.blurVerticalSize = 1.5;
      this.currentScene = scene;
    }
  }

  public dispose(): void {
    if (this.highlightLayer) {
      this.highlightLayer.dispose();
      this.highlightLayer = null;
    }
    this.currentScene = null;
    this.activeHighlights.clear();
    this.activeTriggers.clear();
    this.lastHoveredMeshId = null;
    this.lastSelectedMeshId = null;
    this.lastMode = null;
    this.lightVisualSvc.hideAll();
  }

  public forceResetLightVisuals(): void {
    this.lightVisualSvc.syncAllLightVisuals(this.state.objetoSeleccionado());
    this.limpiarTodosLosEdges();
  }

  private esMeshExcluida(mesh: AbstractMesh): boolean {
    if (Tags.MatchesQuery(mesh, "light_visual") || (mesh as any).metadata?.isLightVisual) {
      return false;
    }
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
      n.includes('camerapivot') ||
      n.includes('sueloinvisible')
    );
  }

  private recolectarMeshesVisuales(baseNode: Node): AbstractMesh[] {
    const meshes = new Set<AbstractMesh>();
    if (!baseNode || baseNode.isDisposed()) return [];

    if (baseNode instanceof AbstractMesh && (Tags.MatchesQuery(baseNode, "light_visual") || (baseNode as any).metadata?.isLightVisual)) {
      meshes.add(baseNode);
      return Array.from(meshes);
    }

    const entity = baseNode instanceof AbstractMesh ? this.entityManager.getEntityByMesh(baseNode) : null;
    const entityUid = entity?.uid ?? null;

    const traverse = (node: Node) => {
      if (!node || node.isDisposed()) return;

      if (node instanceof AbstractMesh) {
        if (Tags.MatchesQuery(node, "light_visual") || (node as any).metadata?.isLightVisual) {
          return;
        }
        const e = this.entityManager.getEntityByMesh(node);
        if (e && entityUid && e.uid !== entityUid) {
          return; 
        }
        if (this.esRenderizable(node)) {
          meshes.add(node);
        }
      }
      node.getChildren().forEach(child => traverse(child));
    };

    if (entity && entity.view) {
      traverse(entity.view);
    } else {
      traverse(baseNode);
    }

    return Array.from(meshes);
  }

  private esRenderizable(node: AbstractMesh): boolean {
    if (this.esMeshExcluida(node)) return false;
    
    const className = node.getClassName();
    if (className === "Mesh" || className === "InstancedMesh") {
      if (className === "InstancedMesh") {
        const source = (node as any).sourceMesh;
        return source && source.getTotalVertices() > 0;
      }
      return (node as Mesh).getTotalVertices() > 0;
    }
    return false;
  }

  private limpiarTodosLosEdges(): void {
    if (this.highlightLayer) {
      this.highlightLayer.removeAllMeshes();
    }
    
    for (const [mesh, oldState] of this.activeHighlights.entries()) {
        if (!mesh.isDisposed()) {
            this.removerOutline(mesh, oldState.forceEdges);
        }
    }
    this.activeHighlights.clear();

    for (const [mesh, _] of this.activeTriggers.entries()) {
      if (!mesh.isDisposed()) {
        this.triggerVisualizer.setHighlight(mesh, 'none');
      }
    }
    this.activeTriggers.clear();
  }

  private aplicarOutline(mesh: AbstractMesh, colorHex: string, forceEdges: boolean): void {
    if (!mesh || mesh.isDisposed()) return;

    try {
      const isLightVisual = Tags.MatchesQuery(mesh, "light_visual") || (mesh as any).metadata?.isLightVisual;
      const isMaterialTransparent = mesh.material && (mesh.material.alpha === 0);

      if (!isLightVisual && (forceEdges || !mesh.material || mesh.visibility < 0.01 || isMaterialTransparent)) {
        if (mesh.visibility === 0) {
          mesh.visibility = 0.0001; 
          (mesh as any)._wasZeroVisibility = true;
        }
        mesh.enableEdgesRendering(0.9999);
        mesh.edgesWidth = 15.0; 
        const c3 = Color3.FromHexString(colorHex);
        mesh.edgesColor = new Color4(c3.r, c3.g, c3.b, 1.0);
        mesh.showBoundingBox = true;
      } else {
        if (this.highlightLayer) {
          this.highlightLayer.addMesh(mesh as Mesh, Color3.FromHexString(colorHex));
        }
      }
    } catch (e) {
      console.warn('[Highlight] Error al aplicar en', mesh.name, e);
    }
  }

  private removerOutline(mesh: AbstractMesh, wasForcedEdges: boolean): void {
      if (mesh.isDisposed()) return;
      
      const isLightVisual = Tags.MatchesQuery(mesh, "light_visual") || (mesh as any).metadata?.isLightVisual;
      const isMaterialTransparent = mesh.material && (mesh.material.alpha === 0);

      if (!isLightVisual && (wasForcedEdges || !mesh.material || mesh.visibility < 0.01 || isMaterialTransparent)) {
          mesh.disableEdgesRendering();
          mesh.showBoundingBox = false;
          if ((mesh as any)._wasZeroVisibility) {
              mesh.visibility = 0;
              delete (mesh as any)._wasZeroVisibility;
          }
      } else {
          if (this.highlightLayer) {
              this.highlightLayer.removeMesh(mesh as Mesh);
          }
      }
  }

  private computeDesiredState(
    pickedMesh: AbstractMesh, colorHex: string, state: 'hover' | 'selected',
    desiredHighlights: Map<AbstractMesh, HighlightState>,
    desiredTriggers: Map<AbstractMesh, 'hover' | 'selected'>
  ): void {
    if (pickedMesh.isDisposed()) return;
    if (this.esMeshExcluida(pickedMesh)) return;

    if (Tags.MatchesQuery(pickedMesh, "light_visual") || (pickedMesh as any).metadata?.isLightVisual) {
      if (pickedMesh.isVisible) {
        desiredHighlights.set(pickedMesh, { color: colorHex, forceEdges: false, state });
      }
      return;
    }

    const entity = this.entityManager.getEntityByMesh(pickedMesh);
    const isTrigger = entity?.type === 'trigger' || entity?.type === 'trigger_compuesto';
    
    if (isTrigger) {
      desiredTriggers.set(pickedMesh, state);
      return; 
    }

    const isSpawn = entity?.rol === 'spawn_point';
    
    if (entity) {
      const esPiso = entity.type === 'plane';
      const mostrarBorde = entity.visual?.mostrarBorde;
      if (esPiso && mostrarBorde !== true) return;
      if (mostrarBorde === false) return; 
    }

    const forceEdges = isSpawn;
    const meshesVisuales = this.recolectarMeshesVisuales(pickedMesh);
    
    if (meshesVisuales.length === 0) {
      if (this.esRenderizable(pickedMesh)) {
        desiredHighlights.set(pickedMesh, { color: colorHex, forceEdges, state });
      }
    } else {
      meshesVisuales.forEach(m => {
          desiredHighlights.set(m, { color: colorHex, forceEdges, state });
      });
    }
  }

  public actualizarHighlights(selected: AbstractMesh | null, hovered: AbstractMesh | null): void {
    const hoverId = hovered ? hovered.uniqueId : null;
    const selectId = selected ? selected.uniqueId : null;
    const mode = this.state.playState();

    if (this.lastHoveredMeshId === hoverId && 
        this.lastSelectedMeshId === selectId && 
        this.lastMode === mode) {
      return;
    }

    if (this.lastSelectedMeshId !== selectId) {
        this.lightVisualSvc.syncAllLightVisuals(selected);
    }

    this.lastHoveredMeshId = hoverId;
    this.lastSelectedMeshId = selectId;
    this.lastMode = mode; 

    const canSelectHidden = this.gameContext.authorityProfile().canSelectHidden;
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    const isPlayingMode = mode === 'PLAYING';

    if (isPlayingMode && isFPS && !canSelectHidden) {
        this.limpiarTodosLosEdges();
        return;
    }

    const puedeResaltar = mode === 'EDITOR' || mode === 'EDITING_IN_GAME' || (isPlayingMode && canSelectHidden);
    if (!puedeResaltar) {
        this.limpiarTodosLosEdges();
        return;
    }

    const colorHover = '#3b82f6';   
    const colorSelected = '#facc15'; 

    const desiredHighlights = new Map<AbstractMesh, HighlightState>();
    const desiredTriggers = new Map<AbstractMesh, 'hover' | 'selected'>();

    // Computar Estado Deseado Total
    if (hovered && hovered !== selected) {
      this.computeDesiredState(hovered, colorHover, 'hover', desiredHighlights, desiredTriggers);
    }
    if (selected && !this.state.subObjetoSeleccionado()) {
      this.computeDesiredState(selected, colorSelected, 'selected', desiredHighlights, desiredTriggers);
    }

    // 🔥 Algoritmo Diferencial para Triggers
    for (const [mesh, oldState] of this.activeTriggers.entries()) {
        if (!desiredTriggers.has(mesh)) {
            this.triggerVisualizer.setHighlight(mesh, 'none');
            this.activeTriggers.delete(mesh);
        } else if (desiredTriggers.get(mesh) !== oldState) {
            this.triggerVisualizer.setHighlight(mesh, desiredTriggers.get(mesh)!);
            this.activeTriggers.set(mesh, desiredTriggers.get(mesh)!);
        }
    }
    for (const [mesh, newState] of desiredTriggers.entries()) {
        if (!this.activeTriggers.has(mesh)) {
            this.triggerVisualizer.setHighlight(mesh, newState);
            this.activeTriggers.set(mesh, newState);
        }
    }

    // 🔥 Algoritmo Diferencial para Oultines (El Salvavidas de FPS)
    for (const [mesh, oldState] of this.activeHighlights.entries()) {
        const newState = desiredHighlights.get(mesh);
        if (!newState) {
            this.removerOutline(mesh, oldState.forceEdges);
            this.activeHighlights.delete(mesh);
        } else if (newState.color !== oldState.color || newState.forceEdges !== oldState.forceEdges) {
            this.removerOutline(mesh, oldState.forceEdges);
            this.aplicarOutline(mesh, newState.color, newState.forceEdges);
            this.activeHighlights.set(mesh, newState);
        }
    }

    for (const [mesh, newState] of desiredHighlights.entries()) {
        if (!this.activeHighlights.has(mesh)) {
            this.aplicarOutline(mesh, newState.color, newState.forceEdges);
            this.activeHighlights.set(mesh, newState);
        }
    }
  }
}