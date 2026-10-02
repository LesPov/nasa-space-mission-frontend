
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3 } from '@babylonjs/core';
import { GameStateService } from '../state/game-state.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { InputOrchestratorService } from './input-orchestrator.service';
import { PlayerCameraManagerService } from './player-camera.service';
import { TriggerAudioService } from './trigger-audio.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { CinematicDirectorService } from './cinematic-director.service';

@Injectable({ providedIn: 'root' })
export class PlayerTriggerService implements IUpdatable {
  public id = 'PlayerTriggerSystem';
  private gameState = inject(GameStateService);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private context = inject(GameContextService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private cameraSvc = inject(PlayerCameraManagerService);
  private triggerAudioSvc = inject(TriggerAudioService);
  private ownership = inject(CameraOwnershipService);
  private cinematicDirector = inject(CinematicDirectorService);
  
  private activeTriggersInside = new Set<string>();
  private teleportCooldown: number = 0;
  private isTransitioning = false;

  // 🔥 PREVENCIÓN DE ALLOCATIONS
  private _probePoint = Vector3.Zero();

  public start(): void {
    this.resetTransitionState();
    const isDebugMode = this.context.isDebugMode();

    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.type === 'trigger' || e.type === 'trigger_compuesto') {
            if (e.view && e.triggerRuntime) {
                e.view.isVisible = isDebugMode; 
                e.triggerRuntime.hasTriggeredEnter = false; 
                e.triggerRuntime.hasTriggeredExit = false; 
                e.triggerRuntime.isEnabled = true;
            }
        }
    }
  }

  public stop(): void {
    this.activeTriggersInside.clear();
    const isDebugMode = this.context.isDebugMode();

    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.type === 'trigger' || e.type === 'trigger_compuesto') {
            if (e.view && e.triggerRuntime) {
                e.view.isVisible = isDebugMode; 
                e.triggerRuntime.hasTriggeredEnter = false; 
                e.triggerRuntime.hasTriggeredExit = false; 
                e.triggerRuntime.isEnabled = true;
            }
        }
    }
  }

  public resetTransitionState(): void {
    this.isTransitioning = false;
    this.teleportCooldown = 1500;
    this.activeTriggersInside.clear();
  }

  public update(dtMs: number): void {
    if (this.isTransitioning) return;

    const isCinematic = this.context.isCinematicPlaying();
    const playerEntity = this.context.activePlayerEntity();
    
    if (!playerEntity && !isCinematic) return;

    if (this.teleportCooldown > 0) {
        this.teleportCooldown -= dtMs;
        this.verificarTriggers(playerEntity, true, isCinematic);
    } else {
        this.verificarTriggers(playerEntity, false, isCinematic);
    }
  }

  public verificarTriggers(entity: GameEntity | null, silent: boolean = false, isCinematic: boolean = false): void {
    if (this.isTransitioning) return;

    const probePoint = this._probePoint;
    probePoint.setAll(0);
    
    if (isCinematic) {
        const cam = this.ownership.getCamera();
        if (cam) probePoint.copyFrom(cam.globalPosition);
    } else if (entity) {
        const jugador = entity.view as Mesh;
        if (!jugador) return;
        const colMeta = entity.collider || { offsetY: 0.9 };
        const playerCenterY = colMeta.offsetY * (entity.transform.scale.y || 1);
        probePoint.copyFrom(jugador.getAbsolutePosition());
        probePoint.y += playerCenterY;
    } else {
        return;
    }

    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
        const triggerEntity = entities[i];
        if (triggerEntity.type !== 'trigger' && triggerEntity.type !== 'trigger_compuesto') continue;
        
        if (!triggerEntity.trigger || triggerEntity.triggerRuntime?.isEnabled === false) continue;

        if (!this.gameState.evaluateAllConditions(triggerEntity.trigger.gameConditions)) {
            continue;
        }
        
        const conditions = triggerEntity.trigger.isComposite 
            ? (triggerEntity.trigger.conditions || []) 
            : [triggerEntity.trigger.condition || 'on_enter'];
        
        if (!conditions.includes('on_enter') && !conditions.includes('on_exit')) continue;

        const mesh = triggerEntity.view as AbstractMesh;
        if (!mesh) continue;

        const isInside = mesh.intersectsPoint(probePoint);
        const wasInside = this.activeTriggersInside.has(triggerEntity.uid);

        if (isInside && !wasInside) {
            this.activeTriggersInside.add(triggerEntity.uid);
            if (!silent && conditions.includes('on_enter')) {
                this.ejecutarLogicaTrigger(triggerEntity, 'on_enter');
            }
        }
        
        if (!isInside && wasInside) {
            this.activeTriggersInside.delete(triggerEntity.uid);

            if (!silent && conditions.includes('on_exit')) {
                this.ejecutarLogicaTrigger(triggerEntity, 'on_exit');
            }
            
            if (!triggerEntity.trigger.isRepeatable) {
                 const reqEnter = conditions.includes('on_enter');
                 const reqExit = conditions.includes('on_exit');
                 const doneEnter = !reqEnter || triggerEntity.triggerRuntime?.hasTriggeredEnter;
                 const doneExit = !reqExit || triggerEntity.triggerRuntime?.hasTriggeredExit;

                 if (doneEnter && doneExit && triggerEntity.triggerRuntime) {
                     triggerEntity.triggerRuntime.isEnabled = false;
                 }
            }
        }
    }
  }

  private ejecutarLogicaTrigger(triggerEntity: GameEntity, eventType: string): void {
      if (this.isTransitioning) return;
      if (!triggerEntity.trigger || triggerEntity.triggerRuntime?.isEnabled === false) return;
      
      if (!triggerEntity.trigger.isRepeatable) {
          if (eventType === 'on_enter' && triggerEntity.triggerRuntime?.hasTriggeredEnter) return;
          if (eventType === 'on_exit' && triggerEntity.triggerRuntime?.hasTriggeredExit) return;
      }

      if (triggerEntity.trigger.actionType === 'change_scene') {
          const targetId = triggerEntity.trigger.targetSceneId;
          if (targetId) {
              this.isTransitioning = true;
              this.cinematicDirector.stop();
              this.triggerAudioSvc.stop();

              const playerEntity = this.context.activePlayerEntity();
              if (playerEntity && playerEntity.playerRuntime) {
                  playerEntity.playerRuntime.intentions = { moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, run: false, jump: false };
                  playerEntity.playerRuntime.physicsState.isMoving = false;
                  playerEntity.playerRuntime.physicsState.isRunning = false;
                  playerEntity.playerRuntime.physicsState.velocidadY = 0;
              }
              this.inputOrchestrator.unlockPointer();
              
              if (playerEntity) {
                  this.cameraSvc.transicionSalidaPlataforma(playerEntity, () => {
                      this.eventBus.emit({ type: 'ChangeSceneRequested', payload: { sceneId: targetId } });
                  });
              } else {
                  this.eventBus.emit({ type: 'ChangeSceneRequested', payload: { sceneId: targetId } });
              }
              return; 
          }
      }

      let mensaje = '';
      let seqIdString = ''; 

      if (triggerEntity.trigger.isComposite) {
          if (eventType === 'on_enter') {
              mensaje = triggerEntity.trigger.mensajeEntrada;
              seqIdString = triggerEntity.trigger.seqEntrada;
          } else if (eventType === 'on_exit') {
              mensaje = triggerEntity.trigger.mensajeSalida;
              seqIdString = triggerEntity.trigger.seqSalida;
          }
      } else {
          if (triggerEntity.trigger.condition === eventType) {
              mensaje = triggerEntity.trigger.mensaje;
              seqIdString = triggerEntity.trigger.interactSequenceId;
          } else {
              return; 
          }
      }

      this.triggerAudioSvc.playTriggerEvent(triggerEntity, eventType);

      if (mensaje && mensaje.trim() !== '') {
          const timeToHide = triggerEntity.trigger.isComposite ? 
              (eventType === 'on_enter' ? triggerEntity.trigger.timeEntrada : triggerEntity.trigger.timeSalida) : 
              triggerEntity.trigger.timeNorm;
          
          this.eventBus.emit({ type: 'MessageRequested', payload: { text: mensaje, durationMs: (timeToHide || 4.5) * 1000 } });
      }

      if (seqIdString && seqIdString.trim() !== '') {
          const rawIds = seqIdString.split(',').map((id: string) => id.trim()).filter(Boolean);
          const idsToTrigger = [...new Set(rawIds)];
          
          if (idsToTrigger.length > 0) {
              idsToTrigger.forEach(sequenceId => {
                  this.eventBus.emit({ type: 'SequenceTriggered', payload: { sequenceId } });
              });
          }
      }

      if (triggerEntity.trigger.stateMutations) {
          this.gameState.applyMutations(triggerEntity.trigger.stateMutations);
      }

      if (eventType === 'on_enter' && triggerEntity.triggerRuntime) triggerEntity.triggerRuntime.hasTriggeredEnter = true;
      if (eventType === 'on_exit' && triggerEntity.triggerRuntime) triggerEntity.triggerRuntime.hasTriggeredExit = true;
  }
}