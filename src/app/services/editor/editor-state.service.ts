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

  esObjetoObstructor = (mesh: AbstractMesh): boolean => {
    if (!mesh || !mesh.name || !mesh.isVisible) return false;
    if (mesh.name === 'sueloInvisible' || mesh.name === 'cameraPivot') return false;
    if (mesh.name.includes('eje') || mesh.name.includes('gridHelper')) return false;
    if (mesh.name.toLowerCase().includes('gizmo') || mesh.name.toLowerCase().includes('highlight') || mesh.name.toLowerCase().includes('debug')) return false;

    if (this.jugadorActivo && (mesh === this.jugadorActivo || this.isDescendant(mesh, this.jugadorActivo))) {
      return false;
    }
    return true;
  };

  puedeSeleccionarse(mesh: AbstractMesh): boolean {
    if (!mesh) return false;

    const root = this.encontrarRaiz(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;

    const selectable = nodoBase.metadata?.isSelectable ?? mesh.metadata?.isSelectable ?? true;
    const rol = this.rolSimulado();
    const state = this.playState();
    const gameplay = state === 'PLAYING' || state === 'INTERACTING';

    if (rol === 'admin') return true;
    if (gameplay) return selectable;

    return true;
  }

  limpiarEstado(): void {
    this.playState.set('EDITOR');
    this.modoVistaPrueba = null;
    this.jugadorActivo = null;
    this.objetoHovereado.set(null);
    this.objetoSeleccionado.set(null);
    this.subObjetoSeleccionado.set(null);
  }
}