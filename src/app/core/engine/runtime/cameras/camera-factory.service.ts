

import { Injectable, inject, Injector } from '@angular/core';
import { ArcRotateCamera, UniversalCamera, Vector3, Scene, Camera, Matrix } from '@babylonjs/core';
import { GameContextService } from '../../session/game-context.service';
import { CAMERA_PROFILES, CameraType } from './camera-profile.model';
import { DynamicCameraBehavior } from '../../behaviors/dynamic-camera.behavior';
import { LoopManagerService } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService, CameraOwner } from './camera-ownership.service';

@Injectable({ providedIn: 'root' })
export class CameraFactoryService {
  private context = inject(GameContextService);
  private loopManager = inject(LoopManagerService);
  private injector = inject(Injector);

  private _cameras = new Map<string, Camera>();
  private mockCamera: any;

  private readonly TPS_MIN_RADIUS = 0.5;
  private readonly TPS_MAX_RADIUS = 150;

  public initializeCameras(scene: Scene, canvas: HTMLCanvasElement): void {
    const profile = CAMERA_PROFILES[this.context.mode()];
    
    const initialCam = this.getCamera(profile.initialCamera, scene, canvas);
    
    let initialOwner: CameraOwner = 'NONE';
    switch (profile.initialCamera) {
      case 'EDITOR': initialOwner = 'EDITOR'; break;
      case 'FPS': initialOwner = 'PLAYER_FPS'; break;
      case 'TPS': initialOwner = 'PLAYER_TPS'; break;
      case 'ADMIN_FREE': initialOwner = 'ADMIN_FREE'; break;
      case 'CINEMATIC': initialOwner = 'CINEMATIC_DIRECTOR'; break;
    }
    
    const ownership = this.injector.get(CameraOwnershipService);
    ownership.setCamera(initialOwner, initialCam as Camera, canvas, false);
  }

  public getCamera(type: CameraType, scene: Scene, canvas: HTMLCanvasElement | null = null): any {
    const mode = this.context.mode();
    const profile = CAMERA_PROFILES[mode];
    
    if (!profile.allowedCameras.includes(type)) {
      if (!this.mockCamera) {
        this.mockCamera = {
          maxZ: 10000, minZ: 0.1, 
          position: Vector3.Zero(), rotation: Vector3.Zero(),
          attachControl: () => {}, detachControl: () => {}, dispose: () => {},
          getViewMatrix: () => Matrix.Identity(),
          getDirection: () => Vector3.Forward(),
          name: 'mockCamera'
        };
      }
      return this.mockCamera;
    }

    const cameraKey = type;

    if (type === 'EDITOR') {
      if (!this._cameras.has(cameraKey)) {
        const cam = new ArcRotateCamera(`editorCamera`, Math.PI / 4, Math.PI / 3, 25, Vector3.Zero(), scene);
        cam.minZ = 0.1; 
        cam.maxZ = 500000; 
        cam.inertia = 0.8;
        cam.panningInertia = 0.8;
        cam._panningMouseButton = 2;
        cam.allowUpsideDown = false;
        cam.addBehavior(new DynamicCameraBehavior(this.loopManager)); 
        this._cameras.set(cameraKey, cam);
      }
      const cam = this._cameras.get(cameraKey) as ArcRotateCamera;
      if (canvas && mode === 'EDITOR') {
        cam.attachControl(canvas, true);
      }
      return cam;
    }

    if (type === 'FPS') {
      if (!this._cameras.has(cameraKey)) {
        const cam = new UniversalCamera(`playerCameraFPS`, new Vector3(0, 0, 0), scene);
        cam.keysUp = []; cam.keysDown = []; cam.keysLeft = []; cam.keysRight = [];
        cam.speed = 0.3; cam.applyGravity = false;
        this._cameras.set(cameraKey, cam);
      }
      const cam = this._cameras.get(cameraKey) as UniversalCamera;
      cam.minZ = 0.05; cam.maxZ = 500000; cam.angularSensibility = 2500; cam.checkCollisions = false;
      return cam;
    }

    if (type === 'TPS') {
      if (!this._cameras.has(cameraKey)) {
        const cam = new ArcRotateCamera(`playerCameraTPS`, -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
        cam.wheelPrecision = 15; cam.lowerRadiusLimit = this.TPS_MIN_RADIUS; cam.upperRadiusLimit = this.TPS_MAX_RADIUS;
        cam._panningMouseButton = 2; cam.allowUpsideDown = false;
        cam.collisionRadius = new Vector3(0.15, 0.15, 0.15); cam.upperBetaLimit = (Math.PI / 2) + 0.4;
        this._cameras.set(cameraKey, cam);
      }
      const cam = this._cameras.get(cameraKey) as ArcRotateCamera;
      cam.minZ = 0.05; cam.maxZ = 500000; cam.angularSensibilityX = 2000; cam.angularSensibilityY = 2000;
      cam.checkCollisions = mode === 'FINAL_USER' || mode === 'PREVIEW_ADMIN'; 
      return cam;
    }

    if (type === 'ADMIN_FREE') {
      if (!this._cameras.has(cameraKey)) {
        const cam = new UniversalCamera(`adminFreeCam`, Vector3.Zero(), scene);
        cam.speed = 0.5; cam.angularSensibility = 2000;
        cam.keysUp = [87]; cam.keysDown = [83]; cam.keysLeft = [65]; cam.keysRight = [68];
        cam.checkCollisions = false;
        this._cameras.set(cameraKey, cam);
      }
      const cam = this._cameras.get(cameraKey) as UniversalCamera;
      cam.minZ = 0.05; cam.maxZ = 500000;
      return cam;
    }

    if (type === 'CINEMATIC') {
      if (!this._cameras.has(cameraKey)) {
        const cam = new UniversalCamera(`cinematicCam`, Vector3.Zero(), scene);
        cam.checkCollisions = false;
        cam.applyGravity = false;
        // La cámara de cinemáticas no responde al input del jugador
        cam.keysUp = []; cam.keysDown = []; cam.keysLeft = []; cam.keysRight = [];
        this._cameras.set(cameraKey, cam);
      }
      const cam = this._cameras.get(cameraKey) as UniversalCamera;
      cam.minZ = 0.05; cam.maxZ = 500000;
      return cam;
    }
  }

  public dispose(): void {
    this._cameras.forEach(cam => cam.dispose());
    this._cameras.clear();
    this.mockCamera = undefined;
  }
}
