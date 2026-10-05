
// file: src/app/core/engine/scene/utils/light-visual-visibility.service.ts
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Node, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class LightVisualVisibilityService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);

  private cachedVisualMeshes: AbstractMesh[] = [];

  private ensureCachedVisuals(): AbstractMesh[] {
    const scene = this.motor3d.getScene();
    if (!scene) return [];

    if (this.cachedVisualMeshes.length === 0 || this.cachedVisualMeshes[0]?.isDisposed()) {
      this.cachedVisualMeshes = scene.meshes.filter(m => 
        Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual
      );
    }
    return this.cachedVisualMeshes;
  }

  public hideAll(): void {
    const visuals = this.ensureCachedVisuals();
    for (let i = 0; i < visuals.length; i++) {
      visuals[i].isVisible = false;
    }
  }

  public syncAllLightVisuals(selectedNode: Node | null): void {
    const visuals = this.ensureCachedVisuals();
    if (visuals.length === 0) return;

    let selectedEntityUid: string | null = null;
    if (selectedNode) {
      if ((selectedNode as any).metadata?.entityUid) {
        selectedEntityUid = (selectedNode as any).metadata.entityUid;
      } else if (selectedNode instanceof AbstractMesh) {
        const ent = this.entityManager.getEntityByMesh(selectedNode);
        if (ent) selectedEntityUid = ent.uid;
      }
    }

    for (let i = 0; i < visuals.length; i++) {
      const m = visuals[i];
      if (m.isDisposed()) continue;

      const entityUid = (m as any).metadata?.entityUid;
      const parentEntity = m.parent instanceof AbstractMesh ? this.entityManager.getEntityByMesh(m.parent) : null;
      const isThisSelected = (entityUid && entityUid === selectedEntityUid) || 
                             (parentEntity && parentEntity.uid === selectedEntityUid) ||
                             (selectedNode && (m === selectedNode || m.parent === selectedNode));
      m.isVisible = !!isThisSelected;
    }
  }
}