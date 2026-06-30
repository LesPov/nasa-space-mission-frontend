
import { Injectable, inject, computed } from '@angular/core';
import { Node, AbstractMesh, Mesh, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { InteractableRulesService } from '../../core/engine/runtime/rules/interactable-rules.service';
import { PlayState, GameMode } from '../../core/engine/session/game-mode.model';
import { ToolModeContext } from '../../core/engine/session/game-context.model';

export type ToolMode = ToolModeContext;
export type { PlayState };

@Injectable({ providedIn: 'root' })
export class EditorStateService {
  private entityManager = inject(EntityManagerService);
  private gameContext = inject(GameContextService);
  private interactRules = inject(InteractableRulesService);

  // ==========================================
  // FACHADA DE ESTADO (COMPUTED READONLY)
  // ==========================================

  public playState = computed<PlayState>(() => {
    if (this.gameContext.isTransitioning()) return 'TRANSITIONING';
    if (this.gameContext.isInteracting()) return 'INTERACTING';

    const mode = this.gameContext.mode();
    if (mode === GameMode.EDITOR) return 'EDITOR';
    if (mode === GameMode.EDITING_IN_GAME) return 'EDITING_IN_GAME';
    
    return 'PLAYING';
  });
  
  public currentTool = computed(() => this.gameContext.currentTool());
  public objetoSeleccionado = computed(() => this.gameContext.selectedNode());
  public subObjetoSeleccionado = computed(() => this.gameContext.subSelectedObject());
  public objetoInteractuado = computed(() => this.gameContext.interactedObject());
  public nodosEscena = computed(() => this.gameContext.sceneNodes());
  public ratonBloqueado = computed(() => this.gameContext.isPointerLocked());
  public showAddObjectModal = computed(() => this.gameContext.isAddObjectModalOpen());
  public objetoHovereado = computed(() => this.gameContext.hoveredObject());
  public fogDesactivadoTemporalmente = computed(() => this.gameContext.isFogDisabled());
  public previewMissionModal = computed(() => this.gameContext.isPreviewMissionModalOpen());

  // Compatibilidad con componentes legacy mediante Getters/Setters que mapean al SSOT
  public get modoVistaPrueba() { return this.gameContext.cameraView(); }
  public set modoVistaPrueba(val: any) { if (val) this.gameContext.setCameraView(val); }

  public get jugadorActivo() {
    const ent = this.gameContext.activePlayerEntity();
    return ent ? ent.view as Mesh : null;
  }

  // ==========================================
  // SETTERS DELEGADOS AL CONTEXTO (SSOT)
  // ==========================================

  public seleccionarObjeto(nodo: Node | null): void { 
    this.gameContext.setSelectedNode(nodo);
    this.gameContext.setSubSelectedObject(null);
  }

  public setSubObjetoSeleccionado(sub: 'collider' | 'camera' | 'light' | 'fog' | null): void { this.gameContext.setSubSelectedObject(sub); }
  public setObjetoInteractuado(nodo: Node | null): void { this.gameContext.setInteractedObject(nodo); }
  public setNodosEscena(nodos: Node[]): void { this.gameContext.setSceneNodes(nodos); }
  public setShowAddObjectModal(val: boolean): void { this.gameContext.setAddObjectModalOpen(val); }
  public setObjetoHovereado(mesh: AbstractMesh | null): void { this.gameContext.setHoveredObject(mesh); }
  public setFogDesactivadoTemporalmente(val: boolean): void { this.gameContext.setFogDisabled(val); }
  public setPreviewMissionModal(val: boolean): void { this.gameContext.setPreviewMissionModalOpen(val); }
  public setCurrentTool(tool: ToolMode): void { this.gameContext.setCurrentTool(tool); }

  // ==========================================
  // FUNCIONES PURAS DE LÓGICA DE INTERFAZ
  // ==========================================

  public isDescendant(child: Node, parent: Node): boolean {
    let current = child.parent;
    while (current) {
      if (current === parent) return true;
      current = current.parent;
    }
    return false;
  }

  public encontrarRaiz(mesh: AbstractMesh): Node | null {
    if (!mesh) return null;
    let current: Node | null = mesh;

    while (current) {
      if (current.name === '__root__') {
        current = current.parent;
        continue;
      }
      if (Tags.MatchesQuery(current, "system_element || editor_only || fog_element || debug_element || proxy_collider || invisible_floor")) {
        current = current.parent;
        continue;
      }
      const entity = this.entityManager.getEntityByMesh(current as AbstractMesh);
      if (entity) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  public resolverObjetoSeleccionable(mesh: AbstractMesh | null): AbstractMesh | null {
    return this.encontrarRaiz(mesh as AbstractMesh) as AbstractMesh | null;
  }

  public esMeshIgnorable(mesh: AbstractMesh | null | undefined): boolean {
    return this.interactRules.isMeshIgnorable(mesh as AbstractMesh, this.jugadorActivo);
  }

  public esObjetoObstructor = (mesh: AbstractMesh): boolean => {
    if (this.esMeshIgnorable(mesh)) return false;
    if (!mesh.isVisible) return false;
    return true;
  };

  public esObjetoInteractuable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh) return false;
    const entity = this.entityManager.getEntityByMesh(mesh);
    if (!entity) return false;
    return this.interactRules.isInteractable(entity);
  }

  public puedeSeleccionarse(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.esMeshIgnorable(mesh)) return false;

    const root = this.resolverObjetoSeleccionable(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    
    if (this.gameContext.isPlaying() || this.playState() === 'INTERACTING') {
      return this.esObjetoInteractuable(nodoBase);
    }
    
    return this.interactRules.canSelectInEditor(nodoBase);
  }

  public limpiarEstado(): void {
    this.gameContext.setHoveredObject(null);
    this.gameContext.setInteractedObject(null);
    this.gameContext.setSelectedNode(null);
    this.gameContext.setSubSelectedObject(null);
    this.gameContext.setFogDisabled(false);
    this.gameContext.setPreviewMissionModalOpen(false);
  }
}