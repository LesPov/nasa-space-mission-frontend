import { Injectable, inject } from '@angular/core';
import { UniversalCamera, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { CameraOwnershipService, CameraOwner } from './camera-ownership.service';
import { PlayerInputService } from '../systems/player-input.service';
import { PlayerInteractionService } from '../systems/player-interaction.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraFactoryService } from './camera-factory.service';

@Injectable({ providedIn: 'root' })
export class AdminFreeCameraService {
  private motor3d = inject(Motor3dService);
  private ownership = inject(CameraOwnershipService);
  private inputSvc = inject(PlayerInputService);
  private interactionSvc = inject(PlayerInteractionService);
  private context = inject(GameContextService);
  private cameraFactory = inject(CameraFactoryService);
  
  private adminCam: UniversalCamera | null = null;
  private previousOwner: CameraOwner = 'NONE';
  private previousCam: any = null;

  public initialize(): void {
    if ((!this.adminCam || this.adminCam.isDisposed()) && this.motor3d.scene) {
      this.adminCam = this.cameraFactory.getCamera('ADMIN_FREE', this.motor3d.scene);
      if (this.motor3d.renderingPipeline && this.adminCam) {
        if (!this.motor3d.renderingPipeline.cameras.includes(this.adminCam)) {
          this.motor3d.renderingPipeline.addCamera(this.adminCam);
        }
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
      
      // Limpiar estados físicos del jugador para evitar inercia pegada
      const player = this.context.activePlayerEntity();
      if (player && player.playerRuntime) {
        const state = player.playerRuntime.physicsState;
        state.velocidadY = -0.05;
        state.isJumping = false;
        state.isFalling = false;
        state.isHardLanding = false;
        state.isRecoveringFromFall = false;
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
      
      // 🔴 BLOQUEO ACTIVO DEL JUGADOR Y SUS FÍSICAS
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