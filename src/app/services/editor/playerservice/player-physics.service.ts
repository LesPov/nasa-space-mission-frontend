
import { Injectable, inject } from '@angular/core';
import { Mesh, Vector3, Ray, AbstractMesh, Quaternion } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { Motor3dService } from '../../motor-3d.service';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../player-config.model';
import { SeqRuntime } from './player-sequence.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';

export interface EstadoFisico {
  isMoving: boolean;
  isRunning: boolean;
  isGrounded: boolean;
  isJumping: boolean;
  isFalling: boolean;
  isHardLanding: boolean;
  isRecoveringFromFall: boolean;
  landingFrame: number;
  recoveryFrame: number;
  velocidadY: number;
  highestY: number; 
}

@Injectable({ providedIn: 'root' })
export class PlayerPhysicsService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private sanitizeForwardDir(dir: Vector3): Vector3 {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSquared() < 0.0001) return new Vector3(0, 0, 1);
    return d.normalize();
  }

  public aplicarMovimientoYGravedad(
    entity: GameEntity,
    inputMap: Record<string, boolean>, 
    seqRuntime: SeqRuntime, 
    activeCamera: any, 
    estadoFisico: EstadoFisico
  ): void {
    const jugador = entity.view as Mesh;
    if (!jugador) return;
    
    const scene = this.motor3d.scene;
    const colMeta = entity.collider;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const scaleY = entity.transform.scale.y || 1;
    const playerHalfHeight = (colMeta.sizeY || 0.9) * scaleY;
    const scaleFactor = isNaN(playerHalfHeight) ? 1 : playerHalfHeight / 0.9;
    
    let move = Vector3.Zero();
    let isCinematicSequence = false;
    let dy = 0;
    let df = 0;

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

    jugador.computeWorldMatrix(true);
    const localCapsuleCenter = new Vector3(colMeta.offsetX ?? 0, colMeta.offsetY ?? 0, colMeta.offsetZ ?? 0);
    const capsuleCenter = Vector3.TransformCoordinates(localCapsuleCenter, jugador.getWorldMatrix());

    const collFn = (m: AbstractMesh) =>
      m.checkCollisions &&
      m !== jugador &&
      !this.state.isDescendant(m, jugador) &&
      !m.name.includes('gridHelper');

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

    const rayCol = new Ray(capsuleCenter, Vector3.Down(), playerHalfHeight + (0.15 * scaleY));
    const hitInfo = scene.pickWithRay(rayCol, collFn);
    estadoFisico.isGrounded = hitInfo ? hitInfo.hit : false;

    if (estadoFisico.velocidadY > 0) estadoFisico.isGrounded = false;

    if (isCinematicSequence) {
      jugador.checkCollisions = false;
      const pForward = this.sanitizeForwardDir(jugador.getDirection(Vector3.Forward()));

      if (dy !== 0 && !isNaN(dy)) jugador.position.y += dy;
      if (df !== 0 && !isNaN(df)) jugador.position.addInPlace(pForward.scale(df));

      jugador.computeWorldMatrix(true);

      estadoFisico.velocidadY = 0;
      estadoFisico.highestY = jugador.position.y;
      estadoFisico.isJumping = false;
      estadoFisico.isFalling = false;
      estadoFisico.isGrounded = true;
      estadoFisico.isMoving = true;

    } else {
      jugador.checkCollisions = true;

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

        if (this.state.modoVistaPrueba === 'TPS' && !seqRuntime.lockInput && !seqRuntime.freezeOrientation) {
          const targetAngle = Math.atan2(move.x, move.z);
          if (!isNaN(targetAngle)) {
            if (!jugador.rotationQuaternion) jugador.rotationQuaternion = Quaternion.Identity();
            jugador.rotationQuaternion = Quaternion.Slerp(
              jugador.rotationQuaternion, 
              Quaternion.FromEulerAngles(0, targetAngle, 0), 
              0.2
            );
          }
        }
      }

      // Gravedad y Salto
      if (estadoFisico.isGrounded) {
        if (estadoFisico.isFalling || estadoFisico.isJumping) {
          const fallDistance = estadoFisico.highestY - jugador.position.y;
          if (fallDistance > (config.physics.hardLandingThreshold || 2.5) * scaleY) {
            estadoFisico.isHardLanding = true;
            estadoFisico.landingFrame = 0;
            move = Vector3.Zero();
            estadoFisico.isMoving = false; 
          }
          estadoFisico.isFalling = false;
          estadoFisico.isJumping = false;
        }

        estadoFisico.highestY = jugador.position.y;
        estadoFisico.velocidadY = -0.05;

        if ((inputMap[' '] || inputMap['space'] || seqRuntime.forceJump) && !estadoFisico.isHardLanding && !estadoFisico.isRecoveringFromFall) {
          estadoFisico.velocidadY = (config.jump.force || 0.16) * scaleFactor;
          estadoFisico.isJumping = true;
          estadoFisico.isGrounded = false;
          inputMap[' '] = false;
          inputMap['space'] = false;
        }
      } else {
        if (jugador.position.y > estadoFisico.highestY) estadoFisico.highestY = jugador.position.y;

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
      
      if (isNaN(move.x)) move.x = 0;
      if (isNaN(move.y)) move.y = 0;
      if (isNaN(move.z)) move.z = 0;
      
      jugador.moveWithCollisions(move);
    }
  }
}