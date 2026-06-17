
import { GamePhase } from '../../../../core/engine/behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export class NpcController extends BaseCharacterController {
  
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

    this.context.loopManager.register(this.loopId, GamePhase.LOGIC, (dtMs: number) => {
      this.update(dtMs);
    });
  }

  protected update(dtMs: number): void {
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    if (seqRuntime.running && seqRuntime.step) {
      const soY = seqRuntime.step.offsetY || 0;
      const soF = seqRuntime.step.offsetForward || 0;
      
      if (soY !== 0 || soF !== 0) {
        const durSec = Math.max(0.001, seqRuntime.step.durationMs / 1000);
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
    
    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, seqRuntime);
    
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
    }
  }
}