import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class SceneNodesService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  public actualizarListaNodos(): void {
    if (!this.motor3d.scene) return;
    const scene = this.motor3d.scene;

    const lucesValidas = scene.lights.filter(l => !l.parent && l.name !== 'ambientLight');

    this.state.nodosEscena.set([
      ...scene.cameras,
      ...lucesValidas,
      ...scene.meshes.filter(m =>
        !['ejeX', 'ejeY', 'ejeZ', 'gridHelper', 'sueloInvisible'].includes(m.name) &&
        !m.name.includes('gizmo') &&
        !m.name.includes('highlight') &&
        m.parent === null 
      )
    ]);
  }

  public eliminarSeleccionado(): void {
    const obj = this.state.objetoSeleccionado();
    if (obj && obj instanceof Mesh) {
      this.state.objetoSeleccionado.set(null);
      obj.dispose(false, true);
      this.actualizarListaNodos();
      this.state.triggerUpdate();
    }
  }

  public limpiarEstado(): void {
    this.state.nodosEscena().forEach((nodo) => {
      if (nodo instanceof AbstractMesh && nodo.name !== 'sueloInvisible') nodo.dispose(false, true);
    });
    this.state.nodosEscena.set([]);
  }
}