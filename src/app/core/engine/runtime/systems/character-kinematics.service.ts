
import { Injectable, inject } from '@angular/core';
import { Ray, Vector3, Mesh, Scene, Quaternion, Camera, Tags } from '@babylonjs/core';
import { GameEntity } from '../../entities/game.entity';
import { SeqRuntime } from './player-sequence.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { GameMode } from '../../session/game-mode.model';
import { getMovementProfileForOwner, MovementProfile } from '../movement/movement-profile.model';
import { TransformTelemetryService } from '../../telemetry/transform-telemetry.service';

@Injectable({ providedIn: 'root' })
export class CharacterKinematicsService implements IUpdatable {
  public id = 'CharacterKinematicsSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private context = inject(GameContextService);

  private _localCapsuleCenter = Vector3.Zero();
  private _capsuleCenter = Vector3.Zero();
  private _rayOrigin = Vector3.Zero();
  private _rayCol = new Ray(Vector3.Zero(), Vector3.Down(), 1);
  private _move = Vector3.Zero();
  private _forward = Vector3.Zero();
  private _right = Vector3.Zero();
  private _pForward = Vector3.Zero();
  private _targetQuat = Quaternion.Identity();

  private _forwardDir = new Vector3(0, 0, 1);
  private _upDir = new Vector3(0, 1, 0);
  private _rightDir = new Vector3(1, 0, 0);

  public physicsUpdate(dtMs: number): void {
    const scene = this.motor3d.getScene();
    const mode = this.context.mode();
    
    // 🔥 PERMITIMOS QUE LAS CINEMÁTICAS EJECUTEN FÍSICAS EN MODO EDITOR
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    const activeCamera = this.ownership.getCamera();
    if (!activeCamera && !isEditor) return;

    const activePlayer = this.context.activePlayerEntity();
    const cameraView = this.context.cameraView();
    const owner = this.ownership.getOwner();
    
    const playerProfile = getMovementProfileForOwner(owner);
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity.hasComponent('characterConfig')) continue;

      // En el editor, solo procesamos a los que están controlados por la cinemática
      if (isEditor && entity.movementAuthority === 'GAMEPLAY') {
          continue; 
      }

      // 🔥 FASE 1: CHEQUEO DE AUTORIDAD ESTRICTA
      if (entity.movementAuthority === 'CINEMATIC_FULL') {
         // El Director tiene control 100% Interpolado del Transform. Físicas desactivadas.
         if (entity.playerRuntime) {
            entity.playerRuntime.intentions.moveForward = false;
            entity.playerRuntime.intentions.moveBackward = false;
            entity.playerRuntime.intentions.moveLeft = false;
            entity.playerRuntime.intentions.moveRight = false;
            entity.playerRuntime.intentions.run = false;
            entity.playerRuntime.intentions.jump = false;
            const estadoFisico = entity.playerRuntime.physicsState;
            estadoFisico.velocidadY = 0;
            estadoFisico.isGrounded = true;
            if (entity.view) {
                estadoFisico.highestY = entity.view.position.y; // Evita daño de caída al finalizar cinemática
            }
         }
         continue; 
      }

      // Si llegamos aquí, la autoridad es 'GAMEPLAY' o 'CINEMATIC_LOCOMOTION'.
      // En ambos casos, las físicas y la cinemática de locomoción DEBEN procesarse.

      const isPlayer = activePlayer && entity.uid === activePlayer.uid;
      const vista = isPlayer ? cameraView : 'FPS'; 
      const activeProfile = isPlayer ? playerProfile : getMovementProfileForOwner('PLAYER_FPS');

      if (isPlayer && activeProfile.type === 'EDITOR_FREE') {
         if (entity.playerRuntime) {
             entity.playerRuntime.intentions.moveForward = false;
             entity.playerRuntime.intentions.moveBackward = false;
             entity.playerRuntime.intentions.moveLeft = false;
             entity.playerRuntime.intentions.moveRight = false;
             entity.playerRuntime.intentions.run = false;
             entity.playerRuntime.intentions.jump = false;
         }
      }

      const cameraToUseForDirection = (isPlayer && activeProfile.type === 'EDITOR_FREE') 
          ? (vista === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS()) 
          : (activeCamera || this.motor3d.getEditorCamera());

      const seqRuntime = entity.playerRuntime?.seqRuntime;
      if (!seqRuntime) continue; 

      this.updateKinematics(
        scene, 
        entity, 
        seqRuntime, 
        cameraToUseForDirection, 
        vista,
        dtMs,
        activeProfile
      );
    }
  }
  
  public updateKinematics(
    scene: Scene,
    entity: GameEntity,
    seqRuntime: SeqRuntime,
    referenceCamera: Camera,
    vista: 'FPS' | 'TPS',
    dtMs: number,
    profile: MovementProfile
  ): void {
    const mesh = entity.view as Mesh;
    if (!mesh) return;

    mesh.checkCollisions = profile.collisionsEnabled;

    const playerState = entity.playerRuntime;
    const estadoFisico = playerState.physicsState;
    const intentions = playerState.intentions;
    const colMeta = entity.collider;
    const scaleY = entity.transform.scale.y || 1;
    const playerHalfHeight = (colMeta.sizeY || 0.9) * scaleY;
    const scaleFactor = isNaN(playerHalfHeight) ? 1 : playerHalfHeight / 0.9;
    const config = entity.playerConfig!;
    
    this._move.set(0, 0, 0);
    let isCinematicSequence = false;
    let dy = 0;
    let df = 0;

    this.updateCameraDirections(referenceCamera);

    mesh.computeWorldMatrix(true);
    this._localCapsuleCenter.set(colMeta.offsetX ?? 0, colMeta.offsetY ?? 0, colMeta.offsetZ ?? 0);
    Vector3.TransformCoordinatesToRef(this._localCapsuleCenter, mesh.getWorldMatrix(), this._capsuleCenter);

    const collFn = (m: any) =>
      m.checkCollisions && m !== mesh && !m.isDescendantOf(mesh) && !Tags.MatchesQuery(m, "editor_only || fog_element");

    if (seqRuntime && seqRuntime.running && seqRuntime.step) {
      if (seqRuntime.rootMotion && (seqRuntime.rootMotion.y !== 0 || seqRuntime.rootMotion.z !== 0)) {
        isCinematicSequence = true;
        dy = seqRuntime.rootMotion.y;
        df = seqRuntime.rootMotion.z;
      }
    }

    if (seqRuntime && seqRuntime.running && seqRuntime.forceJump && profile.jumpEnabled && !estadoFisico.isJumping && !estadoFisico.isFalling) {
      estadoFisico.velocidadY = (config.jump.force || 0.16) * scaleFactor;
      estadoFisico.isJumping = true;
    }

    if (profile.gravityEnabled) {
      this.detectGround(scene, playerHalfHeight, scaleY, collFn, estadoFisico);
    } else {
      estadoFisico.isGrounded = true;
      estadoFisico.velocidadY = 0;
      estadoFisico.isFalling = false;
      estadoFisico.isJumping = false;
    }

    if (isCinematicSequence) {
      this.applyCinematicMovement(mesh, dy, df, estadoFisico);
    } else {
      this.applyNormalMovement(
        mesh, config, estadoFisico, intentions, seqRuntime, 
        vista, scaleFactor, scaleY, profile, entity, dtMs
      );
    }
    
    entity.syncTransformFromView();
    mesh.computeWorldMatrix(true);
  }

  private updateCameraDirections(referenceCamera: any): void {
    if (referenceCamera.getDirectionToRef) {
      referenceCamera.getDirectionToRef(this._forwardDir, this._forward);
      this._forward.y = 0;
      if (this._forward.lengthSquared() < 0.001) {
        referenceCamera.getDirectionToRef(this._upDir, this._forward);
        this._forward.y = 0;
      }
      this._forward.normalize();
  
      referenceCamera.getDirectionToRef(this._rightDir, this._right);
      this._right.y = 0;
      this._right.normalize();
    } else {
      const fd = referenceCamera.getDirection(this._forwardDir);
      this._forward.copyFrom(fd);
      this._forward.y = 0;
      this._forward.normalize();
      
      const rd = referenceCamera.getDirection(this._rightDir);
      this._right.copyFrom(rd);
      this._right.y = 0;
      this._right.normalize();
    }
  }

  private detectGround(
    scene: Scene, 
    playerHalfHeight: number, 
    scaleY: number, 
    collFn: (m: any) => boolean, 
    estadoFisico: any
  ): void {
    this._rayOrigin.copyFrom(this._capsuleCenter);
    this._rayOrigin.y += playerHalfHeight * 0.5; 
    const rayLength = playerHalfHeight * 1.5 + (0.15 * scaleY);
    
    this._rayCol.origin.copyFrom(this._rayOrigin);
    this._rayCol.direction.copyFromFloats(0, -1, 0);
    this._rayCol.length = rayLength;

    const hitInfo = scene.pickWithRay(this._rayCol, collFn);
    estadoFisico.isGrounded = hitInfo ? hitInfo.hit : false;

    if (estadoFisico.isGrounded && hitInfo && hitInfo.hit) {
      const normal = hitInfo.getNormal(true);
      estadoFisico.groundNormal = normal || Vector3.Up();
    } else {
      estadoFisico.groundNormal = null;
    }

    if (estadoFisico.velocidadY > 0) estadoFisico.isGrounded = false;
  }

  private applyCinematicMovement(mesh: Mesh, dy: number, df: number, estadoFisico: any): void {
    mesh.checkCollisions = false;
    
    if (mesh.getDirectionToRef) {
        mesh.getDirectionToRef(this._forwardDir, this._pForward);
    } else {
        this._pForward.copyFrom(mesh.getDirection(this._forwardDir));
    }
    
    this._pForward.y = 0;
    if (this._pForward.lengthSquared() < 0.0001) this._pForward.set(0, 0, 1);
    else this._pForward.normalize();

    if (dy !== 0 && !isNaN(dy)) mesh.position.y += dy;
    // dy/df en Cinemática ya están escalados por tiempo internamente (PlayerSequenceService)
    if (df !== 0 && !isNaN(df)) mesh.position.addInPlace(this._pForward.scaleInPlace(df));

    mesh.computeWorldMatrix(true);

    estadoFisico.velocidadY = 0;
    estadoFisico.highestY = mesh.position.y;
    estadoFisico.isJumping = false;
    estadoFisico.isFalling = false;
    estadoFisico.isGrounded = true;
    estadoFisico.isMoving = true;
  }

  private applyNormalMovement(
    mesh: Mesh, 
    config: any, 
    estadoFisico: any, 
    intentions: any, 
    seqRuntime: SeqRuntime | null, 
    vista: 'FPS' | 'TPS', 
    scaleFactor: number, 
    scaleY: number,
    profile: MovementProfile,
    entity: GameEntity,
    dtMs: number
  ): void {
    const telemetry = TransformTelemetryService.instance;

    // 🔥 FASE B: Normalización Temporal a 60 FPS
    const TARGET_FRAME_TIME = 1000 / 60;
    const timeRatio = dtMs / TARGET_FRAME_TIME;

    if (!profile.customInputEnabled) {
      intentions.moveForward = false;
      intentions.moveBackward = false;
      intentions.moveLeft = false;
      intentions.moveRight = false;
      intentions.run = false;
      intentions.jump = false;
    }

    this.calculateLandingRecovery(estadoFisico, config);

    // Sumatoria de intenciones (Matemática Pura Unitaria)
    if (!estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      if (intentions.moveForward) this._move.addInPlace(this._forward);
      if (intentions.moveBackward) this._move.subtractInPlace(this._forward);
      if (intentions.moveRight) this._move.addInPlace(this._right);
      if (intentions.moveLeft) this._move.subtractInPlace(this._right);
    }

    if (seqRuntime && seqRuntime.running && seqRuntime.allowMovement) {
      let forwardSource = this._forward;
      
      if (entity.movementAuthority === 'CINEMATIC_LOCOMOTION') {
          if (mesh.getDirectionToRef) {
              mesh.getDirectionToRef(this._forwardDir, this._pForward);
          } else {
              this._pForward.copyFrom(mesh.getDirection(this._forwardDir));
          }
          this._pForward.y = 0;
          if (this._pForward.lengthSquared() < 0.0001) this._pForward.set(0, 0, 1);
          this._pForward.normalize();
          forwardSource = this._pForward;
      }

      // Cinemáticas: Locomoción Action Steps
      if (seqRuntime.forceForwardRun) {
         forwardSource.scaleToRef((config.movement.runSpeed || 0.09) * scaleFactor * timeRatio, this._pForward);
         this._move.addInPlace(this._pForward);
      }
      if (seqRuntime.forceForwardWalk) {
         forwardSource.scaleToRef((config.movement.walkSpeed || 0.045) * scaleFactor * timeRatio, this._pForward);
         this._move.addInPlace(this._pForward);
      }
    }

    estadoFisico.isMoving = this._move.lengthSquared() > 0.001;
    estadoFisico.isRunning = intentions.run || (seqRuntime ? seqRuntime.forceForwardRun : false);

    // Aplicar Vector Horizontal Físico a Gameplay
    if (estadoFisico.isMoving && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      const modSpeed = (estadoFisico.isRunning ? (config.movement.runSpeed || 0.09) : (config.movement.walkSpeed || 0.045)) * scaleFactor;
      
      if (!seqRuntime || !seqRuntime.running || !seqRuntime.allowMovement) {
        this._move.normalize().scaleInPlace(modSpeed * timeRatio);
      }
    }

    const qBeforeRot = mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null;

    // 🔥 FASE B: Rotación TPS independiente del Framerate mediante Slerp Exponencial
    if (!seqRuntime || (!seqRuntime.lockInput && !seqRuntime.freezeOrientation)) {
      if (vista === 'TPS' && estadoFisico.isMoving) {
        const targetAngle = Math.atan2(this._move.x, this._move.z);
        if (!isNaN(targetAngle)) {
          if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
          Quaternion.FromEulerAnglesToRef(0, targetAngle, 0, this._targetQuat);
          
          let baseRotSpeed = config.movement.rotationSpeed || 0.2;
          if (baseRotSpeed === 0.1) baseRotSpeed = 0.2; // Compatibilidad con factor hardcodeado antiguo de 0.2

          const slerpFactor = 1 - Math.pow(1 - baseRotSpeed, timeRatio);
          Quaternion.SlerpToRef(mesh.rotationQuaternion, this._targetQuat, slerpFactor, mesh.rotationQuaternion);
        }
      } else if (vista === 'FPS') {
        const targetAngle = Math.atan2(this._forward.x, this._forward.z);
        if (!isNaN(targetAngle)) {
          if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
          Quaternion.FromEulerAnglesToRef(0, targetAngle, 0, mesh.rotationQuaternion);
        }
      }
    }

    if (telemetry && telemetry.enabled && mesh.rotationQuaternion) {
        telemetry.logEvent(
          entity.uid, entity.rol, 'CharacterKinematics', 'rotationQuaternion', 'WRITE',
          qBeforeRot, mesh.rotationQuaternion, telemetry.calculateQuaternionError(qBeforeRot, mesh.rotationQuaternion)
        );
    }

    const posBeforeGrav = mesh.position.clone();

    // La Gravedad y Salto quedan inalterados (No multiplicados por timeRatio)
    // Para mantener la estabilidad estricta requerida por moveWithCollisions.
    this.calculateGravityAndJump(mesh, estadoFisico, config, intentions, seqRuntime, scaleFactor, scaleY, profile);

    if (isNaN(this._move.x)) this._move.x = 0;
    if (isNaN(this._move.y)) this._move.y = 0;
    if (isNaN(this._move.z)) this._move.z = 0;
    
    if (telemetry && telemetry.enabled) {
        telemetry.logEvent(entity.uid, entity.rol, 'CharacterKinematics', 'velocidadY', 'WRITE', null, estadoFisico.velocidadY);
    }

    // Resolución física final
    if (profile.collisionsEnabled) {
      if (this._move.lengthSquared() > 0.000001) {
         mesh.moveWithCollisions(this._move);
      }
    } else {
      if (this._move.lengthSquared() > 0.000001) {
         mesh.position.addInPlace(this._move);
      }
    }

    if (telemetry && telemetry.enabled) {
        telemetry.logEvent(entity.uid, entity.rol, 'CharacterKinematics', 'position', 'WRITE', posBeforeGrav, mesh.position);
    }
  }

  private calculateLandingRecovery(estadoFisico: any, config: any): void {
    if (estadoFisico.isHardLanding) {
      estadoFisico.landingFrame++;
      if (estadoFisico.landingFrame > (config.physics.landingRecoveryFrames || 60)) {
        estadoFisico.isHardLanding = false;
        estadoFisico.isRecoveringFromFall = true;
        estadoFisico.recoveryFrame = 0;
      }
    } else if (estadoFisico.isRecoveringFromFall) {
      estadoFisico.recoveryFrame++;
      if (estadoFisico.recoveryFrame > (config.physics.landingRecoveryFrames || 60)) {
        estadoFisico.isRecoveringFromFall = false;
      }
    }
  }

  private calculateGravityAndJump(
    mesh: Mesh, 
    estadoFisico: any, 
    config: any, 
    intentions: any, 
    seqRuntime: SeqRuntime | null, 
    scaleFactor: number, 
    scaleY: number,
    profile: MovementProfile
  ): void {
    if (!profile.gravityEnabled) {
       estadoFisico.isGrounded = true;
       estadoFisico.velocidadY = 0;
       estadoFisico.isFalling = false;
       estadoFisico.isJumping = false;
       this._move.y = 0;
       return;
    }

    if (estadoFisico.isGrounded) {
      if (estadoFisico.isFalling || estadoFisico.isJumping) {
        const fallDistance = estadoFisico.highestY - mesh.position.y;
        if (fallDistance > (config.physics.hardLandingThreshold || 2.5) * scaleY) {
          estadoFisico.isHardLanding = true;
          estadoFisico.landingFrame = 0;
          this._move.set(0, 0, 0);
          estadoFisico.isMoving = false; 
        }
        estadoFisico.isFalling = false;
        estadoFisico.isJumping = false;
      }

      estadoFisico.highestY = mesh.position.y;
      
      const wantsToJump = profile.jumpEnabled && (intentions.jump || (seqRuntime ? seqRuntime.forceJump : false));

      if (!estadoFisico.isMoving && !wantsToJump) {
         estadoFisico.velocidadY = 0;
      } else if (wantsToJump && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
         estadoFisico.velocidadY = (config.jump.force || 0.16) * scaleFactor;
         estadoFisico.isJumping = true;
         estadoFisico.isGrounded = false;
         intentions.jump = false; 
      } else {
         if (estadoFisico.groundNormal && estadoFisico.groundNormal.y > 0.999) {
             estadoFisico.velocidadY = 0;
         } else {
             estadoFisico.velocidadY = -Math.abs((config.jump.gravity || 0.018) * scaleFactor);
         }
      }
    } else {
      if (mesh.position.y > estadoFisico.highestY) estadoFisico.highestY = mesh.position.y;

      const gravityMul = estadoFisico.isJumping ? 0.55 : (config.jump.jumpFallMultiplier || 1.0);
      estadoFisico.velocidadY -= (config.jump.gravity || 0.018) * scaleFactor * gravityMul;
      const maxFallSpeed = config.jump.maxFallSpeed || 0.8;

      if (estadoFisico.velocidadY < -maxFallSpeed * scaleFactor) {
        estadoFisico.velocidadY = -maxFallSpeed * scaleFactor;
      }

      if (estadoFisico.velocidadY < -0.05) {
        estadoFisico.isFalling = true;
        estadoFisico.isJumping = false;
      } else if (estadoFisico.velocidadY > 0) {
        estadoFisico.isJumping = true;
        estadoFisico.isFalling = false;
      }
    }

    this._move.y = estadoFisico.velocidadY;
  }
}