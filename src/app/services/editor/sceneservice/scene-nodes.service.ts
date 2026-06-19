
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class SceneNodesService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService); // 🔥 Inyectamos el ECS

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
    if (obj && obj instanceof AbstractMesh) {
      this.state.objetoSeleccionado.set(null);
      
      // 1. Guardamos la lista de descendientes antes de que la malla muera
      const descendientes = obj.getDescendants(false);
      
      // 2. Eliminamos la Entidad Raíz del ECS (esto dispara automáticamente el dispose del mesh)
      const entity = this.entityManager.getEntityByMesh(obj);
      if (entity) {
          this.entityManager.removeEntity(entity.uid);
      } else {
          obj.dispose(false, true);
      }

      // 3. Eliminamos cualquier sub-entidad (hijos) del ECS para no dejar fantasmas
      descendientes.forEach(desc => {
          if (desc instanceof AbstractMesh) {
              const childEntity = this.entityManager.getEntityByMesh(desc);
              if (childEntity) {
                  this.entityManager.removeEntity(childEntity.uid);
              }
          }
      });

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