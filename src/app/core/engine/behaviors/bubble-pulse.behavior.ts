// src/app/core/engine/behaviors/bubble-pulse.behavior.ts

import { Behavior, Mesh, Nullable } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from './services/loop-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
 
export class BubblePulseBehavior implements Behavior<Mesh> {
  public attachedNode: Nullable<Mesh> = null;

  constructor(
    private loopManager: LoopManagerService,
    private entityManager: EntityManagerService
  ) {}

  get name(): string {
    return 'BubblePulseBehavior';
  }

  init(): void {}

  attach(target: Mesh): void {
    this.attachedNode = target;

    this.loopManager.register('BubblePulse_' + target.uniqueId, GamePhase.ANIMATION, () => {
      if (!this.attachedNode || !this.attachedNode.isVisible) return;
      
      const entity = this.entityManager.getEntityByMesh(this.attachedNode);
      if (!entity) return;

      const m = this.attachedNode;
      const time = performance.now() * 0.003;

      const isHovered = entity.isHovered === true;
      const targetHoverScale = isHovered ? 1.15 : 1.0; 
      
      if (entity.currentHoverScale === undefined) entity.currentHoverScale = 1.0;
      entity.currentHoverScale += (targetHoverScale - entity.currentHoverScale) * 0.15;
      
      const pulse = 1 + Math.sin(time + m.uniqueId) * 0.025; 
      const finalScale = pulse * entity.currentHoverScale;
      
      m.scaling.set(
        (entity.transform.scale.x || 1) * finalScale,
        (entity.transform.scale.y || 1) * finalScale,
        (entity.transform.scale.z || 1) * finalScale
      );
      
      m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    });
  }

  detach(): void {
    if (this.attachedNode) {
      this.loopManager.unregister('BubblePulse_' + this.attachedNode.uniqueId);
    }
    this.attachedNode = null;
  }
}