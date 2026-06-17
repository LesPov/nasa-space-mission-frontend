import { Behavior, Mesh, Nullable } from '@babylonjs/core';

export class BubblePulseBehavior implements Behavior<Mesh> {
  attachedNode: Nullable<Mesh> = null;
  private target: Mesh | null = null;
  private observer: any = null;

  get name(): string {
    return 'BubblePulseBehavior';
  }

  init(): void {}

  attach(target: Mesh): void {
    this.target = target;
    const scene = target.getScene();

    this.observer = scene.onBeforeRenderObservable.add(() => {
      if (!this.target || !this.target.isVisible) return;
      if (!this.target.metadata) return;

      const m = this.target;
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
    if (this.target && this.observer) {
      this.target.getScene().onBeforeRenderObservable.remove(this.observer);
    }
  }
}