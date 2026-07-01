// src/app/services/editor/toolsservice/tools-highlight.service.ts
import { Injectable, inject } from '@angular/core';
import { Color3, Color4, Mesh, AbstractMesh, Tags, HighlightLayer, Node } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { AuthService } from '../../../core/services/auth';
import { TriggerVisualizerService } from '../../../core/engine/scene/utils/trigger-visualizer.service';

@Injectable({ providedIn: 'root' })
export class ToolsHighlightService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private authSvc = inject(AuthService);
  private triggerVisualizer = inject(TriggerVisualizerService);

  private lastHoveredMeshId: number | null = null;
  private lastSelectedMeshId: number | null = null;
  private lastMode: string | null = null;

  private highlightLayer: HighlightLayer | null = null;
  private meshesConEdges: AbstractMesh[] = [];
  private highlightedTriggers: AbstractMesh[] = [];

  public initHighlights(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (!this.highlightLayer) {
      this.highlightLayer = new HighlightLayer("editor_highlights", scene, {
        isStroke: true, 
        mainTextureRatio: 1 
      });
      this.highlightLayer.blurHorizontalSize = 1.5;
      this.highlightLayer.blurVerticalSize = 1.5;
    }
  }

  private esMeshExcluida(mesh: AbstractMesh): boolean {
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

    const entity = baseNode instanceof AbstractMesh ? this.entityManager.getEntityByMesh(baseNode) : null;
    const entityUid = entity?.uid ?? null;

    const traverse = (node: Node) => {
      if (!node || node.isDisposed()) return;

      if (node instanceof AbstractMesh) {
        const e = this.entityManager.getEntityByMesh(node);
        if (e && entityUid && e.uid !== entityUid) {
          return; 
        }
        if (this.esRenderizable(node)) {
          meshes.add(node);
        }
      }

      node.getChildren().forEach(child => {
        traverse(child);
      });
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
    
    this.meshesConEdges.forEach(m => {
        if (m && !m.isDisposed()) {
            try { 
                m.disableEdgesRendering(); 
                m.showBoundingBox = false; 
                if ((m as any)._wasZeroVisibility) {
                    m.visibility = 0;
                    delete (m as any)._wasZeroVisibility;
                }
            } catch {}
        }
    });
    this.meshesConEdges = [];

    // 🔥 Limpiar el color hovereado/seleccionado de los Triggers sin destruir nada
    this.highlightedTriggers.forEach(m => {
        if (m && !m.isDisposed()) {
            this.triggerVisualizer.setHighlight(m, 'none');
        }
    });
    this.highlightedTriggers = [];
  }

  private aplicarOutline(mesh: AbstractMesh, colorHex: string, forceEdges: boolean = false): void {
    if (!mesh || mesh.isDisposed()) return;

    try {
      const isMaterialTransparent = mesh.material && (mesh.material.alpha === 0);

      // Usado para Spawns y Luces, NUNCA MÁS para Triggers
      if (forceEdges || !mesh.material || mesh.visibility < 0.01 || isMaterialTransparent) {
         if (mesh.visibility === 0) {
             mesh.visibility = 0.0001; 
             (mesh as any)._wasZeroVisibility = true;
         }
         mesh.enableEdgesRendering(0.9999);
         mesh.edgesWidth = 15.0; 
         const c3 = Color3.FromHexString(colorHex);
         mesh.edgesColor = new Color4(c3.r, c3.g, c3.b, 1.0);
         mesh.showBoundingBox = true;
         this.meshesConEdges.push(mesh);
      } else {
         if (this.highlightLayer) {
             this.highlightLayer.addMesh(mesh as Mesh, Color3.FromHexString(colorHex));
         }
      }
    } catch (e) {
        console.warn('[Highlight] Error al aplicar en', mesh.name, e);
    }
  }

  private procesarMesh(pickedMesh: AbstractMesh, colorHex: string, state: 'hover' | 'selected'): void {
    if (!pickedMesh || pickedMesh.isDisposed()) return;
    if (this.esMeshExcluida(pickedMesh)) return;

    const entity = this.entityManager.getEntityByMesh(pickedMesh);
    const isTrigger = entity?.type === 'trigger' || entity?.type === 'trigger_compuesto';
    
    // 🔥 OPTIMIZACIÓN EXTREMA: Ruta aislada, cero geometría extra generada.
    if (isTrigger) {
        this.triggerVisualizer.setHighlight(pickedMesh, state);
        this.highlightedTriggers.push(pickedMesh);
        return; 
    }

    const isSpawn = entity?.rol === 'spawn_point';
    const isLightMarker = entity?.type?.startsWith('light_') && !entity?.visual?.assetId;
    
    if (entity) {
      const esPiso = entity.type === 'plane';
      const mostrarBorde = entity.visual?.mostrarBorde;

      if (esPiso && mostrarBorde !== true) return;
      if (mostrarBorde === false) return; 
    }

    const forceEdges = isSpawn || isLightMarker;
    const meshesVisuales = this.recolectarMeshesVisuales(pickedMesh);
    
    if (meshesVisuales.length === 0) {
       if (this.esRenderizable(pickedMesh)) {
          this.aplicarOutline(pickedMesh, colorHex, forceEdges);
       }
    } else {
       meshesVisuales.forEach(m => this.aplicarOutline(m, colorHex, forceEdges));
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

    this.lastHoveredMeshId = hoverId;
    this.lastSelectedMeshId = selectId;
    this.lastMode = mode; 

    this.limpiarTodosLosEdges();

    const isAdmin = this.authSvc.isAdmin();
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    const isLiveEditorMode = mode === 'PLAYING' || mode === 'EDITING_IN_GAME';

    if (isLiveEditorMode && isFPS) {
        return; 
    }

    const puedeResaltar = mode === 'EDITOR' || mode === 'EDITING_IN_GAME' || (mode === 'PLAYING' && isAdmin);
    if (!puedeResaltar) return;

    const colorHover = '#3b82f6';   // Azul
    const colorSelected = '#facc15'; // Amarillo

    if (hovered && hovered !== selected) {
      this.procesarMesh(hovered, colorHover, 'hover');
    }

    if (selected && !this.state.subObjetoSeleccionado()) {
      this.procesarMesh(selected, colorSelected, 'selected');
    }
  }
}