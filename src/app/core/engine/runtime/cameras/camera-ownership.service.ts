import { Injectable, inject, signal, Injector } from '@angular/core';
import { Camera, Scene, Observer, Nullable } from '@babylonjs/core';
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

  private bypassObserver: Nullable<Observer<Scene>> = null;

  public setCamera(owner: CameraOwner, camera: Camera, canvas?: HTMLCanvasElement | null, attachControl: boolean = true): void {
    const scene = this.motor3d.getScene();
    if (!camera || !scene) return;

    // Si el nuevo dueño es el Editor o NONE, desmantelamos la protección anti-bypass
    if (owner === 'EDITOR' || owner === 'NONE') {
      this.detachAntiBypassWatcher();
    }

    const prevCam = this.currentCamera();
    if (prevCam && prevCam !== camera && canvas) {
      try { prevCam.detachControl(); } catch {}
    }

    this.currentOwner.set(owner);
    this.currentCamera.set(camera);

    scene.activeCameras = [];
    scene.activeCamera = camera;

    if (canvas && attachControl) {
      try { camera.attachControl(canvas, true); } catch {}
    }

    // El anti-bypass solo se activa para cámaras que requieren protección de gameplay
    if (this.isGameplayOwner(owner)) {
      this.initAntiBypassWatcher();
    }
  }

  public getOwner(): CameraOwner {
    return this.currentOwner();
  }

  public getCamera(): Camera | null {
    return this.currentCamera();
  }

  /**
   * Libera y revoca completamente el ownership de gameplay.
   * Desconecta el observer anti-bypass de Babylon.js para evitar que secuestre la cámara del editor.
   */
  public releaseGameplayOwnership(): void {
    this.detachAntiBypassWatcher();

    const currentCam = this.currentCamera();
    if (currentCam) {
      try { currentCam.detachControl(); } catch {}
    }

    this.currentOwner.set('NONE');
    this.currentCamera.set(null);
  }

  public resetWatcher(): void {
    this.detachAntiBypassWatcher();
  }

  private isGameplayOwner(owner: CameraOwner): boolean {
    return owner === 'PLAYER_FPS' || owner === 'PLAYER_TPS' || owner === 'CINEMATIC_DIRECTOR' || owner === 'ADMIN_FREE';
  }

  private initAntiBypassWatcher(): void {
    const scene = this.motor3d.getScene();
    if (!scene || this.bypassObserver) return;

    this.bypassObserver = scene.onBeforeRenderObservable.add(() => {
      const owner = this.currentOwner();
      // Solo hacer cumplir si el dueño actual es estrictamente de gameplay
      if (!this.isGameplayOwner(owner)) {
        return;
      }

      const actualActive = scene.activeCamera;
      const trackedCamera = this.currentCamera();

      if (actualActive && trackedCamera && actualActive !== trackedCamera) {
        scene.activeCameras = [];
        scene.activeCamera = trackedCamera;
      }
    });
  }

  private detachAntiBypassWatcher(): void {
    const scene = this.motor3d?.getScene?.();
    if (scene && this.bypassObserver) {
      scene.onBeforeRenderObservable.remove(this.bypassObserver);
    }
    this.bypassObserver = null;
  }
}