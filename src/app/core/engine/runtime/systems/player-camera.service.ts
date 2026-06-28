
import { Injectable, inject } from '@angular/core';
import {
  Mesh, Vector3, Matrix, TransformNode, UniversalCamera,
  Animation, CubicEase, EasingFunction, Quaternion, MeshBuilder, Tags, Animatable
} from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { EstadoFisico } from './player-physics.service';
import { SeqRuntime } from './player-sequence.service';
import { LoopManagerService, GamePhase, IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../../runtime/cameras/camera-ownership.service';
import { CAMERA_BEHAVIOR_PROFILES } from '../../runtime/cameras/camera-behavior-profile.model';
import { GameEventBusService } from '../../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class PlayerCameraManagerService implements IUpdatable {
  public id = 'PlayerCameraSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private loopManager = inject(LoopManagerService); 
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private eventBus = inject(GameEventBusService);

  public cameraPivot: Mesh | null = null;
  public introAnimatable: Animatable | null = null; 

  public currentEyeLevel = 1.6;
  public currentPivotY = 1.5;
  public idleTime = 0;
  public isTransitioningCameras = false;
  public overrideTargetPivotY: number | null = null;

  public headNode: TransformNode | null = null;
  public initialHeadLocal: Vector3 | null = null;

  private transitionTimeoutId: any = null;
  private introTimeoutId: any = null;

  public savedRelativeTpsAngle: number | null = null;
  public savedRelativeTpsPitch: number | null = null;
  
  public cameraUpdate(dtMs: number): void {
    const playerEntity = this.context.activePlayerEntity();
    const activeCamera = this.ownership.getCamera();
    
    if (playerEntity && activeCamera && playerEntity.playerRuntime?.seqRuntime) {
      this.actualizarPosicionCamara(
        playerEntity,
        activeCamera,
        playerEntity.playerRuntime.physicsState,
        playerEntity.playerRuntime.seqRuntime,
        this.context.cameraView()
      );
    }
  }

  public resetearTransiciones(): void {
    this.isTransitioningCameras = false;
    this.overrideTargetPivotY = null;
    this.idleTime = 0;
    this.loopManager.unregister('CameraFadeTransition');
    if (this.transitionTimeoutId) {
      clearTimeout(this.transitionTimeoutId);
      this.transitionTimeoutId = null;
    }
    if (this.introTimeoutId) {
      clearTimeout(this.introTimeoutId);
      this.introTimeoutId = null;
    }
  }

  public iniciarCinematicaIntro(entity: GameEntity): void {
      const config = entity.playerConfig || cloneDefaultPlayerConfig();
      const profile = CAMERA_BEHAVIOR_PROFILES[this.context.mode()];
      const scaleY = entity.transform.scale.y || 1;
      const tpsCam = this.motor3d.getPlayerCameraTPS();

      if (!tpsCam) return;

      const startRadius = 0.8 * scaleY;
      const endRadius = (config.camera.tpsMaxRadius ?? 15) * scaleY;

      tpsCam.radius = startRadius;
      
      if (entity.view) {
          const forward = entity.view.forward.clone().normalize();
          if (forward.lengthSquared() === 0) forward.copyFromFloats(0, 0, 1);
          tpsCam.alpha = Math.atan2(-forward.z, -forward.x);
          tpsCam.beta = Math.max(0.01, Math.min(Math.PI - 0.01, Math.acos(Math.max(-1, Math.min(1, -forward.y)))));
      }

      tpsCam.checkCollisions = profile.collisionsEnabled;
      tpsCam.lowerRadiusLimit = null;
      tpsCam.upperRadiusLimit = null;

      const ease = new CubicEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEOUT); 

      const animRad = new Animation('introCinematic', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      animRad.setKeys([
          { frame: 0, value: startRadius },
          { frame: 1800, value: endRadius } 
      ]);
      animRad.setEasingFunction(ease);

      if (this.introAnimatable) this.introAnimatable.stop();
      this.introAnimatable = this.motor3d.getScene().beginDirectAnimation(tpsCam, [animRad], 0, 1800, false);
  }

  public detenerCinematicaIntro(): void {
      if (this.introAnimatable) {
          this.introAnimatable.stop();
          this.introAnimatable = null;
      }
  }

  public inicializarCamaras(
    entity: GameEntity,
    vista: 'FPS' | 'TPS'
  ): void {
    const jugador = entity.view as Mesh;
    if (!jugador || jugador.isDisposed()) return; 

    if (!this.cameraPivot || this.cameraPivot.isDisposed()) {
      this.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.getScene());
      this.cameraPivot.isVisible = false;
      Tags.AddTagsTo(this.cameraPivot, "system_element ignore_raycast");
    }

    const colMeta = entity.collider;
    const camMeta = entity.camOffset;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const profile = CAMERA_BEHAVIOR_PROFILES[this.context.mode()];
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

    const fpsCam = this.motor3d.getPlayerCameraFPS();
    fpsCam.keysUp = []; fpsCam.keysDown = []; fpsCam.keysLeft = []; fpsCam.keysRight = [];
    fpsCam.minZ = profile.minZ; 
    fpsCam.angularSensibility = profile.angularSensibilityX;
    fpsCam.fov = profile.fov;

    jugador.computeWorldMatrix(true);
    const forward = jugador.forward.clone().normalize();
    if (forward.lengthSquared() === 0) forward.copyFromFloats(0, 0, 1);

    const yaw = Math.atan2(forward.x, forward.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -forward.y))); 

    fpsCam.rotation.set(pitch, yaw, 0);

    if (this.cameraPivot) {
      const localPivotPos = new Vector3(camMeta.x || 0, this.currentPivotY / scaleY, camMeta.z || 0);
      jugador.computeWorldMatrix(true);
      this.cameraPivot.position = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

      this.motor3d.getPlayerCameraTPS().lockedTarget = this.cameraPivot;
      
      const radBase = (config.camera.tpsRadius || 5) * scaleY;
      const minRad = (config.camera.tpsMinRadius ?? 1.5) * scaleY;
      const maxRad = (config.camera.tpsMaxRadius ?? 15) * scaleY;
      
      this.motor3d.getPlayerCameraTPS().radius = radBase;
      this.motor3d.getPlayerCameraTPS().lowerRadiusLimit = minRad;
      this.motor3d.getPlayerCameraTPS().upperRadiusLimit = maxRad;
      this.motor3d.getPlayerCameraTPS().minZ = profile.minZ;
      
      this.motor3d.getPlayerCameraTPS().checkCollisions = profile.collisionsEnabled;
      
      this.motor3d.getPlayerCameraTPS().collisionRadius = new Vector3(0.25, 0.25, 0.25); 
      this.motor3d.getPlayerCameraTPS().upperBetaLimit = (Math.PI / 2) + 0.4;
      
      this.motor3d.getPlayerCameraTPS().wheelPrecision = 15;
      this.motor3d.getPlayerCameraTPS().panningSensibility = 0;
      this.motor3d.getPlayerCameraTPS().allowUpsideDown = false;

      this.motor3d.getPlayerCameraTPS().angularSensibilityX = profile.angularSensibilityX;
      this.motor3d.getPlayerCameraTPS().angularSensibilityY = profile.angularSensibilityY;
      this.motor3d.getPlayerCameraTPS().fov = profile.fov;

      this.motor3d.getPlayerCameraTPS().alpha = Math.atan2(-forward.z, -forward.x);
      this.motor3d.getPlayerCameraTPS().beta = Math.max(0.01, Math.min(Math.PI - 0.01, Math.acos(Math.max(-1, Math.min(1, -forward.y)))));
      this.motor3d.getPlayerCameraTPS().getViewMatrix(true);
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

  public transicionSalidaPlataforma(entity: GameEntity, onComplete: () => void): void {
    this.isTransitioningCameras = true;
    const jugador = entity.view as Mesh;
    if (!jugador) {
        onComplete();
        return;
    }

    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const scaleY = entity.transform.scale.y || 1;
    const vista = this.context.cameraView();

    const tpsCam = this.motor3d.getPlayerCameraTPS();

    if (vista === 'FPS') {
        const tpsPivotY = (config.camera.tpsPivotY || 1.5) * scaleY;
        const camMeta = entity.camOffset || { x: 0, y: 1.6, z: 0 };
        const localPivotPos = new Vector3(camMeta.x || 0, tpsPivotY / scaleY, camMeta.z || 0);
        jugador.computeWorldMatrix(true);
        const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

        const playerForward = jugador.forward.clone().normalize();
        if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);

        const maxR = (config.camera.tpsMaxRadius ?? 15) * scaleY;
        
        this.context.setCameraView('TPS');
        this.eventBus.emit({ type: 'CameraViewChanged', payload: 'TPS' });
        
        tpsCam.alpha = Math.atan2(-playerForward.z, -playerForward.x);
        tpsCam.beta = Math.max(0.01, Math.min(Math.PI - 0.01, Math.acos(Math.max(-1, Math.min(1, -playerForward.y)))));
        tpsCam.radius = maxR;
        
        if (!this.cameraPivot || this.cameraPivot.isDisposed()) {
          this.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.getScene());
          this.cameraPivot.isVisible = false;
          Tags.AddTagsTo(this.cameraPivot, "system_element ignore_raycast");
        }
        this.cameraPivot.position.copyFrom(globalPivotPos);
        tpsCam.lockedTarget = this.cameraPivot;
        tpsCam.getViewMatrix(true);
        
        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        this.ownership.setCamera('PLAYER_TPS', tpsCam, canvas, true);
        
        onComplete();
    } else {
        const playerForward = jugador.forward.clone().normalize();
        if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);
        const playerAlpha = Math.atan2(-playerForward.z, -playerForward.x);
        this.savedRelativeTpsAngle = tpsCam.alpha - playerAlpha;
        this.savedRelativeTpsPitch = tpsCam.beta;

        onComplete();
    }
  }

  public transicionEntradaPlataforma(entity: GameEntity): void {
      const jugador = entity.view as Mesh;
      if (!jugador) return;

      this.isTransitioningCameras = true;

      if (!this.cameraPivot || this.cameraPivot.isDisposed()) {
        this.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.getScene());
        this.cameraPivot.isVisible = false;
        Tags.AddTagsTo(this.cameraPivot, "system_element ignore_raycast");
      }

      const config = entity.playerConfig || cloneDefaultPlayerConfig();
      const scaleY = entity.transform.scale.y || 1;
      const tpsCam = this.motor3d.getPlayerCameraTPS();

      const tpsPivotY = (config.camera.tpsPivotY || 1.5) * scaleY;
      const maxR = (config.camera.tpsMaxRadius ?? 15) * scaleY;

      jugador.computeWorldMatrix(true);
      const playerForward = jugador.forward.clone().normalize();
      if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);

      const camMeta = entity.camOffset || { x: 0, y: 1.6, z: 0 };
      const localPivotPos = new Vector3(camMeta.x || 0, tpsPivotY / scaleY, camMeta.z || 0);
      const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());
      
      this.cameraPivot.position.copyFrom(globalPivotPos);

      const playerAlpha = Math.atan2(-playerForward.z, -playerForward.x);

      if (this.savedRelativeTpsAngle !== null && this.savedRelativeTpsPitch !== null) {
          tpsCam.alpha = playerAlpha + this.savedRelativeTpsAngle;
          tpsCam.beta = this.savedRelativeTpsPitch;
          this.savedRelativeTpsAngle = null;
          this.savedRelativeTpsPitch = null;
      } else {
          tpsCam.alpha = playerAlpha;
          tpsCam.beta = Math.max(0.01, Math.min(Math.PI - 0.01, Math.acos(Math.max(-1, Math.min(1, -playerForward.y)))));
      }

      const startRadius = 0.05;
      tpsCam.radius = startRadius;
      tpsCam.checkCollisions = false;

      tpsCam.setTarget(this.cameraPivot);
      tpsCam.getViewMatrix(true);

      jugador.visibility = 0;
      jugador.getChildMeshes().forEach(m => m.visibility = 0);
      
      const canvas = this.motor3d.getEngine().getRenderingCanvas();
      this.ownership.setCamera('PLAYER_TPS', tpsCam, canvas, true);

      if (this.introTimeoutId) clearTimeout(this.introTimeoutId);

      this.introTimeoutId = setTimeout(() => {
          const ease = new CubicEase();
          ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

          const frames = 150; 
          const animRad = new Animation('enterPlatRadius', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
          animRad.setKeys([
              { frame: 0, value: startRadius },
              { frame: frames, value: maxR }
          ]);
          animRad.setEasingFunction(ease);

          const fadeLimit = 2.5 * scaleY;

          this.loopManager.register('CameraFadeTransition', GamePhase.CAMERA, () => {
              if (tpsCam.radius < fadeLimit) {
                 jugador.visibility = Math.max(0, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
                 jugador.getChildMeshes().forEach(m => m.visibility = jugador.visibility);
              } else {
                 jugador.visibility = 1;
                 jugador.getChildMeshes().forEach(m => m.visibility = 1);
              }
          });

          this.motor3d.getScene().beginDirectAnimation(tpsCam, [animRad], 0, frames, false, 1.0, () => {
              this.isTransitioningCameras = false;
              this.loopManager.unregister('CameraFadeTransition');
              
              jugador.visibility = 1;
              jugador.getChildMeshes().forEach(m => m.visibility = 1);
              
              const profile = CAMERA_BEHAVIOR_PROFILES[this.context.mode()];
              tpsCam.checkCollisions = profile.collisionsEnabled;
              this.eventBus.emit({ type: 'GameResumed' });
          });
      }, 1000);
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
    const profile = CAMERA_BEHAVIOR_PROFILES[this.context.mode()];
    
    const minR = (config.camera.tpsMinRadius ?? 1.5) * scaleNow;
    const maxR = (config.camera.tpsMaxRadius ?? 15) * scaleNow;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const fpsCam = this.motor3d.getPlayerCameraFPS();
    const tpsCam = this.motor3d.getPlayerCameraTPS();
    const canvas = this.motor3d.getEngine().getRenderingCanvas();

    const framesTransicion = customFrames !== undefined ? customFrames : (isCinematicInitial ? 300 : 45);

    this.loopManager.unregister('CameraFadeTransition');

    if (this.transitionTimeoutId) {
      clearTimeout(this.transitionTimeoutId);
      this.transitionTimeoutId = null;
    }

    const durationMs = (framesTransicion / 60) * 1000;
    this.transitionTimeoutId = setTimeout(() => {
      if (this.isTransitioningCameras) {
        this.resetearTransiciones();
        if (jugador && !jugador.isDisposed()) {
          const targetVisibility = currentVista === 'FPS' ? 1 : 0;
          jugador.visibility = targetVisibility;
          jugador.getChildMeshes().forEach(m => m.visibility = targetVisibility);
        }
      }
    }, durationMs + 500);

    const fadeLimit = 2.5 * scaleNow;

    if (currentVista === 'FPS') {
      tpsCam.checkCollisions = profile.collisionsEnabled;
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

      this.overrideTargetPivotY = null;
      
      onVistaChanged('TPS');
      this.ownership.setCamera('PLAYER_TPS', tpsCam, canvas, attachControlForce);

      this.loopManager.register('CameraFadeTransition', GamePhase.CAMERA, () => {
          if (tpsCam.radius < fadeLimit) {
             jugador.visibility = Math.max(0, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
             jugador.getChildMeshes().forEach(m => m.visibility = jugador.visibility);
          } else {
             jugador.visibility = 1;
             jugador.getChildMeshes().forEach(m => m.visibility = 1);
          }
      });

      const animRad = Animation.CreateAndStartAnimation('camRadiusOut', tpsCam, 'radius', 60, framesTransicion, 0.05, maxR, 2, ease);

      animRad?.onAnimationEndObservable.addOnce(() => {
        this.resetearTransiciones();
        jugador.visibility = 1;
        jugador.getChildMeshes().forEach(m => m.visibility = 1);
      });
    } else {
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
        
        this.resetearTransiciones();
        tpsCam.checkCollisions = profile.collisionsEnabled;

        jugador.visibility = 0;
        jugador.getChildMeshes().forEach(m => m.visibility = 0);
        
        this.ownership.setCamera('PLAYER_FPS', fpsCam, canvas, attachControlForce);
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
    if (activeCamera !== this.motor3d.getPlayerCameraFPS() && activeCamera !== this.motor3d.getPlayerCameraTPS()) return;

    const jugador = entity.view as Mesh;
    if (!jugador) return;

    const scene = this.motor3d.getScene();
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

        this.motor3d.getPlayerCameraTPS().lowerRadiusLimit = minRadius;
        this.motor3d.getPlayerCameraTPS().upperRadiusLimit = maxRadius;
      }

      const localPivotPos = new Vector3(
        (camMeta.x || 0) + breathX,
        (this.currentPivotY / scaleY) + breathY,
        (camMeta.z || 0) + breathZ
      );

      const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

      if (!isNaN(globalPivotPos.x) && !isNaN(globalPivotPos.y) && !isNaN(globalPivotPos.z)) {
        if (Vector3.Distance(this.cameraPivot.position, globalPivotPos) > 20) {
            this.cameraPivot.position.copyFrom(globalPivotPos);
        } else {
            const lerpSpeed = this.isTransitioningCameras ? 1.0 : 0.6;
            this.cameraPivot.position = Vector3.Lerp(this.cameraPivot.position, globalPivotPos, lerpSpeed);
        }
      }

      this.motor3d.getPlayerCameraTPS().lockedTarget = this.cameraPivot;
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
    this.motor3d.getPlayerCameraTPS().lockedTarget = null;
    if (this.cameraPivot && !this.cameraPivot.isDisposed()) {
      try { this.cameraPivot.dispose(false, true); } catch {}
    }
    this.cameraPivot = null;
    this.resetearTransiciones();
  }

  private getLookQuat(pos: Vector3, target: Vector3, fallbackForward: Vector3): Quaternion {
      let dir = target.subtract(pos);
      if (dir.lengthSquared() < 0.001) dir = fallbackForward.clone();
      dir.normalize();
      
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
      
      return Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
  }

  private animateCameraProxy(
    startPos: Vector3,
    startTarget: Vector3,
    endPos: Vector3,
    endTarget: Vector3,
    frames: number,
    onComplete: () => void,
    addArc: boolean = false,
    onUpdate?: (t: number) => void
  ): void {
    const scene = this.motor3d.getScene();

    const proxyCam = new UniversalCamera("proxyTransitionCam", startPos.clone(), scene);
    proxyCam.minZ = 0.05;
    proxyCam.maxZ = 50000;
    
    if (this.motor3d.getRenderingPipeline()) {
       this.motor3d.getRenderingPipeline().addCamera(proxyCam);
    }

    const startForward = startTarget.subtract(startPos).normalize();
    const endForward = endTarget.subtract(endPos).normalize();

    const startQuat = this.getLookQuat(startPos, startTarget, startForward);
    const endQuat = this.getLookQuat(endPos, endTarget, endForward);
    proxyCam.rotationQuaternion = startQuat.clone();

    this.ownership.setCamera('TRANSITION_PROXY', proxyCam, null, false);

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const fps = 60;
    const animPos = new Animation("proxyPos", "position", fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animPos.setEasingFunction(ease);

    if (addArc) {
      const midPos = Vector3.Lerp(startPos, endPos, 0.5);
      const dist = Vector3.Distance(startPos, endPos);
      midPos.y += Math.min(dist * 0.25, 4.0); 
      
      animPos.setKeys([
        { frame: 0, value: startPos },
        { frame: frames * 0.5, value: midPos },
        { frame: frames, value: endPos }
      ]);
    } else {
      animPos.setKeys([
        { frame: 0, value: startPos },
        { frame: frames, value: endPos }
      ]);
    }

    const animRot = new Animation("proxyRot", "rotationQuaternion", fps, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animRot.setEasingFunction(ease);
    animRot.setKeys([
      { frame: 0, value: startQuat },
      { frame: frames, value: endQuat }
    ]);

    let frameCount = 0;
    let observer: any = null;
    if (onUpdate) {
        observer = scene.onBeforeRenderObservable.add(() => {
            frameCount++;
            onUpdate(Math.min(1, frameCount / frames));
            if (frameCount >= frames) scene.onBeforeRenderObservable.remove(observer);
        });
    }

    scene.beginDirectAnimation(proxyCam, [animPos, animRot], 0, frames, false, 1.0, () => {
      if (this.motor3d.getRenderingPipeline()) {
         this.motor3d.getRenderingPipeline().removeCamera(proxyCam);
      }
      if (observer) scene.onBeforeRenderObservable.remove(observer);
      
      onComplete();
      
      proxyCam.dispose();
      
      const trackedCamera = this.ownership.getCamera();
      if (trackedCamera) {
          scene.activeCameras = [];
          scene.activeCamera = trackedCamera;
      }
    });
  }}