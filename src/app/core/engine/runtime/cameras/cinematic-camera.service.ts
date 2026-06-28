

import { Injectable, inject } from '@angular/core';
import { UniversalCamera, Vector3, Quaternion, Scene } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';

@Injectable({ providedIn: 'root' })
export class CinematicCameraService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  public camera: UniversalCamera | null = null;

  public initialize(scene: Scene): void {
    if (!this.camera || this.camera.isDisposed()) {
      this.camera = new UniversalCamera("CinematicDirectorCam", Vector3.Zero(), scene);
      this.camera.minZ = 0.05;
      this.camera.maxZ = 50000;
      this.camera.inputs.clear();
      
      if (this.motor3d.getRenderingPipeline() && !this.motor3d.getRenderingPipeline().cameras.includes(this.camera)) {
         this.motor3d.getRenderingPipeline().addCamera(this.camera);
      }
    }
  }

  public applyState(pos: Vector3, rot: Vector3, fov: number): void {
    if (!this.camera) return;
    this.camera.position.copyFrom(pos);
    this.camera.rotation.copyFrom(rot);
    if (fov) this.camera.fov = fov;
  }

  public dispose(): void {
    if (this.camera) {
      if (this.motor3d.getRenderingPipeline()) {
         this.motor3d.getRenderingPipeline().removeCamera(this.camera);
      }
      this.camera.dispose();
      this.camera = null;
    }
  }
}
