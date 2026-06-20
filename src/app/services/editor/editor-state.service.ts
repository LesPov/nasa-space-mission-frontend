
import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Node, AbstractMesh, Mesh, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { InteractableRulesService } from '../../core/engine/runtime/rules/interactable-rules.service';
 
export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export type PlayState = 'EDITOR' | 'PLAYING' | 'EDITING_IN_GAME' | 'TRANSITIONING' | 'INTERACTING';

@Injectable({ providedIn: 'root' })
export class EditorStateService {
  private entityManager = inject(EntityManagerService);
  private gameContext = inject(GameContextService);
  private interactRules = inject(InteractableRulesService);

  public playState = signal<PlayState>('EDITOR');
  public currentTool = signal<ToolMode>('translate');

  public objetoSeleccionado = signal<Node | null>(null);
  public subObjetoSeleccionado = signal<'collider' | 'camera' | 'light' | 'fog' | null>(null);

  public objetoInteractuado = signal<any>(null);
  public nodosEscena = signal<Node[]>([]);

  public ratonBloqueado = signal<boolean>(false);
  public showAddObjectModal = signal<boolean>(false);
  public objetoHovereado = signal<AbstractMesh | null>(null);

  public fogDesactivadoTemporalmente = signal<boolean>(false);
  public previewMissionModal = signal<boolean>(false);

  public onMapChanged = new Subject<void>();
  public onGizmoDrag = new Subject<void>();

  public modoVistaPrueba: 'FPS' | 'TPS' | null = null;
  public jugadorActivo: Mesh | null = null;

  triggerUpdate(): void {
    this.onMapChanged.next();
  }

  checkIsAdmin(): boolean {
    const userStr = localStorage.getItem('user');
    if (!userStr) return false;
    try {
      const user = JSON.parse(userStr);
      return user?.rol === 'admin';
    } catch {
      return false;
    }
  }

  isDescendant(child: Node, parent: Node): boolean {
    let current = child.parent;
    while (current) {
      if (current === parent) return true;
      current = current.parent;
    }
    return false;
  }

  encontrarRaiz(mesh: AbstractMesh): Node | null {
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

  resolverObjetoSeleccionable(mesh: AbstractMesh | null): AbstractMesh | null {
    return this.encontrarRaiz(mesh as AbstractMesh) as AbstractMesh | null;
  }

  esMeshIgnorable(mesh: AbstractMesh | null | undefined): boolean {
    return this.interactRules.isMeshIgnorable(mesh as AbstractMesh, this.jugadorActivo);
  }

  esObjetoObstructor = (mesh: AbstractMesh): boolean => {
    if (this.esMeshIgnorable(mesh)) return false;
    if (!mesh.isVisible) return false;
    return true;
  };

  esObjetoInteractuable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh) return false;
    const entity = this.entityManager.getEntityByMesh(mesh);
    if (!entity) return false;
    return this.interactRules.isInteractable(entity);
  }

  puedeSeleccionarse(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.esMeshIgnorable(mesh)) return false;

    const root = this.resolverObjetoSeleccionable(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    
    if (this.gameContext.isPlaying() || this.playState() === 'INTERACTING') {
      return this.esObjetoInteractuable(nodoBase);
    }
    
    return this.interactRules.canSelectInEditor(nodoBase);
  }

  limpiarEstado(): void {
    this.playState.set('EDITOR');
    this.modoVistaPrueba = null;
    this.jugadorActivo = null;
    this.objetoHovereado.set(null);
    this.objetoInteractuado.set(null);
    this.ratonBloqueado.set(false);
    this.objetoSeleccionado.set(null);
    this.subObjetoSeleccionado.set(null);
    this.fogDesactivadoTemporalmente.set(false);
    this.previewMissionModal.set(false); 
  }
}