import { Vector3 } from '@babylonjs/core';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export class NpcController extends BaseCharacterController {
  
  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
    
    // Auto-iniciar secuencia si la tiene configurada
    const autoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (autoSeq) {
      this.context.sequenceSvc.iniciarSecuenciaEnJuego(autoSeq.id, this.mesh, this.config);
    }
  }

  public update(dtMs: number): void {
    // Calcular rutinas/cinemáticas del NPC
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.mesh, this.config);
    
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
    this.context.animSvc.gestionarAnimaciones(this.mesh, this.estadoFisico, seqRuntime, this.config);
    
    // Congelar rotación si la animación lo requiere
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.mesh);
    }
  }
}