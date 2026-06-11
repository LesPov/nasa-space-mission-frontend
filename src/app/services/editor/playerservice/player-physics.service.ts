import { Injectable, inject } from '@angular/core';
import { Mesh, Vector3, Ray, AbstractMesh, Quaternion } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { Motor3dService } from '../../motor-3d.service';
import { PlayerRuntimeConfig } from '../player-config.model';
import { SeqRuntime } from './player-sequence.service';

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
}

@Injectable({ providedIn: 'root' })
export class PlayerPhysicsService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  public velocidadY = -0.1;
  public highestY = -9999;
  public isJumping = false;
  public isFalling = false;
  public isHardLanding = false;
  public isRecoveringFromFall = false;
  public landingFrame = 0;
  public recoveryFrame = 0;

  public resetearFisicas(): void {
    this.velocidadY = -0.1;
    this.highestY = -9999;
    this.isJumping = false;
    this.isFalling = false;
    this.isHardLanding = false;
    this.isRecoveringFromFall = false;
    this.landingFrame = 0;
    this.recoveryFrame = 0;
  }

  private sanitizeForwardDir(dir: Vector3): Vector3 {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSquared() < 0.0001) return new Vector3(0, 0, 1);
    return d.normalize();
  }

  public aplicarMovimientoYGravedad(
    jugador: Mesh, 
    inputMap: Record<string, boolean>, 
    seqRuntime: SeqRuntime, 
    activeCamera: any, 
    colMeta: any, 
    scaleNow: Vector3, 
    config: PlayerRuntimeConfig
  ): EstadoFisico {
    const scene = this.motor3d.scene;
    const scaleY = scaleNow.y || 1;
    const playerHalfHeight = (colMeta.sizeY || 0.9) * scaleY;
    const scaleFactor = isNaN(playerHalfHeight) ? 1 : playerHalfHeight / 0.9;
    
    let move = Vector3.Zero();
    let isMoving = false;
    let isRunning = false;
    let isGrounded = false;
    
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

    if (seqRuntime.running && seqRuntime.forceJump && !this.isJumping && !this.isFalling) {
      this.velocidadY = (config.jump.force || 0.16) * scaleFactor;
      this.isJumping = true;
    }

    const rayCol = new Ray(capsuleCenter, Vector3.Down(), playerHalfHeight + (0.15 * scaleY));
    const hitInfo = scene.pickWithRay(rayCol, collFn);
    isGrounded = hitInfo ? hitInfo.hit : false;

    if (this.velocidadY > 0) isGrounded = false;

    if (isCinematicSequence) {
      jugador.checkCollisions = false;
      const pForward = this.sanitizeForwardDir(jugador.getDirection(Vector3.Forward()));

      if (dy !== 0 && !isNaN(dy)) jugador.position.y += dy;
      if (df !== 0 && !isNaN(df)) jugador.position.addInPlace(pForward.scale(df));

      jugador.computeWorldMatrix(true);

      this.velocidadY = 0;
      this.highestY = jugador.position.y;
      this.isJumping = false;
      this.isFalling = false;
      isGrounded = true;
      isMoving = true;

    } else {
      jugador.checkCollisions = true;

      // 1. Controlar el flujo de caídas (Hard Landing / Recovery) para que no se quede bloqueado
      if (this.isHardLanding) {
        this.landingFrame++;
        if (this.landingFrame > (config.physics.landingRecoveryFrames || 60)) {
          this.isHardLanding = false;
          this.isRecoveringFromFall = true;
          this.recoveryFrame = 0;
        }
      } else if (this.isRecoveringFromFall) {
        this.recoveryFrame++;
        if (this.recoveryFrame > (config.physics.landingRecoveryFrames || 60)) {
          this.isRecoveringFromFall = false;
        }
      }

      // 2. Si no está atrapado en animación, permitir movimiento
      if (!this.isHardLanding && !this.isRecoveringFromFall) {
        if (inputMap['w']) move.addInPlace(forward);
        if (inputMap['s']) move.subtractInPlace(forward);
        if (inputMap['d']) move.addInPlace(right);
        if (inputMap['a']) move.subtractInPlace(right);
      }

      if (seqRuntime.running && seqRuntime.allowMovement) {
        if (seqRuntime.forceForwardRun) move.addInPlace(forward.scale((config.movement.runSpeed || 0.09) * scaleFactor));
        if (seqRuntime.forceForwardWalk) move.addInPlace(forward.scale((config.movement.walkSpeed || 0.045) * scaleFactor));
      }

      isMoving = move.lengthSquared() > 0.001;
      isRunning = !!inputMap['shiftleft'] || !!inputMap['shiftright'] || !!inputMap['shift'] || seqRuntime.forceForwardRun;

      if (isMoving && !this.isHardLanding && !this.isRecoveringFromFall) {
        const modSpeed = (isRunning ? (config.movement.runSpeed || 0.09) : (config.movement.walkSpeed || 0.045)) * scaleFactor;
        
        if (!seqRuntime.running || !seqRuntime.allowMovement) {
          move.normalize().scaleInPlace(modSpeed);
        }

        // ROTAR JUGADOR EN TPS CON RESPECTO AL MOVIMIENTO REAL
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

      if (isGrounded) {
        if (this.isFalling || this.isJumping) {
          const fallDistance = this.highestY - jugador.position.y;
          if (fallDistance > (config.physics.hardLandingThreshold || 2.5) * scaleY) {
            this.isHardLanding = true;
            this.landingFrame = 0;
            move = Vector3.Zero();
          }
          this.isFalling = false;
          this.isJumping = false;
        }

        this.highestY = jugador.position.y;
        this.velocidadY = -0.05;

        if ((inputMap['space'] || seqRuntime.forceJump) && !this.isHardLanding && !this.isRecoveringFromFall) {
          this.velocidadY = (config.jump.force || 0.16) * scaleFactor;
          this.isJumping = true;
          inputMap['space'] = false; // Consumir input
        }
      } else {
        if (jugador.position.y > this.highestY) this.highestY = jugador.position.y;

        const gravityMul = this.isJumping ? 0.55 : (config.jump.jumpFallMultiplier || 1.0);
        this.velocidadY -= (config.jump.gravity || 0.018) * scaleFactor * gravityMul;
        const maxFallSpeed = config.jump.maxFallSpeed || 0.8;

        if (this.velocidadY < -maxFallSpeed * scaleFactor) {
          this.velocidadY = -maxFallSpeed * scaleFactor;
        }

        if (this.velocidadY < -0.05) {
          this.isFalling = true;
          this.isJumping = false;
        } else if (this.velocidadY > 0) {
          this.isJumping = true;
          this.isFalling = false;
        }
      }

      move.y = this.velocidadY;
      
      // Control contra NaNs para no desaparecer la malla de la pantalla
      if (isNaN(move.x)) move.x = 0;
      if (isNaN(move.y)) move.y = 0;
      if (isNaN(move.z)) move.z = 0;
      
      jugador.moveWithCollisions(move);
    }

    return {
      isMoving, isRunning, isGrounded, isJumping: this.isJumping, isFalling: this.isFalling,
      isHardLanding: this.isHardLanding, isRecoveringFromFall: this.isRecoveringFromFall,
      landingFrame: this.landingFrame, recoveryFrame: this.recoveryFrame, velocidadY: this.velocidadY
    };
  }
}