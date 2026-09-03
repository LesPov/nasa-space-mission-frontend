
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
    
    if (mode === GameMode.EDITOR) return;

    const activeCamera = this.ownership.getCamera();
    if (!activeCamera) return;

    const activePlayer = this.context.activePlayerEntity();
    const cameraView = this.context.cameraView();
    const owner = this.ownership.getOwner();
    
    const playerProfile = getMovementProfileForOwner(owner);
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity.hasComponent('characterConfig')) continue;

      if (entity.isCinematicControlled) {
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
         }
         continue; 
      }

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
          : activeCamera;

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
      if (seqRuntime.rootMotion && (seqRuntime.rootMotion.y !== 0 || seqRuntime.rootMotion.z !== 0 || seqRuntime.lockInput || seqRuntime.freezeOrientation)) {
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
        vista, scaleFactor, scaleY, profile
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
    profile: MovementProfile
  ): void {
    if (!profile.customInputEnabled) {
      intentions.moveForward = false;
      intentions.moveBackward = false;
      intentions.moveLeft = false;
      intentions.moveRight = false;
      intentions.run = false;
      intentions.jump = false;
    }

    this.calculateLandingRecovery(estadoFisico, config);

    if (!estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      if (intentions.moveForward) this._move.addInPlace(this._forward);
      if (intentions.moveBackward) this._move.subtractInPlace(this._forward);
      if (intentions.moveRight) this._move.addInPlace(this._right);
      if (intentions.moveLeft) this._move.subtractInPlace(this._right);
    }

    if (seqRuntime && seqRuntime.running && seqRuntime.allowMovement) {
      if (seqRuntime.forceForwardRun) {
         this._forward.scaleToRef((config.movement.runSpeed || 0.09) * scaleFactor, this._pForward);
         this._move.addInPlace(this._pForward);
      }
      if (seqRuntime.forceForwardWalk) {
         this._forward.scaleToRef((config.movement.walkSpeed || 0.045) * scaleFactor, this._pForward);
         this._move.addInPlace(this._pForward);
      }
    }

    estadoFisico.isMoving = this._move.lengthSquared() > 0.001;
    estadoFisico.isRunning = intentions.run || (seqRuntime ? seqRuntime.forceForwardRun : false);

    if (estadoFisico.isMoving && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      const modSpeed = (estadoFisico.isRunning ? (config.movement.runSpeed || 0.09) : (config.movement.walkSpeed || 0.045)) * scaleFactor;
      
      if (!seqRuntime || !seqRuntime.running || !seqRuntime.allowMovement) {
        this._move.normalize().scaleInPlace(modSpeed);
      }

      if (vista === 'TPS' && (!seqRuntime || (!seqRuntime.lockInput && !seqRuntime.freezeOrientation))) {
        const targetAngle = Math.atan2(this._move.x, this._move.z);
        if (!isNaN(targetAngle)) {
          if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
          Quaternion.FromEulerAnglesToRef(0, targetAngle, 0, this._targetQuat);
          Quaternion.SlerpToRef(mesh.rotationQuaternion, this._targetQuat, 0.2, mesh.rotationQuaternion);
        }
      }
    }

    this.calculateGravityAndJump(mesh, estadoFisico, config, intentions, seqRuntime, scaleFactor, scaleY, profile);

    if (isNaN(this._move.x)) this._move.x = 0;
    if (isNaN(this._move.y)) this._move.y = 0;
    if (isNaN(this._move.z)) this._move.z = 0;
    
    // 🔥 FIX 2: PRECISIÓN FÍSICA ESTRICTA
    // Si no hay un vector de movimiento matemático real, NO LLAMAMOS a la API de colisión.
    // Esto congela físicamente el objeto y previene jittering de colisiones estáticas.
    if (profile.collisionsEnabled) {
      if (this._move.lengthSquared() > 0.000001) {
         mesh.moveWithCollisions(this._move);
      }
    } else {
      if (this._move.lengthSquared() > 0.000001) {
         mesh.position.addInPlace(this._move);
      }
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
      
      // 🔥 FIX 3: GRAVEDAD EN REPOSO ELIMINADA
      // Si el jugador está quieto en el suelo, no lo empujamos artificialmente contra el AABB.
      if (!estadoFisico.isMoving && !estadoFisico.isJumping && !intentions.jump && (!seqRuntime || !seqRuntime.forceJump)) {
         estadoFisico.velocidadY = 0;
      } else {
         estadoFisico.velocidadY = -0.005; // Mantener ligero empuje para bajar pendientes suavemente
      }

      if (profile.jumpEnabled && (intentions.jump || (seqRuntime ? seqRuntime.forceJump : false)) && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
        estadoFisico.velocidadY = (config.jump.force || 0.16) * scaleFactor;
        estadoFisico.isJumping = true;
        estadoFisico.isGrounded = false;
        intentions.jump = false; 
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