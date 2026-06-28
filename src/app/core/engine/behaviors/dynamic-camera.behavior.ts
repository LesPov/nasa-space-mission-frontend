
import { Behavior, ArcRotateCamera } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from './services/loop-manager.service';
 
export class DynamicCameraBehavior implements Behavior<ArcRotateCamera> {
  public attachedNode: ArcRotateCamera | null = null;
  private loopManager: LoopManagerService;

  constructor(loopManager: LoopManagerService) {
    this.loopManager = loopManager;
  }

  get name(): string {
    return 'DynamicCameraBehavior';
  }

  init(): void {}

  attach(target: ArcRotateCamera): void {
    this.attachedNode = target;
    const scene = target.getScene();

    this.loopManager.register('DynamicCamera_' + target.uniqueId, GamePhase.CAMERA, () => {
      const node = this.attachedNode;
      if (node && scene.activeCamera === node) {
        const radius = Math.max(0.1, node.radius);
        node.wheelPrecision = Math.max(0.01, 50 / radius);
        node.panningSensibility = Math.max(0.5, 2000 / radius);
        node.angularSensibilityX = Math.max(500, 3000 / Math.sqrt(radius));
        node.angularSensibilityY = Math.max(500, 3000 / Math.sqrt(radius));
      }
    });
  }

  detach(): void {
    if (this.attachedNode) {
      this.loopManager.unregister('DynamicCamera_' + this.attachedNode.uniqueId);
    }
    this.attachedNode = null;
  }
}
