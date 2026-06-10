
import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Node, AbstractMesh, Mesh, Vector3, Quaternion } from '@babylonjs/core';

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export type PlayState = 'EDITOR' | 'PLAYING' | 'EDITING_IN_GAME' | 'TRANSITIONING' | 'INTERACTING';

@Injectable({ providedIn: 'root' })
export class EditorStateService {
  public playState = signal<PlayState>('EDITOR');
  public rolSimulado = signal<'admin' | 'user'>('admin');
  public currentTool = signal<ToolMode>('translate');

  public objetoSeleccionado = signal<Node | null>(null);
  public subObjetoSeleccionado = signal<'collider' | 'camera' | null>(null);

  public objetoInteractuado = signal<any>(null);
  public nodosEscena = signal<Node[]>([]);

  public mirandoObjetoInteractuable = signal<boolean>(false);
  public ratonBloqueado = signal<boolean>(false);
  public showAddObjectModal = signal<boolean>(false);
  public objetoHovereado = signal<AbstractMesh | null>(null);

  public onMapChanged = new Subject<void>();
  public onGizmoDrag = new Subject<void>();

  public modoVistaPrueba: 'FPS' | 'TPS' | null = null;
  public jugadorActivo: Mesh | null = null;
  public cameraPivot: Mesh | null = null;

  public proxyColliders: Mesh[] = [];
  public backupObjetoPosicion: Vector3 | null = null;
  public backupObjetoRotacionQuat: Quaternion | null = null;
  public backupObjetoVisibilidad: boolean = true;
  public backupColisionJugador: boolean = true;
  public backupColisionesHijos: { mesh: AbstractMesh, col: boolean }[] = [];

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
    let currentMesh: Node | null = mesh;
    const nodos = this.nodosEscena();
    while (currentMesh) {
      if (nodos.includes(currentMesh)) return currentMesh;
      currentMesh = currentMesh.parent;
    }
    return null;
  }

  esMeshIgnorable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh || !mesh.name) return true;

    const name = mesh.name.toLowerCase();

    if (name === 'sueloinvisible' || name === 'camerapivot') return true;
    if (name.includes('eje') || name.includes('gridhelper')) return true;
    if (name.includes('gizmo') || name.includes('highlight') || name.includes('debug')) return true;
    if (name.includes('proxycol')) return true;

    if (this.jugadorActivo && (mesh === this.jugadorActivo || this.isDescendant(mesh, this.jugadorActivo))) {
      return true;
    }

    return false;
  }

  esObjetoObstructor = (mesh: AbstractMesh): boolean => {
    if (this.esMeshIgnorable(mesh)) return false;
    if (!mesh.isVisible) return false;
    return true;
  };

  esObjetoInteractuable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh || this.esMeshIgnorable(mesh)) return false;

    const root = this.encontrarRaiz(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    const meta = (nodoBase.metadata ?? mesh.metadata ?? {}) as any;

    const selectable = meta.isSelectable ?? true;
    if (!selectable) return false;

    const mensaje = typeof meta.mensaje === 'string' ? meta.mensaje.trim() : '';
    const interactSequenceId = typeof meta.interactSequenceId === 'string' ? meta.interactSequenceId.trim() : '';
    const sequenceCount = Array.isArray(meta.playerConfig?.sequences) ? meta.playerConfig.sequences.length : 0;

    return mensaje.length > 0 || interactSequenceId.length > 0 || sequenceCount > 0;
  };

  puedeSeleccionarse(mesh: AbstractMesh): boolean {
    if (!mesh || this.esMeshIgnorable(mesh)) return false;

    const root = this.encontrarRaiz(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    const state = this.playState();
    const rol = this.rolSimulado();

    if (state === 'EDITOR' || state === 'EDITING_IN_GAME') {
      return true;
    }

    const selectable = nodoBase.metadata?.isSelectable ?? mesh.metadata?.isSelectable ?? true;
    if (!selectable) return false;

    if (rol === 'admin') return true;

    return this.esObjetoInteractuable(nodoBase);
  }

  limpiarEstado(): void {
    this.playState.set('EDITOR');
    this.modoVistaPrueba = null;
    this.jugadorActivo = null;
    this.cameraPivot = null;
    this.objetoHovereado.set(null);
    this.objetoInteractuado.set(null);
    this.mirandoObjetoInteractuable.set(false);
    this.ratonBloqueado.set(false);
    this.objetoSeleccionado.set(null);
    this.subObjetoSeleccionado.set(null);
    this.showAddObjectModal.set(false);
  }
}
