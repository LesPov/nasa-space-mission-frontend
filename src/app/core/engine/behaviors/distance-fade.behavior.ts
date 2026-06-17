import { Behavior, Mesh, Scene, Vector3 } from '@babylonjs/core';

export class DistanceFadeBehavior implements Behavior<Mesh> {
  // BABYLONJS EXIGE ESTA PROPIEDAD PÚBLICA EN LOS BEHAVIORS
  public attachedNode: Mesh | null = null;
  private observer: any = null;

  get name(): string {
    return 'DistanceFadeBehavior';
  }

  init(): void {}

  attach(target: Mesh): void {
    this.attachedNode = target;
    const scene = target.getScene();

    this.observer = scene.onBeforeRenderObservable.add(() => {
      if (!this.attachedNode || !this.attachedNode.metadata) return;
      if (this.attachedNode.metadata.ignoraNiebla) {
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
    if (this.attachedNode && this.observer) {
      this.attachedNode.getScene().onBeforeRenderObservable.remove(this.observer);
    }
    this.attachedNode = null;
  }
}