
import { Injectable, inject } from '@angular/core';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { PlayerSequenceService } from '../../core/engine/runtime/systems/player-sequence.service';
import { PlayerAnimationService } from '../../core/engine/runtime/systems/player-animation.service';
import { LoopManagerService, GamePhase } from '../../core/engine/behaviors/services/loop-manager.service';
import { Motor3dService } from '../motor-3d.service';

@Injectable({ providedIn: 'root' })
export class EditorPreviewService {
  private sequenceSvc = inject(PlayerSequenceService);
  private animSvc = inject(PlayerAnimationService);
  private loopManager = inject(LoopManagerService);
  private motor3d = inject(Motor3dService);

  private previewEntity: GameEntity | null = null;
  private previewLoopId = 'EditorSequencePreview';

  public iniciarPreviewSecuencia(entity: GameEntity, sequenceId: string): void {
    this.detenerPreviewSecuencia();
    this.previewEntity = entity;
    
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, entity);
    this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, entity);
    
    this.loopManager.register(this.previewLoopId, GamePhase.LOGIC, (dtMs: number) => {
      if (!this.previewEntity) return;
      const seqRuntime = this.sequenceSvc.actualizarSecuencia(dtMs, this.previewEntity);
      
      // Estado falso necesario para que la animación fluya estáticamente en el editor
      const estadoFisicoFalso = { 
        isMoving: false, isRunning: false, isGrounded: true, 
        isJumping: false, isFalling: false, isHardLanding: false, 
        isRecoveringFromFall: false, landingFrame: 0, recoveryFrame: 0, 
        velocidadY: 0, highestY: 0 
      };
      
      this.animSvc.gestionarAnimaciones(this.previewEntity, estadoFisicoFalso, seqRuntime);
      
      if (!seqRuntime.running) {
        this.detenerPreviewSecuencia();
      }
    });
  }

  public detenerPreviewSecuencia(): void {
    if (this.previewEntity) {
      this.loopManager.unregister(this.previewLoopId);
      this.animSvc.detenerTodas(this.previewEntity);
      this.sequenceSvc.detenerSecuencia(this.previewEntity.uid);
      
      // Restauramos el Transform desde la entidad, garantizando que el mesh
      // vuelve a donde estaba antes del preview, sin contaminar la lógica en runtime.
      this.previewEntity.syncToView();
      
      this.previewEntity = null;
    }
  }

  public resincronizarAnimaciones(entity: GameEntity): void {
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, entity);
  }
}