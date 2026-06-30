
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { EditorMapaService } from '../../editor-mapa.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class SceneNodesService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService); 

  public actualizarListaNodos(): void {
    if (!this.motor3d.getScene()) return;
    const scene = this.motor3d.getScene();

    // 🔥 Eliminado lucesValidas para que no se listen luces BabylonJS físicas del DynamicLightingSystem
    
    const camarasValidas = scene.cameras.filter(c => 
      !c.name.includes('proxy') && !c.name.includes('mock') && !c.name.includes('admin')
    );

    this.state.nodosEscena.set([
      ...camarasValidas,
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

      setTimeout(() => {
        this.actualizarListaNodos();
        this.mapaSvc.onMapChanged.next();
      }, 0);
    }
  }

  public limpiarEstado(): void {
    this.state.nodosEscena().forEach((nodo) => {
      if (nodo instanceof AbstractMesh && !Tags.MatchesQuery(nodo, "invisible_floor")) {
          nodo.dispose(false, false);
      }
    });
    this.state.nodosEscena.set([]);
    this.entityManager.clear();
  }
}