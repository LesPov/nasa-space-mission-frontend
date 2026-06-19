// src/app/services/editor/editor-state.service.ts

import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Node, AbstractMesh, Mesh, Vector3, Quaternion } from '@babylonjs/core';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export type PlayState = 'EDITOR' | 'PLAYING' | 'EDITING_IN_GAME' | 'TRANSITIONING' | 'INTERACTING';

@Injectable({ providedIn: 'root' })
export class EditorStateService {
  private entityManager = inject(EntityManagerService);

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
      if (this.esNombreIgnorable(current.name)) {
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

  public esNombreIgnorable(name: string): boolean {
    if(!name) return true;
    const n = name.toLowerCase();
    return (
      n === 'sueloinvisible' || n === 'suelo' || n === 'ground' || n === 'floor' ||
      n === 'terrain' || n === 'camerapivot' || n.includes('eje') ||
      n.includes('gridhelper') || n.includes('gizmo') || n.includes('highlight') ||
      n.includes('debug') || n.includes('proxycol') || n.includes('skybox') ||
      n.startsWith('decal_') || n.includes('fogshell') || n.includes('fogwall') || n.includes('debugfog')
    );
  }

  esMeshIgnorable(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh || !mesh.name) return true;

    const name = mesh.name.toLowerCase();
    if (this.esNombreIgnorable(name)) return true;

    const entity = this.entityManager.getEntityByMesh(mesh);
    const isAdmin = this.checkIsAdmin();

    if (this.jugadorActivo && (mesh === this.jugadorActivo || this.isDescendant(mesh, this.jugadorActivo))) {
      return true;
    }

    if (entity && entity.type === 'trigger') {
        if (isAdmin) return false; 
        return true; 
    }

    if (entity) {
        if (!isAdmin && entity.visual.isSelectable === false && !entity.interaction.mensaje && !entity.interaction.interactSequenceId && !entity.interaction.interactSequenceIdFPS && !entity.interaction.interactSequenceIdTPS && entity.type !== 'bubble') {
            if (this.playState() === 'PLAYING' || this.playState() === 'INTERACTING') {
                return true;
            }
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

    const root = this.resolverObjetoSeleccionable(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    
    const entity = this.entityManager.getEntityByMesh(nodoBase);
    if (!entity) return false;

    if (entity.type === 'trigger') return false; 
    if (entity.type === 'bubble') return true; 

    const mensaje = typeof entity.interaction.mensaje === 'string' ? entity.interaction.mensaje.trim() : '';
    const seqFPS = typeof entity.interaction.interactSequenceIdFPS === 'string' ? entity.interaction.interactSequenceIdFPS.trim() : '';
    const seqTPS = typeof entity.interaction.interactSequenceIdTPS === 'string' ? entity.interaction.interactSequenceIdTPS.trim() : '';
    const seqLeg = typeof entity.interaction.interactSequenceId === 'string' ? entity.interaction.interactSequenceId.trim() : '';

    return (mensaje.length > 0 || seqFPS.length > 0 || seqTPS.length > 0 || seqLeg.length > 0);
  }

  puedeSeleccionarse(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.esMeshIgnorable(mesh)) return false;

    const root = this.resolverObjetoSeleccionable(mesh) as AbstractMesh | null;
    const nodoBase = root ?? mesh;
    
    const entity = this.entityManager.getEntityByMesh(nodoBase);
    const selectable = entity?.visual?.isSelectable ?? true;
    const isAdmin = this.checkIsAdmin();

    if (this.playState() === 'PLAYING' || this.playState() === 'INTERACTING') {
      return this.esObjetoInteractuable(nodoBase);
    }
    
    if (isAdmin) return !!selectable;
    
    return false;
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
  }
}