import { Injectable, inject, signal, Injector } from '@angular/core';
import { Camera } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';

export type CameraOwner = 'NONE' | 'EDITOR' | 'PLAYER_FPS' | 'PLAYER_TPS' | 'ADMIN_FREE' | 'TRANSITION_PROXY';

@Injectable({ providedIn: 'root' })
export class CameraOwnershipService {
  // Usamos inyección diferida para evitar dependencia circular con Motor3dService
  private injector = inject(Injector);
  private _motor3d: Motor3dService | null = null;

  private get motor3d(): Motor3dService {
    if (!this._motor3d) {
      this._motor3d = this.injector.get(Motor3dService);
    }
    return this._motor3d;
  }

  // Fuente Única de Verdad (Reactiva)
  public currentOwner = signal<CameraOwner>('NONE');
  public currentCamera = signal<Camera | null>(null);

  private isWatcherInitialized = false;

  public setCamera(owner: CameraOwner, camera: Camera, canvas?: HTMLCanvasElement | null, attachControl: boolean = true): void {
    if (!camera || !this.motor3d.scene) return;

    this.initAntiBypassWatcher();

    const prevCam = this.currentCamera();
    if (prevCam && canvas) {
      try { prevCam.detachControl(); } catch {}
    }

    this.currentOwner.set(owner);
    this.currentCamera.set(camera);

    // Único punto legítimo de mutación
    this.motor3d.scene.activeCamera = camera;

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

  // Defensa activa contra código legacy o servicios externos que modifiquen scene.activeCamera directamente
  private initAntiBypassWatcher(): void {
    if (this.isWatcherInitialized) return;
    this.isWatcherInitialized = true;

    this.motor3d.scene.onBeforeRenderObservable.add(() => {
      const actualActive = this.motor3d.scene.activeCamera;
      const trackedCamera = this.currentCamera();

      if (actualActive && actualActive !== trackedCamera) {
        console.warn(`[CameraOwnership] ⚠️ BYPASS DETECTADO: Cámara activa mutada externamente a '${actualActive.name}'. Restaurando cámara dueña '${trackedCamera?.name}'.`);
        
        if (trackedCamera) {
            this.motor3d.scene.activeCamera = trackedCamera;
        }
      }
    });
  }
}