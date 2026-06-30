import { Injectable, inject } from '@angular/core';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { PlayerSequenceService } from '../../core/engine/runtime/systems/player-sequence.service';
import { PlayerAnimationService } from '../../core/engine/runtime/systems/player-animation.service';
import { LoopManagerService, GamePhase } from '../../core/engine/behaviors/services/loop-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { AbstractMesh, Mesh, AnimationGroup, StandardMaterial, Color3 } from '@babylonjs/core';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service'; 

@Injectable({ providedIn: 'root' })
export class EditorPreviewService {
  private sequenceSvc = inject(PlayerSequenceService);
  private animSvc = inject(PlayerAnimationService);
  private loopManager = inject(LoopManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private gameState = inject(GameStateService); 

  private originalEntity: GameEntity | null = null;
  private savedState: any = null; // 🔥 ESTADO SALVADO (En lugar de clonar mallas)
  private previewLoopId = 'EditorSequencePreview';

  public iniciarPreviewSecuencia(entity: GameEntity, sequenceId: string): void {
    this.detenerPreviewSecuencia();
    this.originalEntity = entity;
    
    // 🔥 PRESERVAR EL ESTADO ANTES DE MODIFICAR
    this.savedState = {
        position: { ...entity.transform.position },
        rotation: { ...entity.transform.rotation },
        scale: { ...entity.transform.scale },
        intensity: entity.light ? entity.light.intensity : null,
        renderIntensity: entity.light ? entity.light.renderIntensity : null
    };

    // 🔥 Protegemos las variables del juego
    this.gameState.enterSandbox();

    this.animSvc.sincronizarAnimaciones(this.motor3d.getScene(), entity);
    this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, entity);
    
    this.loopManager.register(this.previewLoopId, GamePhase.LOGIC, (dtMs: number) => {
      if (!this.originalEntity) return;
      const seqRuntime = this.sequenceSvc.actualizarSecuencia(dtMs, this.originalEntity);
      
      if (this.originalEntity.hasComponent('characterConfig')) {
          const estadoFisicoFalso = { 
            isMoving: false, isRunning: false, isGrounded: true, 
            isJumping: false, isFalling: false, isHardLanding: false, 
            isRecoveringFromFall: false, landingFrame: 0, recoveryFrame: 0, 
            velocidadY: 0, highestY: 0 
          };
          this.animSvc.gestionarAnimaciones(this.originalEntity, estadoFisicoFalso, seqRuntime);
      }
      
      if (!seqRuntime.running) {
        this.detenerPreviewSecuencia();
      }
    });
  }

  public detenerPreviewSecuencia(): void {
    if (this.originalEntity) {
      this.loopManager.unregister(this.previewLoopId);
      this.sequenceSvc.detenerSecuencia(this.originalEntity.uid);
      
      if (this.originalEntity.hasComponent('characterConfig')) {
          this.animSvc.detenerTodas(this.originalEntity);
      }
      
      // 🔥 RESTAURAR EL ESTADO FÍSICO EXACTO
      if (this.savedState) {
          this.originalEntity.transform.position = { ...this.savedState.position };
          this.originalEntity.transform.rotation = { ...this.savedState.rotation };
          this.originalEntity.transform.scale = { ...this.savedState.scale };
          
          if (this.originalEntity.light && this.savedState.intensity !== null) {
              this.originalEntity.light.intensity = this.savedState.intensity;
              this.originalEntity.light.renderIntensity = this.savedState.renderIntensity;
              
              // RESTAURAR MATERIALES DE LUZ
              const hex = this.originalEntity.light.lightColor || '#ffffff';
              const brillo = (this.originalEntity.light.renderIntensity ?? 5) / 5;
              const c3 = Color3.FromHexString(hex).scale(brillo);
              
              if (this.originalEntity.view && this.originalEntity.view.material) {
                  (this.originalEntity.view.material as StandardMaterial).emissiveColor = c3;
              }
              this.originalEntity.view?.getChildMeshes().forEach((m: AbstractMesh) => {
                  if (m.material && m.material instanceof StandardMaterial) {
                     m.material.emissiveColor = c3;
                  }
              });
          }
          
          this.originalEntity.isDirty = true;
          this.originalEntity.syncToView();
      }

      this.gameState.exitSandbox();
      this.originalEntity = null;
      this.savedState = null;
    }
  }

  public resincronizarAnimaciones(entity: GameEntity): void {
    this.animSvc.sincronizarAnimaciones(this.motor3d.getScene(), entity);
  }
}