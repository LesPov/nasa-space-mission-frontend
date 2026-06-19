// src/app/core/engine/runtime/controllers/npc.controller.ts
import { Injector } from '@angular/core';
import { BaseCharacterController } from './base-character.controller';
import { GameEntity } from '../../entities/game.entity';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { PlayerAnimationService } from '../systems/player-animation.service';
import { PlayerSequenceService } from '../systems/player-sequence.service';

export class NpcController extends BaseCharacterController {
  
  private currentSeqRuntime: any;
  private motor3d: Motor3dService;
  private animSvc: PlayerAnimationService;
  private sequenceSvc: PlayerSequenceService;

  constructor(entity: GameEntity, injector: Injector) {
    super(entity, injector);
    this.motor3d = this.injector.get(Motor3dService);
    this.animSvc = this.injector.get(PlayerAnimationService);
    this.sequenceSvc = this.injector.get(PlayerSequenceService);
  }

  public start(): void {
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, this.entity);

    const autoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (autoSeq) {
      this.sequenceSvc.iniciarSecuenciaEnJuego(autoSeq.id, this.entity);
    } else {
      this.animSvc.reproducirIdle(this.entity);
    }

    this.loopManager.registerSystem(this);
  }

  public override destroy(): void {
    this.animSvc.detenerTodas(this.entity);
    super.destroy(); 
  }

  public physicsUpdate(dtMs: number): void {
    this.currentSeqRuntime = this.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    if (this.currentSeqRuntime.running && this.currentSeqRuntime.step) {
      const soY = this.currentSeqRuntime.step.offsetY || 0;
      const soF = this.currentSeqRuntime.step.offsetForward || 0;
      
      if (soY !== 0 || soF !== 0) {
        const durSec = Math.max(0.001, this.currentSeqRuntime.step.durationMs / 1000);
        const dy = (soY / durSec) * (dtMs / 1000);
        const df = (soF / durSec) * (dtMs / 1000);
        
        this.mesh.position.y += dy;
        const fwd = this.mesh.forward.clone();
        fwd.y = 0; 
        fwd.normalize();
        this.mesh.position.addInPlace(fwd.scale(df));
        
        this.estadoFisico.isMoving = true;
      } else {
        this.estadoFisico.isMoving = false;
      }
    } else {
      this.estadoFisico.isMoving = false;
    }

    this.entity.transform.position.x = this.mesh.position.x;
    this.entity.transform.position.y = this.mesh.position.y;
    this.entity.transform.position.z = this.mesh.position.z;
    
    if (this.mesh.rotationQuaternion) {
       const euler = this.mesh.rotationQuaternion.toEulerAngles();
       this.entity.transform.rotation.x = euler.x;
       this.entity.transform.rotation.y = euler.y;
       this.entity.transform.rotation.z = euler.z;
    } else {
       this.entity.transform.rotation.x = this.mesh.rotation.x;
       this.entity.transform.rotation.y = this.mesh.rotation.y;
       this.entity.transform.rotation.z = this.mesh.rotation.z;
    }
  }

  public update(dtMs: number): void {
    this.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, this.currentSeqRuntime);
    
    if (this.currentSeqRuntime.freezeOrientation) {
      this.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
      
      if (this.mesh.rotationQuaternion) {
        const euler = this.mesh.rotationQuaternion.toEulerAngles();
        this.entity.transform.rotation.x = euler.x;
        this.entity.transform.rotation.y = euler.y;
        this.entity.transform.rotation.z = euler.z;
      }
    }
  }

  public postUpdate(dtMs: number): void {
    this.entity.syncToView();
  }
}