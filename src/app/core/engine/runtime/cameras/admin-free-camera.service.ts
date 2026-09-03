
import { Injectable, inject } from '@angular/core';
import { UniversalCamera, Vector3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { CameraOwnershipService, CameraOwner } from './camera-ownership.service';
import { PlayerInputService } from '../systems/player-input.service';
import { PlayerInteractionService } from '../systems/player-interaction.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraFactoryService } from './camera-factory.service';

@Injectable({ providedIn: 'root' })
export class AdminFreeCameraService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private inputSvc = inject(PlayerInputService);
  private interactionSvc = inject(PlayerInteractionService);
  private context = inject(GameContextService);
  private cameraFactory = inject(CameraFactoryService);
  
  private adminCam: UniversalCamera | null = null;
  private previousOwner: CameraOwner = 'NONE';
  private previousCam: any = null;

  public initialize(): void {
    if ((!this.adminCam || this.adminCam.isDisposed()) && this.motor3d.getScene()) {
      this.adminCam = this.cameraFactory.getCamera('ADMIN_FREE', this.motor3d.getScene());
      if (this.motor3d.getRenderingPipeline() && this.adminCam) {
        if (!this.motor3d.getRenderingPipeline().cameras.includes(this.adminCam)) {
          this.motor3d.getRenderingPipeline().addCamera(this.adminCam);
        }
      }
    }
  }

  public toggle(canvas: HTMLCanvasElement): boolean {
    this.initialize();
    
    if (this.ownership.getOwner() === 'ADMIN_FREE') {
      if (this.previousCam) {
        this.ownership.setCamera(this.previousOwner, this.previousCam, canvas, true);
      }
      
      const player = this.context.activePlayerEntity();
      if (player && player.playerRuntime) {
        const state = player.playerRuntime.physicsState;
        // 🔥 CORRECCIÓN CRÍTICA (Bug 2) - Alineado con CharacterKinematicsService
        state.velocidadY = -0.005; 
        state.isJumping = false;
        state.isFalling = false;
        state.isHardLanding = false;
        state.isRecoveringFromFall = false;
      }

      if (this.context.isPointerLocked()) {
         this.inputSvc.enable();
         this.interactionSvc.enable();
      }
      return false;
    } else {
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
      
      this.inputSvc.disable();
      this.interactionSvc.disable();
      
      return true;
    }
  }
  
  public dispose(): void {
    if (this.adminCam) {
      if (this.motor3d.getRenderingPipeline()) {
         this.motor3d.getRenderingPipeline().removeCamera(this.adminCam);
      }
      if (!this.adminCam.isDisposed()) {
        this.adminCam.dispose();
      }
      this.adminCam = null;
    }
  }
}