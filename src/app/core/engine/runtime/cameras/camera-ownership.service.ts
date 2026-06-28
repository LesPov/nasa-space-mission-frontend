
import { Injectable, inject, signal, Injector } from '@angular/core';
import { Camera } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';

export type CameraOwner = 'NONE' | 'EDITOR' | 'PLAYER_FPS' | 'PLAYER_TPS' | 'ADMIN_FREE' | 'TRANSITION_PROXY' | 'CINEMATIC_DIRECTOR';

@Injectable({ providedIn: 'root' })
export class CameraOwnershipService {
  private injector = inject(Injector);
  private _motor3d: ISceneAccess | null = null;

  private get motor3d(): ISceneAccess {
    if (!this._motor3d) {
      this._motor3d = this.injector.get(SCENE_ACCESS_TOKEN);
    }
    return this._motor3d;
  }

  public currentOwner = signal<CameraOwner>('NONE');
  public currentCamera = signal<Camera | null>(null);

  private isWatcherInitialized = false;

  public setCamera(owner: CameraOwner, camera: Camera, canvas?: HTMLCanvasElement | null, attachControl: boolean = true): void {
    if (!camera || !this.motor3d.getScene()) return;

    this.initAntiBypassWatcher();

    const prevCam = this.currentCamera();
    if (prevCam && canvas) {
      try { prevCam.detachControl(); } catch {}
    }

    this.currentOwner.set(owner);
    this.currentCamera.set(camera);

    this.motor3d.getScene().activeCameras = []; 
    this.motor3d.getScene().activeCamera = camera;

    if (canvas && attachControl) {
      try { camera.attachControl(canvas, true); } catch {}
    }
  }

  public getOwner(): CameraOwner {
    return this.currentOwner();
  }

  public getCamera(): Camera | null {
    return this.currentCamera();
  }

  private initAntiBypassWatcher(): void {
    if (this.isWatcherInitialized) return;
    this.isWatcherInitialized = true;

    this.motor3d.getScene().onBeforeRenderObservable.add(() => {
      const actualActive = this.motor3d.getScene().activeCamera;
      const trackedCamera = this.currentCamera();

      if (actualActive && actualActive !== trackedCamera) {
        console.warn(`[CameraOwnership] ⚠️ BYPASS DETECTADO: Cámara activa mutada externamente a '${actualActive.name}'. Restaurando cámara dueña '${trackedCamera?.name}'.`);
        
        if (trackedCamera) {
            this.motor3d.getScene().activeCameras = [];
            this.motor3d.getScene().activeCamera = trackedCamera;
        }
      }
    });
  }
}