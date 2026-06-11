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

  public targetInteractuable = signal<AbstractMesh | null>(null);
  public showToastE = signal<boolean>(false);
  public showToastI = signal<boolean>(false);

  public mensajeTriggerHUD = signal<string | null>(null);

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
  public backupColisionesHijos: { mesh: AbstractMesh; col: boolean }[] = [];

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

  private esNombreIgnorable(name: string): boolean {
    const n = name.toLowerCase();
    return (
      n === 'sueloinvisible' || n === 'suelo' || n === 'ground' || n === 'floor' ||
      n === 'terrain' || n === 'camerapivot' || n.includes('eje') ||
      n.includes('gridhelper') || n.includes('gizmo') || n.includes('highlight') ||
      n.includes('debug') || n.includes('proxycol')
    );
  }

  esMeshIgnorable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh || !mesh.name) return true;

    const meta = (mesh.metadata ?? {}) as any;
    const name = mesh.name.toLowerCase();

    if (meta.isGround === true) return true;
    if (this.esNombreIgnorable(name)) return true;

    if (this.jugadorActivo && (mesh === this.jugadorActivo || this.isDescendant(mesh, this.jugadorActivo))) {
      return true;
    }

    if (this.rolSimulado() === 'user' && meta.isSelectable === false && !meta.mensaje && !meta.interactSequenceId && !meta.interactSequenceIdFPS && !meta.interactSequenceIdTPS && meta.type !== 'trigger') {
      if (this.playState() === 'PLAYING' || this.playState() === 'INTERACTING') {
        return true;
      }
    }
    return false;
  }

  esObjetoObstructor = (mesh: AbstractMesh): boolean => {
    if (this.esMeshIgnorable(mesh)) return false;
    if (!mesh.isVisible) return false;
    return true;
  };

  esObjetoInteractuable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh) return false;
    if (this.esMeshIgnorable(mesh)) return false;

    const root = this.encontrarRaiz(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    const meta = (nodoBase.metadata ?? mesh.metadata ?? {}) as any;

    // 🔥 MODIFICADO: Si es un trigger, verificamos si tiene la condición "on_interact" activada
    if (meta.type === 'trigger') {
        const conds = meta.conditions || [];
        return conds.includes('on_interact');
    }

    const mensaje = typeof meta.mensaje === 'string' ? meta.mensaje.trim() : '';
    const seqFPS = typeof meta.interactSequenceIdFPS === 'string' ? meta.interactSequenceIdFPS.trim() : '';
    const seqTPS = typeof meta.interactSequenceIdTPS === 'string' ? meta.interactSequenceIdTPS.trim() : '';
    const seqLeg = typeof meta.interactSequenceId === 'string' ? meta.interactSequenceId.trim() : '';

    return (mensaje.length > 0 || seqFPS.length > 0 || seqTPS.length > 0 || seqLeg.length > 0);
  }

  puedeSeleccionarse(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.esMeshIgnorable(mesh)) return false;

    const root = this.encontrarRaiz(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    const selectable = nodoBase.metadata?.isSelectable ?? mesh.metadata?.isSelectable ?? true;

    if (this.rolSimulado() === 'admin') return true;

    if (this.playState() === 'PLAYING' || this.playState() === 'INTERACTING') {
      return this.esObjetoInteractuable(nodoBase);
    }
    return !!selectable;
  }

  limpiarEstado(): void {
    this.playState.set('EDITOR');
    this.modoVistaPrueba = null;
    this.jugadorActivo = null;
    this.cameraPivot = null;
    this.objetoHovereado.set(null);
    this.objetoInteractuado.set(null);
    this.mirandoObjetoInteractuable.set(false);
    this.targetInteractuable.set(null);
    this.showToastE.set(false);
    this.showToastI.set(false);
    this.mensajeTriggerHUD.set(null); 
    this.ratonBloqueado.set(false);
    this.objetoSeleccionado.set(null);
    this.subObjetoSeleccionado.set(null);
  }
}