import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Tags } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class SceneNodesService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService); 

  public actualizarListaNodos(): void {
    if (!this.motor3d.scene) return;
    const scene = this.motor3d.scene;

    const lucesValidas = scene.lights.filter(l => !l.parent && l.name !== 'ambientLight');
    
    // 🔥 FIX: Filtramos las cámaras que el motor inyecta dinámicamente para que no salgan en el outliner.
    const camarasValidas = scene.cameras.filter(c => 
      !c.name.includes('proxy') && !c.name.includes('mock') && !c.name.includes('admin')
    );

    this.state.nodosEscena.set([
      ...camarasValidas,
      ...lucesValidas,
      ...scene.meshes.filter(m =>
        !Tags.MatchesQuery(m, "system_element || editor_only || fog_element || debug_element || proxy_collider") &&
        m.parent === null 
      )
    ]);
  }

  public eliminarSeleccionado(): void {
    const obj = this.state.objetoSeleccionado();
    if (obj && obj instanceof AbstractMesh) {
      this.state.objetoSeleccionado.set(null);
      
      const descendientes = obj.getDescendants(false);
      
      const entity = this.entityManager.getEntityByMesh(obj);
      if (entity) {
          this.entityManager.removeEntity(entity.uid);
      } else {
          obj.dispose(false, true);
      }

      descendientes.forEach(desc => {
          if (desc instanceof AbstractMesh) {
              const childEntity = this.entityManager.getEntityByMesh(desc);
              if (childEntity) {
                  this.entityManager.removeEntity(childEntity.uid);
              }
          }
      });

      // 🔥 FIX NG0100: Ejecutamos las actualizaciones reactivas en el siguiente tick
      setTimeout(() => {
        this.actualizarListaNodos();
        this.state.triggerUpdate();
      }, 0);
    }
  }

  public limpiarEstado(): void {
    this.state.nodosEscena().forEach((nodo) => {
      if (nodo instanceof AbstractMesh && !Tags.MatchesQuery(nodo, "invisible_floor")) {
          nodo.dispose(false, true);
      }
    });
    this.state.nodosEscena.set([]);
    this.entityManager.clear();
  }
}