import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Quaternion, Vector3 } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { EditorStateService } from '../editor-state.service';
import { EditorSceneService } from '../editor-scene.service';

@Injectable({ providedIn: 'root' })
export class ToolsClipboardService {
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private sceneSvc = inject(EditorSceneService);

  private objetoEnPortapapeles: AbstractMesh | null = null;
  private listenerCtrlZAgregado = false;

  public initKeyboardListeners(): void {
    if (!this.listenerCtrlZAgregado) {
      window.addEventListener('keydown', this.manejarCtrlZGlobal, true);
      this.listenerCtrlZAgregado = true;
    }
  }

  private manejarCtrlZGlobal = (event: KeyboardEvent) => {
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';
    if (!isAdmin) return;

    const playState = this.state.playState();
    if (!(playState === 'EDITOR' || playState === 'EDITING_IN_GAME')) return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() !== 'z') return;
    
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    
    event.preventDefault();
    event.stopPropagation();
    this.deshacerAccion();
  };

  public copiarObjeto(): void {
    const obj = this.state.objetoSeleccionado() as AbstractMesh;
    if (obj) this.objetoEnPortapapeles = obj;
  }

  public pegarObjeto(): void {
    if (!this.objetoEnPortapapeles) return;
    const objOriginal = this.objetoEnPortapapeles;
    let clon: AbstractMesh;
    const nuevoNombre = objOriginal.name + '_Copia_' + Math.floor(Math.random() * 1000);

    if (objOriginal.metadata?.type === 'model') {
      const parentClone = objOriginal.instantiateHierarchy(null, { doNotInstantiate: true });
      clon = parentClone as AbstractMesh;
      clon.name = nuevoNombre;
      clon.checkCollisions = objOriginal.checkCollisions;
      clon.isPickable = true;
      clon.getChildMeshes().forEach((m, i) => {
        m.isPickable = true;
        m.checkCollisions = objOriginal.getChildMeshes()[i]?.checkCollisions ?? true;
      });
    } else {
      clon = objOriginal.clone(nuevoNombre, null) as AbstractMesh;
    }

    clon.position = objOriginal.position.clone();
    clon.position.x += 1;
    clon.position.z += 1;

    if (objOriginal.rotationQuaternion) clon.rotationQuaternion = objOriginal.rotationQuaternion.clone();
    else clon.rotation = objOriginal.rotation.clone();

    clon.scaling = objOriginal.scaling.clone();
    clon.metadata = JSON.parse(JSON.stringify(objOriginal.metadata));
    
    if (objOriginal.metadata?.initialHeadLocal) {
      clon.metadata.initialHeadLocal = new Vector3(
        objOriginal.metadata.initialHeadLocal.x,
        objOriginal.metadata.initialHeadLocal.y,
        objOriginal.metadata.initialHeadLocal.z
      );
    }

    clon.isPickable = true;

    this.sceneSvc.actualizarListaNodos();
    this.state.objetoSeleccionado.set(clon);
    this.historialSvc.registrarAccionCrear(clon);
    this.state.triggerUpdate();
  }

  public deshacerAccion(): void {
    if (this.historialSvc.deshacer()) {
      this.sceneSvc.actualizarListaNodos();
      this.state.onGizmoDrag.next();
      this.state.triggerUpdate();
    }
  }
}