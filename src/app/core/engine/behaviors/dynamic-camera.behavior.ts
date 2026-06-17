import { Behavior, ArcRotateCamera } from '@babylonjs/core';

export class DynamicCameraBehavior implements Behavior<ArcRotateCamera> {
  // BABYLONJS EXIGE ESTA PROPIEDAD PÚBLICA EN LOS BEHAVIORS
  public attachedNode: ArcRotateCamera | null = null;
  private observer: any = null;

  get name(): string {
    return 'DynamicCameraBehavior';
  }

  init(): void {}

  attach(target: ArcRotateCamera): void {
    this.attachedNode = target;
    const scene = target.getScene();

    this.observer = scene.onBeforeRenderObservable.add(() => {
      // Guardamos la referencia en una constante local para que TypeScript confíe en que no es null
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
    if (this.attachedNode && this.observer) {
      this.attachedNode.getScene().onBeforeRenderObservable.remove(this.observer);
    }
    this.attachedNode = null;
  }
}