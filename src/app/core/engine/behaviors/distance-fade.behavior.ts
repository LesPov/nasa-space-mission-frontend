// src/app/core/engine/behaviors/distance-fade.behavior.ts

import { Behavior, Mesh, Scene, Vector3 } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from './services/loop-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
 
export class DistanceFadeBehavior implements Behavior<Mesh> {
  public attachedNode: Mesh | null = null;

  constructor(
    private loopManager: LoopManagerService,
    private entityManager: EntityManagerService
  ) {}

  get name(): string {
    return 'DistanceFadeBehavior';
  }

  init(): void {}

  attach(target: Mesh): void {
    this.attachedNode = target;
    const scene = target.getScene();

    this.loopManager.register('DistanceFade_' + target.uniqueId, GamePhase.POST_UPDATE, () => {
      if (!this.attachedNode) return;
      
      const entity = this.entityManager.getEntityByMesh(this.attachedNode);
      if (!entity) return;

      if (entity.visual.ignoraNiebla) {
        this.attachedNode.visibility = 1;
        this.attachedNode.getChildMeshes().forEach(child => child.visibility = 1);
        return;
      }

      const cam = scene.activeCamera;
      const useFogFade = scene.fogMode !== Scene.FOGMODE_NONE && cam;
      
      if (useFogFade) {
        const fogStart = scene.fogStart;
        const fogEnd = scene.fogEnd;
        const dist = Vector3.Distance(cam.globalPosition, this.attachedNode.getAbsolutePosition());
        
        let targetVis = 1;
        if (dist >= fogEnd) {
            targetVis = 0;
        } else if (dist > fogStart) {
            targetVis = 1.0 - ((dist - fogStart) / (fogEnd - fogStart));
            targetVis = Math.pow(targetVis, 1.2); 
        }
        
        this.attachedNode.visibility = targetVis;
        this.attachedNode.getChildMeshes().forEach(child => child.visibility = targetVis);
      } else {
        this.attachedNode.visibility = 1;
        this.attachedNode.getChildMeshes().forEach(child => child.visibility = 1);
      }
    });
  }

  detach(): void {
    if (this.attachedNode) {
      this.loopManager.unregister('DistanceFade_' + this.attachedNode.uniqueId);
    }
    this.attachedNode = null;
  }
}