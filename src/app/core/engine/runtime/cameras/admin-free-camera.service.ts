
import { Injectable, inject } from '@angular/core';
import { UniversalCamera, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { CameraOwnershipService, CameraOwner } from './camera-ownership.service';
import { PlayerInputService } from '../systems/player-input.service';
import { PlayerInteractionService } from '../systems/player-interaction.service';
import { GameContextService } from '../../session/game-context.service';

@Injectable({ providedIn: 'root' })
export class AdminFreeCameraService {
  private motor3d = inject(Motor3dService);
  private ownership = inject(CameraOwnershipService);
  private inputSvc = inject(PlayerInputService);
  private interactionSvc = inject(PlayerInteractionService);
  private context = inject(GameContextService);
  
  private adminCam: UniversalCamera | null = null;
  private previousOwner: CameraOwner = 'NONE';
  private previousCam: any = null;

  public initialize(): void {
    if ((!this.adminCam || this.adminCam.isDisposed()) && this.motor3d.scene) { // 🔥 FIX: Recrear si fue destruida en recarga
      this.adminCam = new UniversalCamera('adminFreeCam', Vector3.Zero(), this.motor3d.scene);
      this.adminCam.minZ = 0.05;
      this.adminCam.maxZ = 500000;
      this.adminCam.speed = 0.5;
      this.adminCam.angularSensibility = 2000;
      this.adminCam.keysUp = [87]; // W
      this.adminCam.keysDown = [83]; // S
      this.adminCam.keysLeft = [65]; // A
      this.adminCam.keysRight = [68]; // D
      this.adminCam.checkCollisions = false;

      if (this.motor3d.renderingPipeline) {
        this.motor3d.renderingPipeline.addCamera(this.adminCam);
      }
    }
  }

  public toggle(canvas: HTMLCanvasElement): boolean {
    this.initialize();
    
    if (this.ownership.getOwner() === 'ADMIN_FREE') {
      // Restaurar control
      if (this.previousCam) {
        this.ownership.setCamera(this.previousOwner, this.previousCam, canvas, true);
      }
      
      // Reconectar Input del Jugador de forma segura
      if (this.context.isPointerLocked()) {
         this.inputSvc.enable();
         this.interactionSvc.enable();
      }
      return false;
    } else {
      // Activar Free Cam
      this.previousOwner = this.ownership.getOwner();
      this.previousCam = this.ownership.getCamera();
      
      if (this.previousCam && this.adminCam) {
        this.adminCam.position.copyFrom(this.previousCam.globalPosition);
        if (this.previousCam.absoluteRotation) {
            this.adminCam.rotation.copyFrom(this.previousCam.absoluteRotation.toEulerAngles());
        } else if (this.previousCam.rotation) {
            this.adminCam.rotation.copyFrom(this.previousCam.rotation);
        }
      }

      this.ownership.setCamera('ADMIN_FREE', this.adminCam!, canvas, true);
      
      // 🔴 BLOQUEO ACTIVO DEL JUGADOR (Elimina el Ghosting)
      this.inputSvc.disable();
      this.interactionSvc.disable();
      
      return true;
    }
  }
  
  public dispose(): void {
    if (this.adminCam) {
      if (this.motor3d.renderingPipeline) {
         this.motor3d.renderingPipeline.removeCamera(this.adminCam);
      }
      if (!this.adminCam.isDisposed()) {
        this.adminCam.dispose();
      }
      this.adminCam = null;
    }
  }
}