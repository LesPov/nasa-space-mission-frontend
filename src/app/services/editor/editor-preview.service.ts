// file: src/app/services/editor/editor-preview.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { PlayerSequenceService } from '../../core/engine/runtime/systems/player-sequence.service';
import { PlayerAnimationService } from '../../core/engine/runtime/systems/player-animation.service';
import { LoopManagerService, GamePhase } from '../../core/engine/behaviors/services/loop-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { AbstractMesh, StandardMaterial, Color3 } from '@babylonjs/core';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service'; 
import { DynamicLightingSystem } from '../../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { PlayerClipSequence } from '../../core/engine/models/player-config.model';

@Injectable({ providedIn: 'root' })
export class EditorPreviewService {
  private sequenceSvc = inject(PlayerSequenceService);
  private animSvc = inject(PlayerAnimationService);
  private loopManager = inject(LoopManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private gameState = inject(GameStateService); 
  private dynamicLighting = inject(DynamicLightingSystem);

  public isPlayingPreview = signal<boolean>(false);
  public currentPreviewTimeMs = signal<number>(0);

  private originalEntity: GameEntity | null = null;
  private currentSequence: PlayerClipSequence | null = null;
  private savedState: any = null;
  private previewLoopId = 'EditorSequencePreview';

  public iniciarPreviewSecuencia(entity: GameEntity, sequenceId: string): void {
    if (this.originalEntity && this.originalEntity.uid === entity.uid && this.isPlayingPreview()) {
      return;
    }

    this.detenerPreviewSecuencia();
    this.originalEntity = entity;

    const seq = entity.playerConfig?.sequences?.find(s => s.id === sequenceId) || null;
    this.currentSequence = seq;

    // Respaldo no destructivo del estado autoral del objeto
    this.savedState = {
      position: { ...entity.transform.position },
      rotation: { ...entity.transform.rotation },
      rotationQuaternion: entity.transform.rotationQuaternion ? { ...entity.transform.rotationQuaternion } : null,
      scale: { ...entity.transform.scale },
      intensity: entity.light ? entity.light.intensity : null,
      renderIntensity: entity.light ? entity.light.renderIntensity : null
    };

    this.gameState.enterSandbox();
    this.isPlayingPreview.set(true);

    this.animSvc.sincronizarAnimaciones(this.motor3d.getScene(), entity);
    this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, entity);

    this.loopManager.register(this.previewLoopId, GamePhase.LOGIC, (dtMs: number) => {
      if (!this.originalEntity || !this.isPlayingPreview()) return;

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

      if (this.originalEntity.type.startsWith('light_')) {
        this.dynamicLighting.syncLightImmediate(this.originalEntity);
      }

      if (!seqRuntime.running) {
        this.detenerPreviewSecuencia();
      }
    });
  }

  public pausarPreview(): void {
    this.isPlayingPreview.set(false);
  }

  public reanudarPreview(): void {
    if (this.originalEntity && this.currentSequence) {
      this.isPlayingPreview.set(true);
    }
  }

  public seekPreview(entity: GameEntity, sequenceId: string, timeMs: number): void {
    const seq = entity.playerConfig?.sequences?.find(s => s.id === sequenceId);
    if (!seq) return;

    if (!this.savedState) {
      this.savedState = {
        position: { ...entity.transform.position },
        rotation: { ...entity.transform.rotation },
        rotationQuaternion: entity.transform.rotationQuaternion ? { ...entity.transform.rotationQuaternion } : null,
        scale: { ...entity.transform.scale },
        intensity: entity.light ? entity.light.intensity : null,
        renderIntensity: entity.light ? entity.light.renderIntensity : null
      };
      this.originalEntity = entity;
    }

    this.currentPreviewTimeMs.set(timeMs);
    const runtime = this.sequenceSvc.evaluateSequenceAbsolute(entity, seq, timeMs);

    if (entity.hasComponent('characterConfig')) {
      const estadoFisicoFalso = { 
        isMoving: false, isRunning: false, isGrounded: true, 
        isJumping: false, isFalling: false, isHardLanding: false, 
        isRecoveringFromFall: false, landingFrame: 0, recoveryFrame: 0, 
        velocidadY: 0, highestY: 0 
      };
      this.animSvc.gestionarAnimaciones(entity, estadoFisicoFalso, runtime);
    }

    if (entity.type.startsWith('light_')) {
      this.dynamicLighting.syncLightImmediate(entity, true);
    }

    entity.syncToView();
  }

  public detenerPreviewSecuencia(): void {
    this.isPlayingPreview.set(false);
    this.currentPreviewTimeMs.set(0);

    if (this.originalEntity) {
      this.loopManager.unregister(this.previewLoopId);
      this.sequenceSvc.detenerSecuencia(this.originalEntity.uid);
      
      if (this.originalEntity.hasComponent('characterConfig')) {
        this.animSvc.detenerTodas(this.originalEntity);
      }
      
      // Restauración inmutable del estado físico e iluminación exactos
      if (this.savedState) {
        this.originalEntity.transform.position = { ...this.savedState.position };
        this.originalEntity.transform.rotation = { ...this.savedState.rotation };
        this.originalEntity.transform.rotationQuaternion = this.savedState.rotationQuaternion ? { ...this.savedState.rotationQuaternion } : null;
        this.originalEntity.transform.scale = { ...this.savedState.scale };
        
        if (this.originalEntity.light && this.savedState.intensity !== null) {
          this.originalEntity.light.intensity = this.savedState.intensity;
          this.originalEntity.light.renderIntensity = this.savedState.renderIntensity;
          
          const hex = this.originalEntity.light.lightColor || '#ffffff';
          const brillo = (this.originalEntity.light.intensity ?? 1.0);
          const c3 = Color3.FromHexString(hex).scale(brillo);
          
          if (this.originalEntity.view && this.originalEntity.view.material) {
            (this.originalEntity.view.material as StandardMaterial).emissiveColor = c3;
          }
          this.originalEntity.view?.getChildMeshes().forEach((m: AbstractMesh) => {
            if (m.material && m.material instanceof StandardMaterial) {
              m.material.emissiveColor = c3;
            }
          });

          this.dynamicLighting.syncLightImmediate(this.originalEntity, true);
        }
        
        this.originalEntity.isDirty = true;
        this.originalEntity.syncToView();
      }

      this.gameState.exitSandbox();
      this.originalEntity = null;
      this.currentSequence = null;
      this.savedState = null;
    }
  }

  public resincronizarAnimaciones(entity: GameEntity): void {
    this.animSvc.sincronizarAnimaciones(this.motor3d.getScene(), entity);
  }
}