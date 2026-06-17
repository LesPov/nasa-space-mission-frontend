import { GamePhase } from '../../../../core/engine/behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export class NpcController extends BaseCharacterController {
  
  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
  }

  public start(): void {
    // 1. Sincronizamos animaciones
    this.context.animSvc.sincronizarAnimaciones(this.context.motor3d.scene, this.entity);

    // 2. Auto-iniciar secuencia si la tiene configurada
    const autoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (autoSeq) {
      this.context.sequenceSvc.iniciarSecuenciaEnJuego(autoSeq.id, this.entity);
    } else {
      this.context.animSvc.reproducirIdle(this.entity);
    }

    // 3. Registrarse en el Loop Manager
    this.context.loopManager.register(this.loopId, GamePhase.LOGIC, (dtMs: number) => {
      this.update(dtMs);
    });
  }

  protected update(dtMs: number): void {
    // Calcular rutinas/cinemáticas del NPC
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    // Físicas procedurales falsas (Aplicar transformaciones basadas en la secuencia de animación)
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
    
    // Reproducir animaciones según estado
    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, seqRuntime);
    
    // Congelar rotación si la animación lo requiere
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
    }
  }
}