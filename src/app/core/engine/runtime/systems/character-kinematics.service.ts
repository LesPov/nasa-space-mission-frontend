import { Injectable, inject } from '@angular/core';
import { Ray, Vector3, Mesh, Scene, Quaternion, Camera, Tags } from '@babylonjs/core';
import { GameEntity } from '../../entities/game.entity';
import { SeqRuntime } from './player-sequence.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { GameMode } from '../../session/game-mode.model';
import { getMovementProfileForOwner, MovementProfile } from '../movement/movement-profile.model';

@Injectable({ providedIn: 'root' })
export class CharacterKinematicsService implements IUpdatable {
  public id = 'CharacterKinematicsSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d = inject(Motor3dService);
  private ownership = inject(CameraOwnershipService);
  private context = inject(GameContextService);

  public physicsUpdate(dtMs: number): void {
    const scene = this.motor3d.scene;
    const mode = this.context.mode();
    
    if (mode === GameMode.EDITOR) return;

    const activeCamera = this.ownership.getCamera();
    if (!activeCamera) return;

    const activePlayer = this.context.activePlayerEntity();
    const cameraView = this.context.cameraView();
    const owner = this.ownership.getOwner();
    
    const playerProfile = getMovementProfileForOwner(owner);
    const characters = this.entityManager.getEntitiesWithComponent('characterConfig');

    for (const entity of characters) {
      // 🔥 FIX SUPREMO: Si el Director Cinematográfico tiene secuestrado a este actor, 
      // anulamos todas sus físicas nativas e inercia para que la cinemática lo mueva matemáticamente.
      if (entity.isCinematicControlled) {
         if (entity.playerRuntime) {
            entity.playerRuntime.intentions = { moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, run: false, jump: false };
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
          ? (vista === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS) 
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
    
    let move = Vector3.Zero();
    let isCinematicSequence = false;
    let dy = 0;
    let df = 0;

    const { forward, right } = this.calculateCameraDirections(referenceCamera);

    mesh.computeWorldMatrix(true);
    const localCapsuleCenter = new Vector3(colMeta.offsetX ?? 0, colMeta.offsetY ?? 0, colMeta.offsetZ ?? 0);
    const capsuleCenter = Vector3.TransformCoordinates(localCapsuleCenter, mesh.getWorldMatrix());

    const collFn = (m: any) =>
      m.checkCollisions && m !== mesh && !m.isDescendantOf(mesh) && !Tags.MatchesQuery(m, "system_element || editor_only || fog_element");

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
      this.detectGround(scene, capsuleCenter, playerHalfHeight, scaleY, collFn, estadoFisico);
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
        move, forward, right, vista, scaleFactor, scaleY, profile
      );
    }
    
    entity.syncTransformFromView();
  }

  private calculateCameraDirections(referenceCamera: any): { forward: Vector3, right: Vector3 } {
    let forward = referenceCamera.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() < 0.001) {
      forward = referenceCamera.getDirection(Vector3.Up());
      forward.y = 0;
    }
    forward.normalize();

    const right = referenceCamera.getDirection(Vector3.Right());
    right.y = 0;
    right.normalize();

    return { forward, right };
  }

  private detectGround(
    scene: Scene, 
    capsuleCenter: Vector3, 
    playerHalfHeight: number, 
    scaleY: number, 
    collFn: (m: any) => boolean, 
    estadoFisico: any
  ): void {
    const rayOrigin = capsuleCenter.clone();
    rayOrigin.y += playerHalfHeight * 0.5; 
    const rayLength = playerHalfHeight * 1.5 + (0.15 * scaleY);
    
    const rayCol = new Ray(rayOrigin, Vector3.Down(), rayLength);
    const hitInfo = scene.pickWithRay(rayCol, collFn);
    estadoFisico.isGrounded = hitInfo ? hitInfo.hit : false;

    if (estadoFisico.velocidadY > 0) estadoFisico.isGrounded = false;
  }

  private sanitizeForwardDir(dir: Vector3): Vector3 {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSquared() < 0.0001) return new Vector3(0, 0, 1);
    return d.normalize();
  }

  private applyCinematicMovement(mesh: Mesh, dy: number, df: number, estadoFisico: any): void {
    mesh.checkCollisions = false;
    const pForward = this.sanitizeForwardDir(mesh.getDirection(Vector3.Forward()));

    if (dy !== 0 && !isNaN(dy)) mesh.position.y += dy;
    if (df !== 0 && !isNaN(df)) mesh.position.addInPlace(pForward.scale(df));

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
    move: Vector3, 
    forward: Vector3, 
    right: Vector3, 
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
      if (intentions.moveForward) move.addInPlace(forward);
      if (intentions.moveBackward) move.subtractInPlace(forward);
      if (intentions.moveRight) move.addInPlace(right);
      if (intentions.moveLeft) move.subtractInPlace(right);
    }

    if (seqRuntime && seqRuntime.running && seqRuntime.allowMovement) {
      if (seqRuntime.forceForwardRun) move.addInPlace(forward.scale((config.movement.runSpeed || 0.09) * scaleFactor));
      if (seqRuntime.forceForwardWalk) move.addInPlace(forward.scale((config.movement.walkSpeed || 0.045) * scaleFactor));
    }

    estadoFisico.isMoving = move.lengthSquared() > 0.001;
    estadoFisico.isRunning = intentions.run || (seqRuntime ? seqRuntime.forceForwardRun : false);

    if (estadoFisico.isMoving && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      const modSpeed = (estadoFisico.isRunning ? (config.movement.runSpeed || 0.09) : (config.movement.walkSpeed || 0.045)) * scaleFactor;
      
      if (!seqRuntime || !seqRuntime.running || !seqRuntime.allowMovement) {
        move.normalize().scaleInPlace(modSpeed);
      }

      if (vista === 'TPS' && (!seqRuntime || (!seqRuntime.lockInput && !seqRuntime.freezeOrientation))) {
        const targetAngle = Math.atan2(move.x, move.z);
        if (!isNaN(targetAngle)) {
          if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
          mesh.rotationQuaternion = Quaternion.Slerp(
            mesh.rotationQuaternion, 
            Quaternion.FromEulerAngles(0, targetAngle, 0), 
            0.2
          );
        }
      }
    }

    this.calculateGravityAndJump(mesh, estadoFisico, config, intentions, seqRuntime, move, scaleFactor, scaleY, profile);

    if (isNaN(move.x)) move.x = 0;
    if (isNaN(move.y)) move.y = 0;
    if (isNaN(move.z)) move.z = 0;
    
    if (profile.collisionsEnabled) {
      mesh.moveWithCollisions(move);
    } else {
      mesh.position.addInPlace(move);
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
    move: Vector3, 
    scaleFactor: number, 
    scaleY: number,
    profile: MovementProfile
  ): void {
    if (!profile.gravityEnabled) {
       estadoFisico.isGrounded = true;
       estadoFisico.velocidadY = 0;
       estadoFisico.isFalling = false;
       estadoFisico.isJumping = false;
       move.y = 0;
       return;
    }

    if (estadoFisico.isGrounded) {
      if (estadoFisico.isFalling || estadoFisico.isJumping) {
        const fallDistance = estadoFisico.highestY - mesh.position.y;
        if (fallDistance > (config.physics.hardLandingThreshold || 2.5) * scaleY) {
          estadoFisico.isHardLanding = true;
          estadoFisico.landingFrame = 0;
          move.set(0, 0, 0);
          estadoFisico.isMoving = false; 
        }
        estadoFisico.isFalling = false;
        estadoFisico.isJumping = false;
      }

      estadoFisico.highestY = mesh.position.y;
      estadoFisico.velocidadY = -0.05; 

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

    move.y = estadoFisico.velocidadY;
  }
}