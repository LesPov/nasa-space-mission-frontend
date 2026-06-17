import { Ray, Vector3, Quaternion } from '@babylonjs/core';
import { GamePhase } from '../../../../core/engine/behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';

export class PlayerController extends BaseCharacterController {
  
  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
  }

  public start(): void {
    this.context.animSvc.sincronizarAnimaciones(this.context.motor3d.scene, this.entity);

    const playerAutoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (playerAutoSeq) {
        this.context.sequenceSvc.iniciarSecuenciaEnJuego(playerAutoSeq.id, this.entity);
    }

    this.resetAll();

    this.context.loopManager.register(this.loopId, GamePhase.LOGIC, (dtMs: number) => {
      this.update(dtMs);
    });
  }

  protected update(dtMs: number): void {
    const activeCamera = this.context.motor3d.scene.activeCamera;
    if (!activeCamera) return;

    const vista = this.context.session.cameraView();

    this.context.triggerSvc.verificarTriggers(this.entity);
    this.context.interactSvc.comprobarInteracciones(this.entity, activeCamera, vista);
    
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    const canMove = this.context.session.pointerLocked() && !seqRuntime.lockInput && !seqRuntime.freezeOrientation;
    const activeInput = canMove ? this.context.inputSvc.inputMap : {};

    // Resolución de Movimiento Físico dentro del controlador
    this.aplicarFisicasJugador(activeInput, seqRuntime, activeCamera, vista, dtMs);

    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, seqRuntime);
    
    this.context.cameraSvc.actualizarPosicionCamara(
      this.entity, 
      activeCamera, 
      this.estadoFisico, 
      seqRuntime,
      vista
    );
    
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
    }
  }

  private aplicarFisicasJugador(
    inputMap: Record<string, boolean>, 
    seqRuntime: any, 
    activeCamera: any, 
    vista: 'FPS' | 'TPS',
    dtMs: number
  ): void {
    const scene = this.context.motor3d.scene;
    const colMeta = this.entity.collider;
    const scaleY = this.entity.transform.scale.y || 1;
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

    this.mesh.computeWorldMatrix(true);
    const localCapsuleCenter = new Vector3(colMeta.offsetX ?? 0, colMeta.offsetY ?? 0, colMeta.offsetZ ?? 0);
    const capsuleCenter = Vector3.TransformCoordinates(localCapsuleCenter, this.mesh.getWorldMatrix());

    const collFn = (m: any) =>
      m.checkCollisions && m !== this.mesh && !m.isDescendantOf(this.mesh) && !m.name.includes('gridHelper');

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

    if (seqRuntime.running && seqRuntime.forceJump && !this.estadoFisico.isJumping && !this.estadoFisico.isFalling) {
      this.estadoFisico.velocidadY = (this.config.jump.force || 0.16) * scaleFactor;
      this.estadoFisico.isJumping = true;
    }

    const rayCol = new Ray(capsuleCenter, Vector3.Down(), playerHalfHeight + (0.15 * scaleY));
    const hitInfo = scene.pickWithRay(rayCol, collFn);
    this.estadoFisico.isGrounded = hitInfo ? hitInfo.hit : false;

    if (this.estadoFisico.velocidadY > 0) this.estadoFisico.isGrounded = false;

    if (isCinematicSequence) {
      this.mesh.checkCollisions = false;
      const pForward = this.context.physicsSvc.sanitizeForwardDir(this.mesh.getDirection(Vector3.Forward()));

      if (dy !== 0 && !isNaN(dy)) this.mesh.position.y += dy;
      if (df !== 0 && !isNaN(df)) this.mesh.position.addInPlace(pForward.scale(df));

      this.mesh.computeWorldMatrix(true);

      this.estadoFisico.velocidadY = 0;
      this.estadoFisico.highestY = this.mesh.position.y;
      this.estadoFisico.isJumping = false;
      this.estadoFisico.isFalling = false;
      this.estadoFisico.isGrounded = true;
      this.estadoFisico.isMoving = true;

    } else {
      this.mesh.checkCollisions = true;

      if (this.estadoFisico.isHardLanding) {
        this.estadoFisico.landingFrame++;
        if (this.estadoFisico.landingFrame > (this.config.physics.landingRecoveryFrames || 60)) {
          this.estadoFisico.isHardLanding = false;
          this.estadoFisico.isRecoveringFromFall = true;
          this.estadoFisico.recoveryFrame = 0;
        }
      } else if (this.estadoFisico.isRecoveringFromFall) {
        this.estadoFisico.recoveryFrame++;
        if (this.estadoFisico.recoveryFrame > (this.config.physics.landingRecoveryFrames || 60)) {
          this.estadoFisico.isRecoveringFromFall = false;
        }
      }

      if (!this.estadoFisico.isHardLanding && !this.estadoFisico.isRecoveringFromFall) {
        if (inputMap['w']) move.addInPlace(forward);
        if (inputMap['s']) move.subtractInPlace(forward);
        if (inputMap['d']) move.addInPlace(right);
        if (inputMap['a']) move.subtractInPlace(right);
      }

      if (seqRuntime.running && seqRuntime.allowMovement) {
        if (seqRuntime.forceForwardRun) move.addInPlace(forward.scale((this.config.movement.runSpeed || 0.09) * scaleFactor));
        if (seqRuntime.forceForwardWalk) move.addInPlace(forward.scale((this.config.movement.walkSpeed || 0.045) * scaleFactor));
      }

      this.estadoFisico.isMoving = move.lengthSquared() > 0.001;
      this.estadoFisico.isRunning = !!inputMap['shiftleft'] || !!inputMap['shiftright'] || !!inputMap['shift'] || seqRuntime.forceForwardRun;

      if (this.estadoFisico.isMoving && !this.estadoFisico.isHardLanding && !this.estadoFisico.isRecoveringFromFall) {
        const modSpeed = (this.estadoFisico.isRunning ? (this.config.movement.runSpeed || 0.09) : (this.config.movement.walkSpeed || 0.045)) * scaleFactor;
        
        if (!seqRuntime.running || !seqRuntime.allowMovement) {
          move.normalize().scaleInPlace(modSpeed);
        }

        if (vista === 'TPS' && !seqRuntime.lockInput && !seqRuntime.freezeOrientation) {
          const targetAngle = Math.atan2(move.x, move.z);
          if (!isNaN(targetAngle)) {
            if (!this.mesh.rotationQuaternion) this.mesh.rotationQuaternion = Quaternion.Identity();
            this.mesh.rotationQuaternion = Quaternion.Slerp(
              this.mesh.rotationQuaternion, 
              Quaternion.FromEulerAngles(0, targetAngle, 0), 
              0.2
            );
          }
        }
      }

      // Gravedad y Salto
      if (this.estadoFisico.isGrounded) {
        if (this.estadoFisico.isFalling || this.estadoFisico.isJumping) {
          const fallDistance = this.estadoFisico.highestY - this.mesh.position.y;
          if (fallDistance > (this.config.physics.hardLandingThreshold || 2.5) * scaleY) {
            this.estadoFisico.isHardLanding = true;
            this.estadoFisico.landingFrame = 0;
            move = Vector3.Zero();
            this.estadoFisico.isMoving = false; 
          }
          this.estadoFisico.isFalling = false;
          this.estadoFisico.isJumping = false;
        }

        this.estadoFisico.highestY = this.mesh.position.y;
        this.estadoFisico.velocidadY = -0.05;

        if ((inputMap[' '] || inputMap['space'] || seqRuntime.forceJump) && !this.estadoFisico.isHardLanding && !this.estadoFisico.isRecoveringFromFall) {
          this.estadoFisico.velocidadY = (this.config.jump.force || 0.16) * scaleFactor;
          this.estadoFisico.isJumping = true;
          this.estadoFisico.isGrounded = false;
          inputMap[' '] = false;
          inputMap['space'] = false;
        }
      } else {
        if (this.mesh.position.y > this.estadoFisico.highestY) this.estadoFisico.highestY = this.mesh.position.y;

        const gravityMul = this.estadoFisico.isJumping ? 0.55 : (this.config.jump.jumpFallMultiplier || 1.0);
        this.estadoFisico.velocidadY -= (this.config.jump.gravity || 0.018) * scaleFactor * gravityMul;
        const maxFallSpeed = this.config.jump.maxFallSpeed || 0.8;

        if (this.estadoFisico.velocidadY < -maxFallSpeed * scaleFactor) {
          this.estadoFisico.velocidadY = -maxFallSpeed * scaleFactor;
        }

        if (this.estadoFisico.velocidadY < -0.05) {
          this.estadoFisico.isFalling = true;
          this.estadoFisico.isJumping = false;
        } else if (this.estadoFisico.velocidadY > 0) {
          this.estadoFisico.isJumping = true;
          this.estadoFisico.isFalling = false;
        }
      }

      move.y = this.estadoFisico.velocidadY;
      
      if (isNaN(move.x)) move.x = 0;
      if (isNaN(move.y)) move.y = 0;
      if (isNaN(move.z)) move.z = 0;
      
      this.mesh.moveWithCollisions(move);
    }
  }

  public resetAll(): void {
    this.resetPhysicsState();
    this.context.inputSvc.resetearInputs();
    this.context.cameraSvc.resetearTransiciones();
    
    this.context.animSvc.detenerTodas(this.entity);
    this.context.animSvc.reproducirIdle(this.entity); 
  }
}