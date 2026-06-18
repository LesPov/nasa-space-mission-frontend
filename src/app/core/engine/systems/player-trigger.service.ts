// src/app/core/engine/systems/player-trigger.service.ts

import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { GameSession } from '../game-session';
import { GameStateService } from '../state/game-state.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity } from '../entities/game.entity';
import { GameEventBusService } from '../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class PlayerTriggerService {
  private gameState = inject(GameStateService);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private injector = inject(Injector);

  private get session(): GameSession { 
    return this.injector.get(GameSession); 
  }
  
  // Set para guardar quiénes están actualmente dentro de qué trigger
  private activeTriggersInside = new Set<string>();

  public prepararTriggersParaJuego(): void {
    this.activeTriggersInside.clear();
    const isAdmin = this.session.isAdminSession();

    this.entityManager.getAllEntities()
      .filter(e => e.type === 'trigger' || e.type === 'trigger_compuesto')
      .forEach(e => {
        if (e.view && e.trigger) {
            e.view.isVisible = isAdmin; 
            e.trigger.hasTriggeredEnter = false; 
            e.trigger.hasTriggeredExit = false; 
            e.trigger.isEnabled = true;
        }
    });
  }

  public restaurarTriggersParaEditor(): void {
    this.activeTriggersInside.clear();
    const isAdmin = this.session.isAdminSession();

    this.entityManager.getAllEntities()
      .filter(e => e.type === 'trigger' || e.type === 'trigger_compuesto')
      .forEach(e => {
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

        if (!this.gameState.evaluateAllConditions(triggerEntity.trigger.gameConditions)) {
            return;
        }
        
        const conditions = triggerEntity.trigger.isComposite 
            ? (triggerEntity.trigger.conditions || []) 
            : [triggerEntity.trigger.condition || 'on_enter'];
        
        if (!conditions.includes('on_enter') && !conditions.includes('on_exit')) return;

        const mesh = triggerEntity.view as AbstractMesh;
        if (!mesh) return;

        mesh.computeWorldMatrix(true);
        const triggerBox = mesh.getBoundingInfo().boundingBox;
        const isInside = triggerBox.intersectsPoint(probePoint);
        const wasInside = this.activeTriggersInside.has(triggerEntity.uid);

        // Evaluamos Entrada
        if (isInside && !wasInside) {
            this.activeTriggersInside.add(triggerEntity.uid);
            if (conditions.includes('on_enter')) {
                this.ejecutarLogicaTrigger(triggerEntity, 'on_enter');
            }
        }
        
        // Evaluamos Salida
        if (!isInside && wasInside) {
            this.activeTriggersInside.delete(triggerEntity.uid);

            if (conditions.includes('on_exit')) {
                this.ejecutarLogicaTrigger(triggerEntity, 'on_exit');
            }
            
            // Lógica "One Shot" (No repetible)
            if (!triggerEntity.trigger.isRepeatable) {
                 const reqEnter = conditions.includes('on_enter');
                 const reqExit = conditions.includes('on_exit');
                 const doneEnter = !reqEnter || triggerEntity.trigger.hasTriggeredEnter;
                 const doneExit = !reqExit || triggerEntity.trigger.hasTriggeredExit;

                 if (doneEnter && doneExit) {
                     triggerEntity.trigger.isEnabled = false;
                 }
            }
        }
    });
  }

  private ejecutarLogicaTrigger(triggerEntity: GameEntity, eventType: string): void {
      if (!triggerEntity.trigger || triggerEntity.trigger.isEnabled === false) return;
      
      if (!triggerEntity.trigger.isRepeatable) {
          if (eventType === 'on_enter' && triggerEntity.trigger.hasTriggeredEnter) return;
          if (eventType === 'on_exit' && triggerEntity.trigger.hasTriggeredExit) return;
      }

      let mensaje = '';
      let soundUrl = '';
      let seqIdString = ''; 
      let videoUrl = ''; 

      if (triggerEntity.trigger.isComposite) {
          if (eventType === 'on_enter') {
              mensaje = triggerEntity.trigger.mensajeEntrada;
              soundUrl = triggerEntity.trigger.soundUrlEntrada;
              seqIdString = triggerEntity.trigger.seqEntrada;
              videoUrl = triggerEntity.trigger.videoEntrada ?? '';
          } else if (eventType === 'on_exit') {
              mensaje = triggerEntity.trigger.mensajeSalida;
              soundUrl = triggerEntity.trigger.soundUrlSalida;
              seqIdString = triggerEntity.trigger.seqSalida;
              videoUrl = triggerEntity.trigger.videoSalida ?? '';
          }
      } else {
          if (triggerEntity.trigger.condition === eventType) {
              mensaje = triggerEntity.trigger.mensaje;
              soundUrl = triggerEntity.trigger.soundUrl;
              seqIdString = triggerEntity.trigger.interactSequenceId;
              videoUrl = triggerEntity.trigger.videoNorm ?? '';
          } else {
              return; 
          }
      }

      // 1. Emisión de Mensaje a UI vía Event Bus
      if (mensaje && mensaje.trim() !== '') {
          this.eventBus.emit({ type: 'MessageRequested', payload: mensaje });
      }

      // 2. Disparo de Audio Nativo
      if (soundUrl && soundUrl.trim() !== '') {
          try {
             const audio = new Audio(soundUrl);
             audio.volume = 0.8; 
             audio.play().catch(err => console.warn('Bloqueo de audio:', err));
          } catch(e) { console.error(e); }
      }

      // 3. Disparo de Video
      if (videoUrl && videoUrl.trim() !== '') {
          console.log("🎬 Reproduciendo Video Cinemático en Trigger:", videoUrl);
          // TODO: Interfaz de video global si hace falta.
      }

      // 4. Orquestación de Secuencias Remotas
      if (seqIdString && seqIdString.trim() !== '') {
          const rawIds = seqIdString.split(',').map((id: string) => id.trim()).filter(Boolean);
          const idsToTrigger = [...new Set(rawIds)];
          
          if (idsToTrigger.length > 0) {
              idsToTrigger.forEach(sequenceId => {
                  this.eventBus.emit({ type: 'SequenceTriggered', payload: { sequenceId } });
              });
          }
      }

      // 5. Aplicación de mutaciones lógicas del estado (Historia)
      if (triggerEntity.trigger.stateMutations) {
          this.gameState.applyMutations(triggerEntity.trigger.stateMutations);
      }

      // 6. Marcar el evento como disparado
      if (eventType === 'on_enter') triggerEntity.trigger.hasTriggeredEnter = true;
      if (eventType === 'on_exit') triggerEntity.trigger.hasTriggeredExit = true;
  }
}