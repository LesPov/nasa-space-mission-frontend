// src/app/core/engine/systems/character-kinematics.service.ts

import { Injectable } from '@angular/core';
import { Ray, Vector3, Mesh, Scene, Quaternion, Camera } from '@babylonjs/core';
import { EstadoFisico } from './player-physics.service';
import { GameEntity } from '../entities/game.entity';
import { SeqRuntime } from './player-sequence.service';

@Injectable({ providedIn: 'root' })
export class CharacterKinematicsService {
  
  public updateKinematics(
    scene: Scene,
    mesh: Mesh,
    entity: GameEntity,
    estadoFisico: EstadoFisico,
    inputMap: Record<string, boolean>,
    seqRuntime: SeqRuntime,
    activeCamera: Camera,
    vista: 'FPS' | 'TPS',
    dtMs: number
  ): void {
    const colMeta = entity.collider;
    const scaleY = entity.transform.scale.y || 1;
    const playerHalfHeight = (colMeta.sizeY || 0.9) * scaleY;
    const scaleFactor = isNaN(playerHalfHeight) ? 1 : playerHalfHeight / 0.9;
    const config = entity.playerConfig!;
    
    let move = Vector3.Zero();
    let isCinematicSequence = false;
    let dy = 0;
    let df = 0;

    const { forward, right } = this.calculateCameraDirections(activeCamera);

    mesh.computeWorldMatrix(true);
    const localCapsuleCenter = new Vector3(colMeta.offsetX ?? 0, colMeta.offsetY ?? 0, colMeta.offsetZ ?? 0);
    const capsuleCenter = Vector3.TransformCoordinates(localCapsuleCenter, mesh.getWorldMatrix());

    const collFn = (m: any) =>
      m.checkCollisions && m !== mesh && !m.isDescendantOf(mesh) && !m.name.includes('gridHelper');

    if (seqRuntime.running && seqRuntime.step) {
      const soY = seqRuntime.step.offsetY || 0;
      const soF = seqRuntime.step.offsetForward || 0;

      if (soY !== 0 || soF !== 0 || seqRuntime.lockInput || seqRuntime.freezeOrientation) {
        isCinematicSequence = true;
        const dtSec = scene.getEngine().getDeltaTime() / 1000;
        const durSec = Math.max(0.001, seqRuntime.step.durationMs / 1000);
        dy = (soY / durSec) * dtSec;
        df = (soF / durSec) * dtSec;
      }
    }

    if (seqRuntime.running && seqRuntime.forceJump && !estadoFisico.isJumping && !estadoFisico.isFalling) {
      estadoFisico.velocidadY = (config.jump.force || 0.16) * scaleFactor;
      estadoFisico.isJumping = true;
    }

    this.detectGround(scene, capsuleCenter, playerHalfHeight, scaleY, collFn, estadoFisico);

    if (isCinematicSequence) {
      this.applyCinematicMovement(mesh, dy, df, estadoFisico);
    } else {
      this.applyNormalMovement(
        mesh, config, estadoFisico, inputMap, seqRuntime, 
        move, forward, right, vista, scaleFactor, scaleY
      );
    }
  }

  private calculateCameraDirections(activeCamera: any): { forward: Vector3, right: Vector3 } {
    let forward = activeCamera.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() < 0.001) {
      forward = activeCamera.getDirection(Vector3.Up());
      forward.y = 0;
    }
    forward.normalize();

    const right = activeCamera.getDirection(Vector3.Right());
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
    estadoFisico: EstadoFisico
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

  private applyCinematicMovement(mesh: Mesh, dy: number, df: number, estadoFisico: EstadoFisico): void {
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
    estadoFisico: EstadoFisico, 
    inputMap: Record<string, boolean>, 
    seqRuntime: SeqRuntime, 
    move: Vector3, 
    forward: Vector3, 
    right: Vector3, 
    vista: 'FPS' | 'TPS', 
    scaleFactor: number, 
    scaleY: number
  ): void {
    mesh.checkCollisions = true;

    this.calculateLandingRecovery(estadoFisico, config);

    if (!estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      if (inputMap['w']) move.addInPlace(forward);
      if (inputMap['s']) move.subtractInPlace(forward);
      if (inputMap['d']) move.addInPlace(right);
      if (inputMap['a']) move.subtractInPlace(right);
    }

    if (seqRuntime.running && seqRuntime.allowMovement) {
      if (seqRuntime.forceForwardRun) move.addInPlace(forward.scale((config.movement.runSpeed || 0.09) * scaleFactor));
      if (seqRuntime.forceForwardWalk) move.addInPlace(forward.scale((config.movement.walkSpeed || 0.045) * scaleFactor));
    }

    estadoFisico.isMoving = move.lengthSquared() > 0.001;
    estadoFisico.isRunning = !!inputMap['shiftleft'] || !!inputMap['shiftright'] || !!inputMap['shift'] || seqRuntime.forceForwardRun;

    if (estadoFisico.isMoving && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
      const modSpeed = (estadoFisico.isRunning ? (config.movement.runSpeed || 0.09) : (config.movement.walkSpeed || 0.045)) * scaleFactor;
      
      if (!seqRuntime.running || !seqRuntime.allowMovement) {
        move.normalize().scaleInPlace(modSpeed);
      }

      if (vista === 'TPS' && !seqRuntime.lockInput && !seqRuntime.freezeOrientation) {
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

    this.calculateGravityAndJump(mesh, estadoFisico, config, inputMap, seqRuntime, move, scaleFactor, scaleY);

    if (isNaN(move.x)) move.x = 0;
    if (isNaN(move.y)) move.y = 0;
    if (isNaN(move.z)) move.z = 0;
    
    mesh.moveWithCollisions(move);
  }

  private calculateLandingRecovery(estadoFisico: EstadoFisico, config: any): void {
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
    estadoFisico: EstadoFisico, 
    config: any, 
    inputMap: Record<string, boolean>, 
    seqRuntime: SeqRuntime, 
    move: Vector3, 
    scaleFactor: number, 
    scaleY: number
  ): void {
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

      if ((inputMap[' '] || inputMap['space'] || seqRuntime.forceJump) && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
        estadoFisico.velocidadY = (config.jump.force || 0.16) * scaleFactor;
        estadoFisico.isJumping = true;
        estadoFisico.isGrounded = false;
        inputMap[' '] = false;
        inputMap['space'] = false;
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