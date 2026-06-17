
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { PlayerSequenceService } from './playerservice/player-sequence.service';
import { GameStateService } from './game-state.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class PlayerTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private sequenceSvc = inject(PlayerSequenceService);
  private gameState = inject(GameStateService);
  private entityManager = inject(EntityManagerService);
  
  private activeTriggersInside = new Set<string>();
  private hudTimeouts = new Map<string, any>();

  public prepararTriggersParaJuego(): void {
    this.activeTriggersInside.clear();
    this.hudTimeouts.forEach(t => clearTimeout(t));
    this.hudTimeouts.clear();
    
    const isAdmin = this.state.rolSimulado() === 'admin';

    this.entityManager.getAllEntities().filter(e => e.type === 'trigger' || e.type === 'trigger_compuesto').forEach(e => {
        if (e.view && e.trigger) {
            e.view.isVisible = isAdmin; 
            e.trigger.hasTriggeredEnter = false; 
            e.trigger.hasTriggeredExit = false; 
            e.trigger.isEnabled = true;
        }
    });
  }

  public restaurarTriggersParaEditor(): void {
    const isAdmin = this.state.rolSimulado() === 'admin';
    
    this.activeTriggersInside.clear();
    this.hudTimeouts.forEach(t => clearTimeout(t));
    this.hudTimeouts.clear();

    this.entityManager.getAllEntities().filter(e => e.type === 'trigger' || e.type === 'trigger_compuesto').forEach(e => {
        if (e.view && e.trigger) {
            e.view.isVisible = isAdmin; 
            e.trigger.hasTriggeredEnter = false; 
            e.trigger.hasTriggeredExit = false; 
            e.trigger.isEnabled = true;
        }
    });
  }

  public verificarTriggers(entity: GameEntity): void {
    const jugador = entity.view as Mesh;
    if (!jugador) return;

    const colMeta = entity.collider || { offsetY: 0.9 };
    const playerCenterY = colMeta.offsetY * (entity.transform.scale.y || 1);
    const playerPos = jugador.getAbsolutePosition();
    
    const probePoint = playerPos.clone();
    probePoint.y += playerCenterY;

    const triggers = this.entityManager.getAllEntities().filter(e => e.type === 'trigger' || e.type === 'trigger_compuesto');

    triggers.forEach(triggerEntity => {
        if (!triggerEntity.trigger || triggerEntity.trigger.isEnabled === false) return;

        // 🔥 NARRATIVA: Verificar si el trigger cumple requisitos de historia para funcionar
        if (!this.gameState.evaluateAllConditions(triggerEntity.trigger.gameConditions)) {
            return;
        }
        
        let conditions = triggerEntity.trigger.isComposite ? (triggerEntity.trigger.conditions || []) : [triggerEntity.trigger.condition || 'on_enter'];
        
        if (!conditions.includes('on_enter') && !conditions.includes('on_exit')) return;

        const mesh = triggerEntity.view as AbstractMesh;
        if (!mesh) return;

        mesh.computeWorldMatrix(true);
        const triggerBox = mesh.getBoundingInfo().boundingBox;
        const isInside = triggerBox.intersectsPoint(probePoint);
        const wasInside = this.activeTriggersInside.has(triggerEntity.uid);

        if (isInside && !wasInside) {
            this.activeTriggersInside.add(triggerEntity.uid);
            if (conditions.includes('on_enter')) {
                this.ejecutarLogicaTrigger(triggerEntity, 'on_enter');
            }
        }
        
        if (!isInside && wasInside) {
            this.activeTriggersInside.delete(triggerEntity.uid);

            let mostroMensajeSalida = false;
            if (conditions.includes('on_exit')) {
                mostroMensajeSalida = this.ejecutarLogicaTrigger(triggerEntity, 'on_exit');
            }
            
            if (!triggerEntity.trigger.isRepeatable) {
                 const reqEnter = conditions.includes('on_enter');
                 const reqExit = conditions.includes('on_exit');
                 const doneEnter = !reqEnter || triggerEntity.trigger.hasTriggeredEnter;
                 const doneExit = !reqExit || triggerEntity.trigger.hasTriggeredExit;

                 if (doneEnter && doneExit) {
                     triggerEntity.trigger.isEnabled = false;
                 }
            }

            if (!mostroMensajeSalida) {
                const hudAct = this.state.mensajeTriggerHUD();
                if (hudAct === triggerEntity.trigger.mensajeEntrada || hudAct === triggerEntity.trigger.mensaje) {
                    this.state.mensajeTriggerHUD.set(null);
                    if (this.hudTimeouts.has('hud')) {
                        clearTimeout(this.hudTimeouts.get('hud'));
                    }
                }
            }
        }
    });
  }

  private ejecutarLogicaTrigger(triggerEntity: GameEntity, eventType: string): boolean {
      if (!triggerEntity.trigger || triggerEntity.trigger.isEnabled === false) return false;
      
      if (!triggerEntity.trigger.isRepeatable) {
          if (eventType === 'on_enter' && triggerEntity.trigger.hasTriggeredEnter) return false;
          if (eventType === 'on_exit' && triggerEntity.trigger.hasTriggeredExit) return false;
      }

      let mensaje = '';
      let soundUrl = '';
      let seqIdString = ''; 
      let msgTime = 4.5; 
      let videoUrl = ''; 

      if (triggerEntity.trigger.isComposite) {
          if (eventType === 'on_enter') {
              mensaje = triggerEntity.trigger.mensajeEntrada;
              soundUrl = triggerEntity.trigger.soundUrlEntrada;
              seqIdString = triggerEntity.trigger.seqEntrada;
              msgTime = triggerEntity.trigger.timeEntrada ?? 4.5;
              videoUrl = triggerEntity.trigger.videoEntrada ?? '';
          } else if (eventType === 'on_exit') {
              mensaje = triggerEntity.trigger.mensajeSalida;
              soundUrl = triggerEntity.trigger.soundUrlSalida;
              seqIdString = triggerEntity.trigger.seqSalida;
              msgTime = triggerEntity.trigger.timeSalida ?? 4.5;
              videoUrl = triggerEntity.trigger.videoSalida ?? '';
          }
      } else {
          if (triggerEntity.trigger.condition === eventType) {
              mensaje = triggerEntity.trigger.mensaje;
              soundUrl = triggerEntity.trigger.soundUrl;
              seqIdString = triggerEntity.trigger.interactSequenceId;
              msgTime = triggerEntity.trigger.timeNorm ?? 4.5;
              videoUrl = triggerEntity.trigger.videoNorm ?? '';
          } else {
              return false; 
          }
      }

      let mostroMensaje = false;

      if (mensaje && mensaje.trim() !== '') {
          this.state.mensajeTriggerHUD.set(mensaje);
          mostroMensaje = true;
          
          if (this.hudTimeouts.has('hud')) clearTimeout(this.hudTimeouts.get('hud'));
          
          const timeoutId = setTimeout(() => {
              if (this.state.mensajeTriggerHUD() === mensaje) {
                  this.state.mensajeTriggerHUD.set(null);
              }
          }, msgTime * 1000); 

          this.hudTimeouts.set('hud', timeoutId);
      }

      if (soundUrl && soundUrl.trim() !== '') {
          try {
             const audio = new Audio(soundUrl);
             audio.volume = 0.8; 
             audio.play().catch(err => console.warn('Bloqueo de audio:', err));
          } catch(e) { console.error(e); }
      }

      if (videoUrl && videoUrl.trim() !== '') {
          console.log("🎬 Reproduciendo Video Cinemático en Trigger:", videoUrl);
      }

      if (seqIdString && seqIdString.trim() !== '') {
          const rawIds = seqIdString.split(',').map((id: string) => id.trim()).filter(Boolean);
          const idsToTrigger = [...new Set(rawIds)];
          
          if (idsToTrigger.length > 0) {
              idsToTrigger.forEach(sequenceToFind => {
                  let found = false;
                  
                  this.entityManager.getAllEntities().forEach(e => {
                      if (e.playerConfig && e.playerConfig.sequences) {
                          const hasSequence = e.playerConfig.sequences.some((s: any) => s.id === sequenceToFind);
                          if (hasSequence) {
                              found = true;
                              this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceToFind, e);
                          }
                      }
                  });

                  if (!found) {
                      console.warn(`⚠️ Trigger ${triggerEntity.name} intentó iniciar la secuencia [${sequenceToFind}] pero ninguna entidad en la escena la tiene.`);
                  }
              });
          }
      }

      // 🔥 NARRATIVA: Mutar estado del juego una vez ejecutado el trigger
      if (triggerEntity.trigger.stateMutations) {
          this.gameState.applyMutations(triggerEntity.trigger.stateMutations);
      }

      if (eventType === 'on_enter') triggerEntity.trigger.hasTriggeredEnter = true;
      if (eventType === 'on_exit') triggerEntity.trigger.hasTriggeredExit = true;

      return mostroMensaje;
  }
}