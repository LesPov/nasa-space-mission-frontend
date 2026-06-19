import { Injectable, inject } from '@angular/core';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { PlayerSequenceService } from '../../core/engine/runtime/systems/player-sequence.service';
import { PlayerAnimationService } from '../../core/engine/runtime/systems/player-animation.service';
import { LoopManagerService, GamePhase } from '../../core/engine/behaviors/services/loop-manager.service';
import { Motor3dService } from '../motor-3d.service';
import { AbstractMesh, Mesh, AnimationGroup } from '@babylonjs/core';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service'; // 🔥 ADD

@Injectable({ providedIn: 'root' })
export class EditorPreviewService {
  private sequenceSvc = inject(PlayerSequenceService);
  private animSvc = inject(PlayerAnimationService);
  private loopManager = inject(LoopManagerService);
  private motor3d = inject(Motor3dService);
  private gameState = inject(GameStateService); // 🔥 ADD

  private originalEntity: GameEntity | null = null;
  private cloneEntity: GameEntity | null = null;
  private clonedAnimationGroups: AnimationGroup[] = [];
  private previewLoopId = 'EditorSequencePreview';

  public iniciarPreviewSecuencia(entity: GameEntity, sequenceId: string): void {
    this.detenerPreviewSecuencia();
    this.originalEntity = entity;
    const originalMesh = entity.view as Mesh;
    
    // 🔥 Protegemos las variables del juego
    this.gameState.enterSandbox();

    originalMesh.isVisible = false;
    originalMesh.getChildMeshes().forEach(m => m.isVisible = false);

    let cloneMesh: AbstractMesh;
    if (entity.type === 'model') {
        cloneMesh = originalMesh.instantiateHierarchy(null, { doNotInstantiate: true }) as AbstractMesh;
        cloneMesh.name = 'preview_clone_' + originalMesh.name;
        
        this.motor3d.scene.animationGroups.forEach(ag => {
            const isTargetingOriginal = ag.targetedAnimations.some(ta => {
                let current: any = ta.target;
                while (current) {
                    if (current === originalMesh) return true;
                    current = current.parent;
                }
                return false;
            });

            if (isTargetingOriginal) {
                const clonedAg = ag.clone('preview_ag_' + ag.name, (oldTarget) => {
                    if (oldTarget === originalMesh) return cloneMesh;
                    const descendants = cloneMesh.getDescendants(false);
                    return descendants.find(d => d.name === (oldTarget as any).name) || oldTarget;
                });
                this.clonedAnimationGroups.push(clonedAg);
            }
        });
    } else {
        cloneMesh = originalMesh.clone('preview_clone_' + originalMesh.name, null) as AbstractMesh;
    }

    cloneMesh.position.copyFrom(originalMesh.position);
    if (originalMesh.rotationQuaternion) cloneMesh.rotationQuaternion = originalMesh.rotationQuaternion.clone();
    else cloneMesh.rotation.copyFrom(originalMesh.rotation);
    cloneMesh.scaling.copyFrom(originalMesh.scaling);

    cloneMesh.isVisible = true;
    cloneMesh.getChildMeshes().forEach(m => m.isVisible = true);

    this.cloneEntity = new GameEntity('preview_' + entity.uid, 'preview_' + entity.name, entity.type, entity.rol);
    this.cloneEntity.playerConfig = JSON.parse(JSON.stringify(entity.playerConfig));
    this.cloneEntity.animationNames = [...entity.animationNames];
    this.cloneEntity.bindView(cloneMesh);
    
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, this.cloneEntity);
    this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, this.cloneEntity);
    
    this.loopManager.register(this.previewLoopId, GamePhase.LOGIC, (dtMs: number) => {
      if (!this.cloneEntity) return;
      const seqRuntime = this.sequenceSvc.actualizarSecuencia(dtMs, this.cloneEntity);
      
      const estadoFisicoFalso = { 
        isMoving: false, isRunning: false, isGrounded: true, 
        isJumping: false, isFalling: false, isHardLanding: false, 
        isRecoveringFromFall: false, landingFrame: 0, recoveryFrame: 0, 
        velocidadY: 0, highestY: 0 
      };
      
      this.animSvc.gestionarAnimaciones(this.cloneEntity, estadoFisicoFalso, seqRuntime);
      
      if (!seqRuntime.running) {
        this.detenerPreviewSecuencia();
      }
    });
  }

  public detenerPreviewSecuencia(): void {
    if (this.cloneEntity) {
      this.loopManager.unregister(this.previewLoopId);
      this.animSvc.detenerTodas(this.cloneEntity);
      this.sequenceSvc.detenerSecuencia(this.cloneEntity.uid);
      
      this.clonedAnimationGroups.forEach(ag => {
          ag.stop();
          ag.dispose();
      });
      this.clonedAnimationGroups = [];
      
      this.cloneEntity.destroyView(); 
      this.cloneEntity = null;
      
      // 🔥 Desactivamos Sandbox y borramos mutaciones que la secuencia haya simulado
      this.gameState.exitSandbox();
    }

    if (this.originalEntity) {
      const originalMesh = this.originalEntity.view as Mesh;
      if (originalMesh) {
         originalMesh.isVisible = true;
         originalMesh.getChildMeshes().forEach(m => m.isVisible = true);
      }
      this.originalEntity = null;
    }
  }

  public resincronizarAnimaciones(entity: GameEntity): void {
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, entity);
  }
}