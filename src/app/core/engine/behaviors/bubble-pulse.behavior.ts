import { Behavior, Mesh, Nullable } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from './services/loop-manager.service';
 
export class BubblePulseBehavior implements Behavior<Mesh> {
  public attachedNode: Nullable<Mesh> = null;
  private loopManager: LoopManagerService;

  constructor(loopManager: LoopManagerService) {
    this.loopManager = loopManager;
  }

  get name(): string {
    return 'BubblePulseBehavior';
  }

  init(): void {}

  attach(target: Mesh): void {
    this.attachedNode = target;

    this.loopManager.register('BubblePulse_' + target.uniqueId, GamePhase.ANIMATION, () => {
      if (!this.attachedNode || !this.attachedNode.isVisible) return;
      if (!this.attachedNode.metadata) return;

      const m = this.attachedNode;
      const time = performance.now() * 0.003;

      if (!m.metadata.baseScaleX) {
        m.metadata.baseScaleX = m.scaling.x;
        m.metadata.baseScaleY = m.scaling.y;
        m.metadata.baseScaleZ = m.scaling.z;
      }
      
      const isHovered = m.metadata.isHovered === true;
      const targetHoverScale = isHovered ? 1.15 : 1.0; 
      
      if (m.metadata.currentHoverScale === undefined) m.metadata.currentHoverScale = 1.0;
      m.metadata.currentHoverScale += (targetHoverScale - m.metadata.currentHoverScale) * 0.15;
      
      const pulse = 1 + Math.sin(time + m.uniqueId) * 0.025; 
      const finalScale = pulse * m.metadata.currentHoverScale;
      
      m.scaling.set(
        m.metadata.baseScaleX * finalScale,
        m.metadata.baseScaleY * finalScale,
        m.metadata.baseScaleZ * finalScale
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