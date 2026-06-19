
import { Injectable, inject } from '@angular/core';
import {
  Mesh, Vector3, Matrix, TransformNode, UniversalCamera,
  Animation, CubicEase, EasingFunction, Quaternion, MeshBuilder, Tags
} from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { EstadoFisico } from './player-physics.service';
import { SeqRuntime } from './player-sequence.service';
import { LoopManagerService, GamePhase } from '../../behaviors/services/loop-manager.service';
import { GameEntity } from '../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class PlayerCameraManagerService {
  private motor3d = inject(Motor3dService);
  private loopManager = inject(LoopManagerService); 

  public cameraPivot: Mesh | null = null;

  public currentEyeLevel = 1.6;
  public currentPivotY = 1.5;
  public idleTime = 0;
  public isTransitioningCameras = false;
  public overrideTargetPivotY: number | null = null;

  public headNode: TransformNode | null = null;
  public initialHeadLocal: Vector3 | null = null;
  
  public resetearTransiciones(): void {
    this.isTransitioningCameras = false;
    this.overrideTargetPivotY = null;
    this.idleTime = 0;
    this.loopManager.unregister('CameraFadeTransition');
  }

  public inicializarCamaras(
    entity: GameEntity,
    vista: 'FPS' | 'TPS'
  ): void {
    const jugador = entity.view as Mesh;
    if (!jugador) return;

    if (!this.cameraPivot) {
      this.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.scene);
      this.cameraPivot.isVisible = false;
      Tags.AddTagsTo(this.cameraPivot, "system_element ignore_raycast");
    }

    const colMeta = entity.collider;
    const camMeta = entity.camOffset;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const scaleY = entity.transform.scale.y || 1;

    const playerEyeLevel = (config.camera.fpsEyeLevel || 1.6) * scaleY;
    this.currentEyeLevel = playerEyeLevel;
    this.currentPivotY = (config.camera.tpsPivotY || 1.5) * scaleY;

    this.headNode = jugador.getChildTransformNodes(false).find(n =>
      n.name.toLowerCase() === 'head' ||
      n.name.toLowerCase() === 'neck' ||
      n.name.toLowerCase().includes('mixamorig:head') ||
      n.name.toLowerCase().includes('head')
    ) as TransformNode;

    if (this.headNode) {
      this.headNode.computeWorldMatrix(true);
      jugador.computeWorldMatrix(true);
      this.initialHeadLocal = Vector3.TransformCoordinates(
        this.headNode.getAbsolutePosition(),
        Matrix.Invert(jugador.getWorldMatrix())
      );
    } else {
      this.initialHeadLocal = null;
    }

    const fpsCam = this.motor3d.playerCameraFPS;
    fpsCam.keysUp = []; fpsCam.keysDown = []; fpsCam.keysLeft = []; fpsCam.keysRight = [];
    fpsCam.minZ = 0.01; 

    const startRot = jugador.rotationQuaternion
      ? jugador.rotationQuaternion.toEulerAngles()
      : jugador.rotation;

    fpsCam.rotation.set(startRot.x || 0, startRot.y || 0, startRot.z || 0);

    if (this.cameraPivot) {
      const localPivotPos = new Vector3(camMeta.x || 0, this.currentPivotY / scaleY, camMeta.z || 0);
      jugador.computeWorldMatrix(true);
      this.cameraPivot.position = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

      this.motor3d.playerCameraTPS.lockedTarget = this.cameraPivot;
      
      const radBase = (config.camera.tpsRadius || 5) * scaleY;
      const minRad = (config.camera.tpsMinRadius ?? 1.5) * scaleY;
      const maxRad = (config.camera.tpsMaxRadius ?? 15) * scaleY;
      
      this.motor3d.playerCameraTPS.radius = radBase;
      this.motor3d.playerCameraTPS.lowerRadiusLimit = minRad;
      this.motor3d.playerCameraTPS.upperRadiusLimit = maxRad;
      
      this.motor3d.playerCameraTPS.checkCollisions = true;
      this.motor3d.playerCameraTPS.collisionRadius = new Vector3(0.25, 0.25, 0.25); 
      this.motor3d.playerCameraTPS.upperBetaLimit = (Math.PI / 2) + 0.4;
      
      this.motor3d.playerCameraTPS.wheelPrecision = 15;
      this.motor3d.playerCameraTPS.panningSensibility = 0;
      this.motor3d.playerCameraTPS.allowUpsideDown = false;
      this.motor3d.playerCameraTPS.alpha = -(startRot.y || 0) - Math.PI / 2;
      this.motor3d.playerCameraTPS.beta = (startRot.x || 0) + Math.PI / 2;
      
      this.motor3d.playerCameraTPS.rebuildAnglesAndRadius();
      this.motor3d.playerCameraTPS.getViewMatrix(true);
    }

    if (vista === 'FPS') {
      jugador.visibility = 0;
      jugador.getChildMeshes().forEach(m => m.visibility = 0);
      const localCamPos = new Vector3(camMeta.x || 0, this.currentEyeLevel / scaleY, camMeta.z || 0);
      fpsCam.position = Vector3.TransformCoordinates(localCamPos, jugador.getWorldMatrix());
      fpsCam.getViewMatrix(true);
    } else {
      jugador.visibility = 1;
      jugador.getChildMeshes().forEach(m => m.visibility = 1);
    }
  }

  public toggleCameraView(
    entity: GameEntity, 
    currentVista: 'FPS' | 'TPS', 
    isCinematicInitial: boolean = false,
    attachControlForce: boolean = true,
    onVistaChanged: (newVista: 'FPS' | 'TPS') => void,
    customFrames?: number
  ): void {
    const jugador = entity.view as Mesh;
    if (!jugador || this.isTransitioningCameras) return;

    this.isTransitioningCameras = true;
    const scaleNow = entity.transform.scale.y || 1;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    
    const minR = (config.camera.tpsMinRadius ?? 1.5) * scaleNow;
    const maxR = (config.camera.tpsMaxRadius ?? 15) * scaleNow;
    
    const targetRadiusRaw = isCinematicInitial ? maxR : ((config.camera.tpsRadius || 5) * scaleNow);
    const targetRadius = Math.max(minR, Math.min(maxR, targetRadiusRaw));

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const fpsCam = this.motor3d.playerCameraFPS;
    const tpsCam = this.motor3d.playerCameraTPS;
    const canvas = this.motor3d.engine.getRenderingCanvas();
    const scene = this.motor3d.scene;

    const framesTransicion = customFrames !== undefined ? customFrames : (isCinematicInitial ? 300 : 45);

    this.loopManager.unregister('CameraFadeTransition');

    const fadeLimit = 2.5 * scaleNow;

    if (currentVista === 'FPS') {
      if (canvas) fpsCam.detachControl();

      tpsCam.checkCollisions = false;
      tpsCam.lowerRadiusLimit = null;
      tpsCam.upperRadiusLimit = null;

      if (this.cameraPivot) {
        this.cameraPivot.position.copyFrom(fpsCam.globalPosition);
      }

      tpsCam.alpha = -(fpsCam.rotation.y || 0) - Math.PI / 2;
      const currentBeta = (fpsCam.rotation.x || 0) + Math.PI / 2;
      
      tpsCam.beta = currentBeta;
      tpsCam.radius = 0.05; 

      tpsCam.inertialAlphaOffset = 0;
      tpsCam.inertialBetaOffset = 0;
      tpsCam.inertialRadiusOffset = 0;

      this.currentPivotY = this.currentEyeLevel;
      onVistaChanged('TPS');
      scene.activeCamera = tpsCam;

      this.loopManager.register('CameraFadeTransition', GamePhase.CAMERA, () => {
          if (tpsCam.radius < fadeLimit) {
             jugador.visibility = Math.max(0, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
             jugador.getChildMeshes().forEach(m => m.visibility = jugador.visibility);
          } else {
             jugador.visibility = 1;
             jugador.getChildMeshes().forEach(m => m.visibility = 1);
          }
      });

      const animRad = Animation.CreateAndStartAnimation('camRadiusOut', tpsCam, 'radius', 60, framesTransicion, 0.05, targetRadius, 2, ease);

      animRad?.onAnimationEndObservable.addOnce(() => {
        this.resetearTransiciones();
        tpsCam.checkCollisions = true; 
        jugador.visibility = 1;
        jugador.getChildMeshes().forEach(m => m.visibility = 1);
        if (canvas && attachControlForce) tpsCam.attachControl(canvas, true);
      });
    } else {
      if (canvas) tpsCam.detachControl();

      const fixedAlpha = tpsCam.alpha;
      const fixedBeta = tpsCam.beta;

      tpsCam.checkCollisions = false;
      tpsCam.lowerRadiusLimit = null;
      tpsCam.upperRadiusLimit = null;

      this.overrideTargetPivotY = (config.camera.fpsEyeLevel || 1.6) * scaleNow;

      this.loopManager.register('CameraFadeTransition', GamePhase.CAMERA, () => {
          tpsCam.alpha = fixedAlpha;
          tpsCam.beta = fixedBeta;

          if (tpsCam.radius < fadeLimit) {
             jugador.visibility = Math.max(0, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
             jugador.getChildMeshes().forEach(m => m.visibility = jugador.visibility);
          } else {
             jugador.visibility = 1;
             jugador.getChildMeshes().forEach(m => m.visibility = 1);
          }
      });

      const animRad = Animation.CreateAndStartAnimation('camRadiusIn', tpsCam, 'radius', 60, framesTransicion, tpsCam.radius, 0.05, 2, ease);

      animRad?.onAnimationEndObservable.addOnce(() => {
        onVistaChanged('FPS');
        
        fpsCam.rotation.y = -fixedAlpha - Math.PI / 2;
        fpsCam.rotation.x = fixedBeta - Math.PI / 2;

        if (this.cameraPivot) {
            fpsCam.position.copyFrom(this.cameraPivot.getAbsolutePosition());
        }
        
        scene.activeCamera = fpsCam;
        
        this.resetearTransiciones();
        tpsCam.checkCollisions = true;

        jugador.visibility = 0;
        jugador.getChildMeshes().forEach(m => m.visibility = 0);
        
        if (canvas && attachControlForce) fpsCam.attachControl(canvas, true);
      });
    }
  }

  public actualizarPosicionCamara(
    entity: GameEntity,
    activeCamera: any,
    estadoFisico: EstadoFisico,
    seqRuntime: SeqRuntime,
    vista: 'FPS' | 'TPS'
  ): void {
    if (activeCamera !== this.motor3d.playerCameraFPS && activeCamera !== this.motor3d.playerCameraTPS) return;

    const jugador = entity.view as Mesh;
    if (!jugador) return;

    const scene = this.motor3d.scene;
    const colMeta = entity.collider;
    const camMeta = entity.camOffset;
    const scaleNow = entity.transform.scale;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const scaleY = scaleNow.y || 1;

    const playerHalfHeight = (colMeta.sizeY || 0.9) * scaleY;
    const playerEyeLevel = (config.camera.fpsEyeLevel || 1.6) * scaleY;

    let targetEyeLevel = playerEyeLevel;
    let targetPivotY = this.overrideTargetPivotY !== null
      ? this.overrideTargetPivotY
      : (config.camera.tpsPivotY || 1.5) * scaleY;

    let breathY = 0;
    let breathZ = 0;
    let breathX = 0;

    if (config.camera.headFollow && this.headNode && this.initialHeadLocal) {
      const currentGlobal = this.headNode.getAbsolutePosition();
      const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(jugador.getWorldMatrix()));
      breathX = currentLocal.x - this.initialHeadLocal.x;
      breathY = currentLocal.y - this.initialHeadLocal.y;
      breathZ = currentLocal.z - this.initialHeadLocal.z;

      if (isNaN(breathX)) breathX = 0;
      if (isNaN(breathY)) breathY = 0;
      if (isNaN(breathZ)) breathZ = 0;
    } else {
      if (estadoFisico.isHardLanding) {
        const progress = estadoFisico.landingFrame / Math.max(1, config.physics.landingRecoveryFrames || 60);
        const dip = Math.sin(progress * Math.PI);
        targetEyeLevel -= dip * (playerHalfHeight * 1.2);
        targetPivotY -= dip * (playerHalfHeight * 1.2);
      }

      if (!estadoFisico.isMoving && estadoFisico.isGrounded && !estadoFisico.isHardLanding) {
        this.idleTime += scene.getEngine().getDeltaTime() / 1000;
        breathY = Math.sin(this.idleTime * 2.5) * 0.015;
        breathZ = Math.cos(this.idleTime * 2.5) * 0.015;
      } else {
        this.idleTime = 0;
      }
    }

    this.currentEyeLevel += (targetEyeLevel - this.currentEyeLevel) * 0.06;
    this.currentPivotY += (targetPivotY - this.currentPivotY) * 0.06;

    if (isNaN(this.currentEyeLevel)) this.currentEyeLevel = 1.6;
    if (isNaN(this.currentPivotY)) this.currentPivotY = 1.5;

    jugador.computeWorldMatrix(true);

    const sequenceLocksInput = seqRuntime.lockInput || seqRuntime.freezeOrientation;

    if (vista === 'TPS' && this.cameraPivot) {
      if (!this.isTransitioningCameras) {
        const minRadius = (config.camera.tpsMinRadius ?? 1.5) * scaleY;
        const maxRadius = (config.camera.tpsMaxRadius ?? 15) * scaleY;

        this.motor3d.playerCameraTPS.lowerRadiusLimit = minRadius;
        this.motor3d.playerCameraTPS.upperRadiusLimit = maxRadius;

        if (this.motor3d.playerCameraTPS.radius < minRadius) {
          this.motor3d.playerCameraTPS.radius = minRadius;
        }
        if (this.motor3d.playerCameraTPS.radius > maxRadius) {
          this.motor3d.playerCameraTPS.radius = maxRadius;
        }
      }

      const localPivotPos = new Vector3(
        (camMeta.x || 0) + breathX,
        (this.currentPivotY / scaleY) + breathY,
        (camMeta.z || 0) + breathZ
      );

      const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

      if (!isNaN(globalPivotPos.x) && !isNaN(globalPivotPos.y) && !isNaN(globalPivotPos.z)) {
        const lerpSpeed = this.isTransitioningCameras ? 1.0 : 0.6;
        this.cameraPivot.position = Vector3.Lerp(this.cameraPivot.position, globalPivotPos, lerpSpeed);
      }

      this.motor3d.playerCameraTPS.lockedTarget = this.cameraPivot;
    }

    if (vista === 'FPS') {
      const fpsCam = activeCamera as UniversalCamera;

      if (!sequenceLocksInput && !seqRuntime.freezeOrientation) {
        if (!jugador.rotationQuaternion) jugador.rotationQuaternion = Quaternion.Identity();
        jugador.rotationQuaternion = Quaternion.FromEulerAngles(0, fpsCam.rotation.y || 0, 0);
      }

      const localCamPos = new Vector3(
        (camMeta.x || 0) + breathX,
        (this.currentEyeLevel / scaleY) + breathY,
        (camMeta.z || 0) + breathZ
      );

      const globalCamPos = Vector3.TransformCoordinates(localCamPos, jugador.getWorldMatrix());

      if (!isNaN(globalCamPos.x) && !isNaN(globalCamPos.y) && !isNaN(globalCamPos.z)) {
        fpsCam.position = globalCamPos;
      }
    }
  }

  public limpiarPivotTPS(): void {
    this.motor3d.playerCameraTPS.lockedTarget = null;
    if (this.cameraPivot && !this.cameraPivot.isDisposed()) {
      try { this.cameraPivot.dispose(false, true); } catch {}
    }
    this.cameraPivot = null;
    this.resetearTransiciones();
  }
}