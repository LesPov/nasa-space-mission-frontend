import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Node, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class LightVisualVisibilityService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);

  public hideAll(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    scene.meshes.forEach(m => {
      if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
        m.isVisible = false;
      }
    });
  }

  public syncAllLightVisuals(selectedNode: Node | null): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    let selectedEntityUid: string | null = null;
    if (selectedNode) {
      if ((selectedNode as any).metadata?.entityUid) {
        selectedEntityUid = (selectedNode as any).metadata.entityUid;
      } else if (selectedNode instanceof AbstractMesh) {
        const ent = this.entityManager.getEntityByMesh(selectedNode);
        if (ent) selectedEntityUid = ent.uid;
      }
    }

    scene.meshes.forEach(m => {
      if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
        const entityUid = (m as any).metadata?.entityUid;
        const parentEntity = m.parent instanceof AbstractMesh ? this.entityManager.getEntityByMesh(m.parent) : null;
        const isThisSelected = (entityUid && entityUid === selectedEntityUid) || 
                               (parentEntity && parentEntity.uid === selectedEntityUid) ||
                               (selectedNode && (m === selectedNode || m.parent === selectedNode));
        m.isVisible = !!isThisSelected;
      }
    });
  }
}