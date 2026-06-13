
import { Injectable, inject } from '@angular/core';
import {
  Mesh,
  Vector3,
  Matrix,
  TransformNode,
  UniversalCamera,
  Animation,
  CubicEase,
  EasingFunction,
  Quaternion
} from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { Motor3dService } from '../../motor-3d.service';
import { PlayerRuntimeConfig } from '../player-config.model';
import { EstadoFisico } from './player-physics.service';
import { SeqRuntime } from './player-sequence.service';

@Injectable({ providedIn: 'root' })
export class PlayerCameraManagerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

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
  }

  public inicializarCamaras(
    jugador: Mesh,
    colMeta: any,
    camMeta: any,
    vista: 'FPS' | 'TPS',
    scaleNow: Vector3,
    config: PlayerRuntimeConfig
  ): void {
    const scene = this.motor3d.scene;
    const scaleY = scaleNow.y || 1;
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
    fpsCam.keysUp = [];
    fpsCam.keysDown = [];
    fpsCam.keysLeft = [];
    fpsCam.keysRight = [];
    fpsCam.minZ = 0.01; 

    const startRot = jugador.rotationQuaternion
      ? jugador.rotationQuaternion.toEulerAngles()
      : jugador.rotation;

    fpsCam.rotation.set(startRot.x || 0, startRot.y || 0, startRot.z || 0);

    if (this.state.cameraPivot) {
      const localPivotPos = new Vector3(camMeta.x || 0, this.currentPivotY / scaleY, camMeta.z || 0);
      jugador.computeWorldMatrix(true);
      this.state.cameraPivot.position = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

      this.motor3d.playerCameraTPS.lockedTarget = this.state.cameraPivot;
      this.motor3d.playerCameraTPS.radius = (config.camera.tpsRadius || 5) * scaleY;

      this.motor3d.playerCameraTPS.lowerRadiusLimit = Math.max(0.5, (config.camera.tpsRadius || 5) * scaleY * 0.15);
      this.motor3d.playerCameraTPS.upperRadiusLimit = Math.max(1.25, (config.camera.tpsRadius || 5) * scaleY * 2.5);
      
      this.motor3d.playerCameraTPS.wheelPrecision = 15;
      this.motor3d.playerCameraTPS.panningSensibility = 0;
      this.motor3d.playerCameraTPS.allowUpsideDown = false;
    }

    if (vista === 'FPS') {
      scene.activeCamera = fpsCam;
    } else {
      scene.activeCamera = this.motor3d.playerCameraTPS;
      this.motor3d.playerCameraTPS.alpha = -(startRot.y || 0) - Math.PI / 2;
      this.motor3d.playerCameraTPS.beta = (startRot.x || 0) + Math.PI / 2;
    }
  }

  public restaurarCamaraEditor(): void {
    const scene = this.motor3d.scene;
    const currentCam = scene.activeCamera;

    if (currentCam && currentCam !== this.motor3d.editorCamera) {
      const camPos = currentCam.globalPosition.clone();
      const camTarget = camPos.add(currentCam.getDirection(Vector3.Forward()).scale(10));
      this.motor3d.editorCamera.position = camPos;
      this.motor3d.editorCamera.setTarget(camTarget);
    }

    this.motor3d.playerCameraFPS.detachControl();
    this.motor3d.playerCameraTPS.detachControl();

    scene.activeCamera = this.motor3d.editorCamera;
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      this.motor3d.editorCamera.attachControl(canvas, true);
    }

    this.headNode = null;
    this.initialHeadLocal = null;
    this.overrideTargetPivotY = null;
  }

  public toggleCameraView(jugador: Mesh, config: PlayerRuntimeConfig): void {
    if (!this.state.jugadorActivo || this.state.playState() !== 'PLAYING' || this.isTransitioningCameras) return;

    this.isTransitioningCameras = true;
    const scaleNow = jugador.scaling.y || 1;
    const targetRadius = (config.camera.tpsRadius || 5) * scaleNow;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const fpsCam = this.motor3d.playerCameraFPS;
    const tpsCam = this.motor3d.playerCameraTPS;
    const canvas = this.motor3d.engine.getRenderingCanvas();
    const scene = this.motor3d.scene;

    if (this.state.modoVistaPrueba === 'FPS') {
      if (canvas) fpsCam.detachControl();

      tpsCam.alpha = -(fpsCam.rotation.y || 0) - Math.PI / 2;
      tpsCam.beta = (fpsCam.rotation.x || 0) + Math.PI / 2;
      tpsCam.radius = 0.01;

      this.currentPivotY = this.currentEyeLevel;
      this.state.modoVistaPrueba = 'TPS';
      scene.activeCamera = tpsCam;

      const anim = Animation.CreateAndStartAnimation(
        'camRadiusOut',
        tpsCam,
        'radius',
        60,
        45,
        0.01,
        targetRadius,
        2,
        ease
      );

      anim?.onAnimationEndObservable.addOnce(() => {
        this.isTransitioningCameras = false;
        if (canvas) tpsCam.attachControl(canvas, true);
      });
    } else {
      if (canvas) tpsCam.detachControl();

      this.overrideTargetPivotY = (config.camera.fpsEyeLevel || 1.6) * scaleNow;

      const anim = Animation.CreateAndStartAnimation(
        'camRadiusIn',
        tpsCam,
        'radius',
        60,
        45,
        tpsCam.radius,
        0.01,
        2,
        ease
      );

      anim?.onAnimationEndObservable.addOnce(() => {
        this.overrideTargetPivotY = null;
        this.state.modoVistaPrueba = 'FPS';
        fpsCam.rotation.y = -(tpsCam.alpha || 0) - Math.PI / 2;
        fpsCam.rotation.x = (tpsCam.beta || 0) - Math.PI / 2;
        scene.activeCamera = fpsCam;
        if (canvas) fpsCam.attachControl(canvas, true);
        this.isTransitioningCameras = false;
      });
    }
  }

  public actualizarPosicionCamara(
    jugador: Mesh,
    activeCamera: any,
    estadoFisico: EstadoFisico,
    seqRuntime: SeqRuntime,
    colMeta: any,
    camMeta: any,
    scaleNow: Vector3,
    config: PlayerRuntimeConfig
  ): void {
    const scene = this.motor3d.scene;
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

    if (this.state.modoVistaPrueba === 'TPS' && this.state.cameraPivot) {
      if (!this.isTransitioningCameras) {
        const radiusBase = (config.camera.tpsRadius || 5) * scaleY;
        const minRadius = Math.max(0.5, radiusBase * 0.15); // Permite acercarse libremente
        const maxRadius = radiusBase * 2.5;

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
        this.state.cameraPivot.position = Vector3.Lerp(this.state.cameraPivot.position, globalPivotPos, 0.4);
      }

      this.motor3d.playerCameraTPS.lockedTarget = this.state.cameraPivot;
    }

    if (this.state.modoVistaPrueba === 'FPS') {
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

  public volverAJuego(): void {
    this.state.playState.set('TRANSITIONING');
    this.state.objetoSeleccionado.set(null);
    this.motor3d.editorCamera.detachControl();

    const targetCam = this.state.modoVistaPrueba === 'FPS'
      ? this.motor3d.playerCameraFPS
      : this.motor3d.playerCameraTPS;

    const targetPos = targetCam.globalPosition.clone();

    let targetLookAt: Vector3;
    if (this.state.modoVistaPrueba === 'FPS') {
      targetLookAt = targetCam.globalPosition.add(targetCam.getDirection(Vector3.Forward()));
    } else {
      targetLookAt = this.state.cameraPivot!.getAbsolutePosition();
    }

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    Animation.CreateAndStartAnimation(
      'camPos',
      this.motor3d.editorCamera,
      'position',
      60,
      90,
      this.motor3d.editorCamera.position,
      targetPos,
      2,
      ease
    );

    const currentTarget = this.motor3d.editorCamera.getTarget().clone();
    const animTarget = Animation.CreateAndStartAnimation(
      'camTarget',
      this.motor3d.editorCamera,
      'target',
      60,
      90,
      currentTarget,
      targetLookAt,
      2,
      ease
    );

    animTarget?.onAnimationEndObservable.addOnce(() => {
      this.motor3d.scene.activeCamera = targetCam;
      this.state.playState.set('PLAYING');
      const canvas = this.motor3d.engine.getRenderingCanvas();
      if (canvas) {
        canvas.focus();
        try {
          canvas.requestPointerLock();
        } catch (e) {}
      }
    });
  }

  public limpiarPivotTPS(): void {
    this.motor3d.playerCameraTPS.lockedTarget = null;

    if (this.state.cameraPivot && !this.state.cameraPivot.isDisposed()) {
      try {
        this.state.cameraPivot.dispose(false, true);
      } catch {
        // no-op
      }
    }

    this.state.cameraPivot = null;
    this.headNode = null;
    this.initialHeadLocal = null;
  }
}
