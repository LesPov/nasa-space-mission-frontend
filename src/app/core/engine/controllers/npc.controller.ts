
import { GamePhase } from '../behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from './character-context.interface';
import { GameEntity } from '../entities/game.entity';

export class NpcController extends BaseCharacterController {
  
  private currentSeqRuntime: any;

  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
  }

  public start(): void {
    this.context.animSvc.sincronizarAnimaciones(this.context.motor3d.scene, this.entity);

    const autoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (autoSeq) {
      this.context.sequenceSvc.iniciarSecuenciaEnJuego(autoSeq.id, this.entity);
    } else {
      this.context.animSvc.reproducirIdle(this.entity);
    }

    this.context.loopManager.register(this.loopId + '_PHYSICS', GamePhase.PHYSICS, (dtMs: number) => this.physicsUpdate(dtMs));
    this.context.loopManager.register(this.loopId + '_LOGIC', GamePhase.LOGIC, (dtMs: number) => this.logicUpdate(dtMs));
    this.context.loopManager.register(this.loopId + '_POST', GamePhase.POST_UPDATE, (dtMs: number) => this.postUpdate(dtMs));
  }

  protected physicsUpdate(dtMs: number): void {
    this.currentSeqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    if (this.currentSeqRuntime.running && this.currentSeqRuntime.step) {
      const soY = this.currentSeqRuntime.step.offsetY || 0;
      const soF = this.currentSeqRuntime.step.offsetForward || 0;
      
      if (soY !== 0 || soF !== 0) {
        const durSec = Math.max(0.001, this.currentSeqRuntime.step.durationMs / 1000);
        const dy = (soY / durSec) * (dtMs / 1000);
        const df = (soF / durSec) * (dtMs / 1000);
        
        // Malla como proxy volumétrico temporal
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

    // Entidad como Fuente de Verdad Matemática
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

  protected logicUpdate(dtMs: number): void {
    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, this.currentSeqRuntime);
    
    if (this.currentSeqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
      
      if (this.mesh.rotationQuaternion) {
        const euler = this.mesh.rotationQuaternion.toEulerAngles();
        this.entity.transform.rotation.x = euler.x;
        this.entity.transform.rotation.y = euler.y;
        this.entity.transform.rotation.z = euler.z;
      }
    }
  }

  protected postUpdate(dtMs: number): void {
    this.entity.syncToView();
  }
}