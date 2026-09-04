
import { Injectable, inject } from '@angular/core';
import {
  Mesh, Vector3, Matrix, TransformNode, UniversalCamera,
  Animation, CubicEase, EasingFunction, Quaternion, MeshBuilder, Tags, Animatable, Camera, ArcRotateCamera
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
import { TransformTelemetryService } from '../../telemetry/transform-telemetry.service';

export class PlayerCameraUpdater {
  private _localPivotPos = Vector3.Zero();
  private _localCamPos = Vector3.Zero();
  private _globalPivotPos = Vector3.Zero();
  private _globalCamPos = Vector3.Zero();

  constructor(
    private manager: PlayerCameraManagerService,
    private motor3d: ISceneAccess,
    private context: GameContextService,
    private ownership: CameraOwnershipService
  ) {}

  public cameraUpdate(dtMs: number): void {
    const playerEntity = this.context.activePlayerEntity();
    const activeCamera = this.ownership.getCamera();
    
    if (playerEntity && activeCamera && playerEntity.playerRuntime?.seqRuntime) {
      
      const telemetry = TransformTelemetryService.instance;
      if (telemetry && telemetry.enabled && playerEntity.view) {
         telemetry.logEvent(playerEntity.uid, playerEntity.rol, 'PlayerCameraUpdater', 'getWorldMatrix', 'READ', undefined, undefined);
      }

      this.actualizarPosicionCamara(
        playerEntity,
        activeCamera,
        playerEntity.playerRuntime.physicsState,
        playerEntity.playerRuntime.seqRuntime,
        this.context.cameraView()
      );
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

    const playerHalfHeight = colMeta.sizeY || 0.9;
    const playerEyeLevel = config.camera.fpsEyeLevel ?? camMeta.y ?? 1.6;

    let targetEyeLevel = playerEyeLevel;
    let targetPivotY = this.manager.overrideTargetPivotY !== null
      ? this.manager.overrideTargetPivotY
      : (config.camera.tpsPivotY ?? 1.5);

    let breathY = 0;
    let breathZ = 0;
    let breathX = 0;

    this.manager.breathLerp = 1.0;

    if (config.camera.headFollow && this.manager.headNode && this.manager.initialHeadLocal) {
      const currentGlobal = this.manager.headNode.getAbsolutePosition();
      const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(jugador.getWorldMatrix()));
      
      const rawBreathX = (currentLocal.x - this.manager.initialHeadLocal.x) * this.manager.breathLerp;
      const rawBreathY = (currentLocal.y - this.manager.initialHeadLocal.y) * this.manager.breathLerp;
      const rawBreathZ = (currentLocal.z - this.manager.initialHeadLocal.z) * this.manager.breathLerp;

      const lerpSpeed = (estadoFisico.isMoving || estadoFisico.isJumping || estadoFisico.isFalling) ? 0.08 : 0.15;

      this.manager.currentBreathX += (rawBreathX - this.manager.currentBreathX) * lerpSpeed;
      this.manager.currentBreathY += (rawBreathY - this.manager.currentBreathY) * lerpSpeed;
      this.manager.currentBreathZ += (rawBreathZ - this.manager.currentBreathZ) * lerpSpeed;

      breathX = this.manager.currentBreathX;
      breathY = this.manager.currentBreathY;
      breathZ = this.manager.currentBreathZ;
    } else {
      if (estadoFisico.isHardLanding) {
        const progress = estadoFisico.landingFrame / Math.max(1, config.physics.landingRecoveryFrames || 60);
        const dip = Math.sin(progress * Math.PI);
        targetEyeLevel -= dip * (playerHalfHeight * 1.2);
        targetPivotY -= dip * (playerHalfHeight * 1.2);
      }

      if (!estadoFisico.isMoving && estadoFisico.isGrounded && !estadoFisico.isHardLanding) {
        this.manager.idleTime += scene.getEngine().getDeltaTime() / 1000;
        breathY = Math.sin(this.manager.idleTime * 2.5) * 0.015;
        breathZ = Math.cos(this.manager.idleTime * 2.5) * 0.015;
      } else {
        this.manager.idleTime = 0;
      }
    }

    this.manager.currentEyeLevel += (targetEyeLevel - this.manager.currentEyeLevel) * 0.06;
    this.manager.currentPivotY += (targetPivotY - this.manager.currentPivotY) * 0.06;

    if (isNaN(this.manager.currentEyeLevel)) this.manager.currentEyeLevel = 1.6;
    if (isNaN(this.manager.currentPivotY)) this.manager.currentPivotY = 1.5;

    jugador.computeWorldMatrix(true);

    if (vista === 'TPS' && this.manager.cameraPivot) {
      if (!this.manager.isTransitioningCameras) {
        const minRadius = (config.camera.tpsMinRadius ?? 1.5) * scaleY;
        const maxRadius = (config.camera.tpsMaxRadius ?? 15) * scaleY;

        this.motor3d.getPlayerCameraTPS().lowerRadiusLimit = minRadius;
        this.motor3d.getPlayerCameraTPS().upperRadiusLimit = maxRadius;
      }

      this._localPivotPos.set(
        (camMeta.x || 0) + breathX,
        this.manager.currentPivotY + breathY,
        (camMeta.z || 0) + breathZ
      );

      Vector3.TransformCoordinatesToRef(this._localPivotPos, jugador.getWorldMatrix(), this._globalPivotPos);

      if (!isNaN(this._globalPivotPos.x) && !isNaN(this._globalPivotPos.y) && !isNaN(this._globalPivotPos.z)) {
        if (Vector3.DistanceSquared(this.manager.cameraPivot.position, this._globalPivotPos) > 400) {
            this.manager.cameraPivot.position.copyFrom(this._globalPivotPos);
        } else {
            const diffY = this._globalPivotPos.y - this.manager.cameraPivot.position.y;
            
            // 🔥 FIX FASE 3: Reducimos el umbral de SNAP a 0.0001
            // Esto garantiza que micro-variaciones por el terreno sean interpoladas suavemente
            // en vez de causar un temblor instantáneo en la cámara.
            if (Math.abs(diffY) < 0.0001 && !this.manager.isTransitioningCameras) {
                this.manager.cameraPivot.position.y = this._globalPivotPos.y;
            } else {
                const lerpSpeedXZ = this.manager.isTransitioningCameras ? 1.0 : 0.8;
                this.manager.cameraPivot.position.x += (this._globalPivotPos.x - this.manager.cameraPivot.position.x) * lerpSpeedXZ;
                this.manager.cameraPivot.position.z += (this._globalPivotPos.z - this.manager.cameraPivot.position.z) * lerpSpeedXZ;
                
                const lerpSpeedY = this.manager.isTransitioningCameras ? 1.0 : ((estadoFisico.isJumping || estadoFisico.isFalling) ? 0.95 : 0.2);
                this.manager.cameraPivot.position.y += diffY * lerpSpeedY;
            }
        }
      }

      this.motor3d.getPlayerCameraTPS().lockedTarget = this.manager.cameraPivot;
    }

    if (vista === 'FPS') {
      const fpsCam = activeCamera as UniversalCamera;

      this._localCamPos.set(
        (camMeta.x || 0) + breathX,
        this.manager.currentEyeLevel + breathY,
        (camMeta.z || 0) + breathZ
      );

      Vector3.TransformCoordinatesToRef(this._localCamPos, jugador.getWorldMatrix(), this._globalCamPos);

      if (!isNaN(this._globalCamPos.x) && !isNaN(this._globalCamPos.y) && !isNaN(this._globalCamPos.z)) {
        if (this.manager.isTransitioningCameras) {
            fpsCam.position.x += (this._globalCamPos.x - fpsCam.position.x) * 0.5;
            fpsCam.position.z += (this._globalCamPos.z - fpsCam.position.z) * 0.5;
            fpsCam.position.y += (this._globalCamPos.y - fpsCam.position.y) * 0.5;
        } else {
            // 🔥 FIX CRÍTICO FASE 3: En FPS no debe haber Latencia Vertical en el Gameplay regular, 
            // de lo contrario la cabeza atraviesa la cámara (ojos) al saltar/caer bruscamente.
            // Gracias a que eliminamos el Jitter físico del jugador, esta asignación directa ahora es perfectamente suave.
            fpsCam.position.copyFrom(this._globalCamPos);
        }
      }
    }
  }
}

export class PlayerCameraTransitions {
  private introAnimatable: Animatable | null = null;
  private transitionTimeoutId: any = null;
  private introTimeoutId: any = null;
  public savedRelativeTpsAngle: number | null = null;
  public savedRelativeTpsPitch: number | null = null;

  constructor(
    private manager: PlayerCameraManagerService,
    private motor3d: ISceneAccess,
    private loopManager: LoopManagerService,
    private context: GameContextService,
    private ownership: CameraOwnershipService,
    private eventBus: GameEventBusService
  ) {}

  public resetearTransiciones(): void {
    this.manager.isTransitioningCameras = false;
    this.manager.overrideTargetPivotY = null;
    this.manager.idleTime = 0;
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

      tpsCam.checkCollisions = false;
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
      
      const entity = this.context.activePlayerEntity();
      if (entity) {
          const config = entity.playerConfig || cloneDefaultPlayerConfig();
          const scaleY = entity.transform.scale.y || 1;
          const tpsCam = this.motor3d.getPlayerCameraTPS();
          this.manager.aplicarPerfilACamara(tpsCam, 'TPS', config, scaleY);
      }
  }

  public transicionSalidaPlataforma(entity: GameEntity, onComplete: () => void): void {
    this.manager.isTransitioningCameras = true;
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
        const tpsPivotY = config.camera.tpsPivotY ?? 1.5;
        const camMeta = entity.camOffset || { x: 0, y: 1.6, z: 0 };
        const localPivotPos = new Vector3(camMeta.x || 0, tpsPivotY, camMeta.z || 0);
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
        
        if (!this.manager.cameraPivot || this.manager.cameraPivot.isDisposed()) {
          this.manager.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.getScene());
          this.manager.cameraPivot.isVisible = false;
          Tags.AddTagsTo(this.manager.cameraPivot, "system_element ignore_raycast");
        }
        this.manager.cameraPivot.position.copyFrom(globalPivotPos);
        tpsCam.lockedTarget = this.manager.cameraPivot;
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

      this.manager.isTransitioningCameras = true;

      if (!this.manager.cameraPivot || this.manager.cameraPivot.isDisposed()) {
        this.manager.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.getScene());
        this.manager.cameraPivot.isVisible = false;
        Tags.AddTagsTo(this.manager.cameraPivot, "system_element ignore_raycast");
      }

      const config = entity.playerConfig || cloneDefaultPlayerConfig();
      const scaleY = entity.transform.scale.y || 1;
      const tpsCam = this.motor3d.getPlayerCameraTPS();

      const tpsPivotY = config.camera.tpsPivotY ?? 1.5;
      const maxR = (config.camera.tpsMaxRadius ?? 15) * scaleY;

      jugador.computeWorldMatrix(true);
      const playerForward = jugador.forward.clone().normalize();
      if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);

      const camMeta = entity.camOffset || { x: 0, y: 1.6, z: 0 };
      const localPivotPos = new Vector3(camMeta.x || 0, tpsPivotY, camMeta.z || 0);
      const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());
      
      this.manager.cameraPivot.position.copyFrom(globalPivotPos);

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

      tpsCam.setTarget(this.manager.cameraPivot);
      tpsCam.getViewMatrix(true);
      
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
                 let alpha = Math.max(0.0001, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
                 jugador.visibility = alpha;
                 jugador.getChildMeshes().forEach(m => m.visibility = alpha);
              } else {
                 jugador.visibility = 1;
                 jugador.getChildMeshes().forEach(m => m.visibility = 1);
              }
          });

          this.motor3d.getScene().beginDirectAnimation(tpsCam, [animRad], 0, frames, false, 1.0, () => {
              this.manager.isTransitioningCameras = false;
              this.loopManager.unregister('CameraFadeTransition');
              
              jugador.visibility = 1;
              jugador.getChildMeshes().forEach(m => m.visibility = 1);
              
              this.manager.aplicarPerfilACamara(tpsCam, 'TPS', config, scaleY);
              
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
    if (!jugador || this.manager.isTransitioningCameras) return;

    this.manager.isTransitioningCameras = true;
    const scaleNow = entity.transform.scale.y || 1;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    
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
      if (this.manager.isTransitioningCameras) {
        this.resetearTransiciones();
        if (jugador && !jugador.isDisposed()) {
          jugador.visibility = 1;
          jugador.getChildMeshes().forEach(m => m.visibility = 1);
        }
      }
    }, durationMs + 500);

    const fadeLimit = 2.5 * scaleNow;

    if (currentVista === 'FPS') {
      
      tpsCam.checkCollisions = false;
      tpsCam.lowerRadiusLimit = null;
      tpsCam.upperRadiusLimit = null;

      if (this.manager.cameraPivot) {
        this.manager.cameraPivot.position.copyFrom(fpsCam.globalPosition);
      }

      tpsCam.alpha = -(fpsCam.rotation.y || 0) - Math.PI / 2;
      const currentBeta = (fpsCam.rotation.x || 0) + Math.PI / 2;
      
      tpsCam.beta = currentBeta;
      tpsCam.radius = 0.05; 

      tpsCam.inertialAlphaOffset = 0;
      tpsCam.inertialBetaOffset = 0;
      tpsCam.inertialRadiusOffset = 0;

      this.manager.overrideTargetPivotY = null;
      
      onVistaChanged('TPS');
      this.ownership.setCamera('PLAYER_TPS', tpsCam, canvas, attachControlForce);

      this.loopManager.register('CameraFadeTransition', GamePhase.CAMERA, () => {
          if (tpsCam.radius < fadeLimit) {
             let alpha = Math.max(0.0001, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
             jugador.visibility = alpha;
             jugador.getChildMeshes().forEach(m => m.visibility = alpha);
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
        this.manager.updateFirstPersonVisibility(false);
        
        this.manager.aplicarPerfilACamara(tpsCam, 'TPS', config, scaleNow);
      });
    } else {
      const fixedAlpha = tpsCam.alpha;
      const fixedBeta = tpsCam.beta;

      tpsCam.checkCollisions = false;
      tpsCam.lowerRadiusLimit = null;
      tpsCam.upperRadiusLimit = null;

      this.manager.overrideTargetPivotY = config.camera.fpsEyeLevel ?? 1.6;

      this.loopManager.register('CameraFadeTransition', GamePhase.CAMERA, () => {
          tpsCam.alpha = fixedAlpha;
          tpsCam.beta = fixedBeta;

          if (tpsCam.radius < fadeLimit) {
             let alpha = Math.max(0.0001, (tpsCam.radius - 0.05) / (fadeLimit - 0.05));
             jugador.visibility = alpha;
             jugador.getChildMeshes().forEach(m => m.visibility = alpha);
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

        jugador.computeWorldMatrix(true);
        const camMeta = entity.camOffset || { x: 0, y: 1.6, z: 0 };
        const localCamPos = new Vector3(camMeta.x || 0, config.camera.fpsEyeLevel ?? 1.6, camMeta.z || 0);
        fpsCam.position = Vector3.TransformCoordinates(localCamPos, jugador.getWorldMatrix());
        
        this.resetearTransiciones();
        
        jugador.visibility = 1;
        jugador.getChildMeshes().forEach(m => m.visibility = 1);
        this.manager.updateFirstPersonVisibility(true);
        
        this.ownership.setCamera('PLAYER_FPS', fpsCam, canvas, attachControlForce);
        
        this.manager.aplicarPerfilACamara(fpsCam, 'FPS', config, scaleNow);
        this.manager.aplicarPerfilACamara(tpsCam, 'TPS', config, scaleNow);
      });
    }
  }
}

@Injectable({ providedIn: 'root' })
export class PlayerCameraManagerService implements IUpdatable {
  public id = 'PlayerCameraSystem';
  private motor3d = inject(SCENE_ACCESS_TOKEN);
  private loopManager = inject(LoopManagerService); 
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private eventBus = inject(GameEventBusService);

  public cameraPivot: Mesh | null = null;
  public currentEyeLevel = 1.6;
  public currentPivotY = 1.5;
  public idleTime = 0;
  public isTransitioningCameras = false;
  public overrideTargetPivotY: number | null = null;
  public headNode: TransformNode | null = null;
  public initialHeadLocal: Vector3 | null = null;
  public breathLerp = 1.0; 
  
  public currentBreathX = 0;
  public currentBreathY = 0;
  public currentBreathZ = 0;

  private updater: PlayerCameraUpdater;
  private transitions: PlayerCameraTransitions;

  constructor() {
    this.updater = new PlayerCameraUpdater(this, this.motor3d, this.context, this.ownership);
    this.transitions = new PlayerCameraTransitions(this, this.motor3d, this.loopManager, this.context, this.ownership, this.eventBus);
  }

  public cameraUpdate(dtMs: number): void {
    this.updater.cameraUpdate(dtMs);
  }

  public resetearTransiciones(): void {
    this.transitions.resetearTransiciones();
  }

  public iniciarCinematicaIntro(entity: GameEntity): void {
    this.transitions.iniciarCinematicaIntro(entity);
  }

  public detenerCinematicaIntro(): void {
    this.transitions.detenerCinematicaIntro();
  }

  public transicionSalidaPlataforma(entity: GameEntity, onComplete: () => void): void {
    this.transitions.transicionSalidaPlataforma(entity, onComplete);
  }

  public transicionEntradaPlataforma(entity: GameEntity): void {
    this.transitions.transicionEntradaPlataforma(entity);
  }

  public toggleCameraView(
    entity: GameEntity, 
    currentVista: 'FPS' | 'TPS', 
    isCinematicInitial: boolean = false,
    attachControlForce: boolean = true,
    onVistaChanged: (newVista: 'FPS' | 'TPS') => void,
    customFrames?: number
  ): void {
    this.transitions.toggleCameraView(entity, currentVista, isCinematicInitial, attachControlForce, onVistaChanged, customFrames);
  }

  public updateFirstPersonVisibility(isFPS: boolean): void {
    if (this.headNode) {
      if (isFPS) {
        this.headNode.scaling.set(0.001, 0.001, 0.001);
      } else {
        this.headNode.scaling.set(1, 1, 1);
      }
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

    const camMeta = entity.camOffset;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const scaleY = entity.transform.scale.y || 1;

    const playerEyeLevel = config.camera.fpsEyeLevel ?? camMeta.y ?? 1.6;
    this.currentEyeLevel = playerEyeLevel;
    this.currentPivotY = config.camera.tpsPivotY ?? 1.5;
    
    this.currentBreathX = 0;
    this.currentBreathY = 0;
    this.currentBreathZ = 0;

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
    
    this.aplicarPerfilACamara(fpsCam, 'FPS', config, scaleY);

    jugador.computeWorldMatrix(true);
    const forward = jugador.forward.clone().normalize();
    if (forward.lengthSquared() === 0) forward.copyFromFloats(0, 0, 1);

    const yaw = Math.atan2(forward.x, forward.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -forward.y))); 

    fpsCam.rotation.set(pitch, yaw, 0);

    if (this.cameraPivot) {
      const localPivotPos = new Vector3(camMeta.x || 0, this.currentPivotY, camMeta.z || 0);
      jugador.computeWorldMatrix(true);
      this.cameraPivot.position = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

      const tpsCam = this.motor3d.getPlayerCameraTPS();
      tpsCam.lockedTarget = this.cameraPivot;
      
      this.aplicarPerfilACamara(tpsCam, 'TPS', config, scaleY);
      
      const radBase = (config.camera.tpsRadius || 5) * scaleY;
      tpsCam.radius = radBase;
      tpsCam.alpha = Math.atan2(-forward.z, -forward.x);
      tpsCam.beta = Math.max(0.01, Math.min(Math.PI - 0.01, Math.acos(Math.max(-1, Math.min(1, -forward.y)))));
      tpsCam.getViewMatrix(true);
    }

    if (vista === 'FPS') {
      jugador.visibility = 1;
      jugador.getChildMeshes().forEach(m => m.visibility = 1);
      this.updateFirstPersonVisibility(true);
      
      const localCamPos = new Vector3(camMeta.x || 0, this.currentEyeLevel, camMeta.z || 0);
      fpsCam.position = Vector3.TransformCoordinates(localCamPos, jugador.getWorldMatrix());
      fpsCam.getViewMatrix(true);
    } else {
      jugador.visibility = 1;
      jugador.getChildMeshes().forEach(m => m.visibility = 1);
      this.updateFirstPersonVisibility(false);
    }
  }

  public limpiarPivotTPS(): void {
    const tpsCam = this.motor3d.getPlayerCameraTPS();
    if (tpsCam) tpsCam.lockedTarget = null;
    
    if (this.cameraPivot && !this.cameraPivot.isDisposed()) {
      try { this.cameraPivot.dispose(false, true); } catch {}
    }
    this.cameraPivot = null;
    this.resetearTransiciones();
  }

  public aplicarPerfilACamara(camara: Camera, vista: 'FPS' | 'TPS', config: any, scaleY: number): void {
      const profile = CAMERA_BEHAVIOR_PROFILES[this.context.mode()];
      if (!profile) return;

      if (vista === 'FPS') {
          const fpsCam = camara as UniversalCamera;
          fpsCam.minZ = profile.minZ;
          fpsCam.maxZ = 500000;
          fpsCam.angularSensibility = profile.angularSensibilityX;
          fpsCam.fov = profile.fov;
          fpsCam.checkCollisions = false; 
      } else {
          const tpsCam = camara as ArcRotateCamera;
          tpsCam.minZ = profile.minZ;
          tpsCam.maxZ = 500000;
          tpsCam.angularSensibilityX = profile.angularSensibilityX;
          tpsCam.angularSensibilityY = profile.angularSensibilityY;
          tpsCam.fov = profile.fov;
          tpsCam.checkCollisions = profile.collisionsEnabled;

          tpsCam.wheelPrecision = 15;
          tpsCam.panningSensibility = 0;
          tpsCam.allowUpsideDown = false;
          tpsCam.collisionRadius = new Vector3(0.25, 0.25, 0.25);
          tpsCam.upperBetaLimit = (Math.PI / 2) + 0.4;

          const minRad = (config.camera.tpsMinRadius ?? 1.5) * scaleY;
          const maxRad = (config.camera.tpsMaxRadius ?? 15) * scaleY;
          tpsCam.lowerRadiusLimit = minRad;
          tpsCam.upperRadiusLimit = maxRad;
      }
  }
}