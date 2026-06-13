import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { PlayerSequenceService } from './playerservice/player-sequence.service';

@Injectable({ providedIn: 'root' })
export class PlayerTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private sequenceSvc = inject(PlayerSequenceService);
  
  private activeTriggersInside = new Set<string>();
  private hudTimeouts = new Map<string, any>();

  public prepararTriggersParaJuego(): void {
    this.activeTriggersInside.clear();
    this.hudTimeouts.forEach(t => clearTimeout(t));
    this.hudTimeouts.clear();
    
    const scene = this.motor3d.scene;
    const isAdmin = this.state.rolSimulado() === 'admin';

    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            m.isVisible = isAdmin; 
            m.metadata.hasTriggeredEnter = false; 
            m.metadata.hasTriggeredExit = false; 
            m.metadata.isEnabled = true;
        }
    });
  }

  public restaurarTriggersParaEditor(): void {
    const scene = this.motor3d.scene;
    const isAdmin = this.state.rolSimulado() === 'admin';
    
    this.activeTriggersInside.clear();
    this.hudTimeouts.forEach(t => clearTimeout(t));
    this.hudTimeouts.clear();

    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            m.isVisible = isAdmin; 
            m.metadata.hasTriggeredEnter = false; 
            m.metadata.hasTriggeredExit = false; 
            m.metadata.isEnabled = true;
        }
    });
  }

  public verificarTriggers(jugador: Mesh): void {
    if (!jugador) return;
    const scene = this.motor3d.scene;

    const colMeta = jugador.metadata?.collider || { offsetY: 0.9 };
    const playerCenterY = colMeta.offsetY * (jugador.scaling.y || 1);
    const playerPos = jugador.getAbsolutePosition();
    
    const probePoint = playerPos.clone();
    probePoint.y += playerCenterY;

    scene.meshes.forEach(mesh => {
        if (!mesh.metadata || mesh.metadata.type !== 'trigger' || mesh.metadata.isEnabled === false) return;
        
        let conditions: string[] = [];
        if (mesh.metadata.isComposite) {
             conditions = mesh.metadata.conditions || [];
        } else {
             conditions = [mesh.metadata.condition || 'on_enter'];
        }
        
        if (!conditions.includes('on_enter') && !conditions.includes('on_exit')) return;

        mesh.computeWorldMatrix(true);
        const triggerBox = mesh.getBoundingInfo().boundingBox;
        const isInside = triggerBox.intersectsPoint(probePoint);
        const wasInside = this.activeTriggersInside.has(mesh.name);

        // 🔥 FIX BUG 1: Eliminamos la restricción del primer frame. 
        // Si el jugador nace o entra al juego dentro del trigger, SE DEBE EJECUTAR para que las luces/secuencias inicien.
        if (isInside && !wasInside) {
            this.activeTriggersInside.add(mesh.name);
            if (conditions.includes('on_enter')) {
                this.ejecutarLogicaTrigger(mesh, 'on_enter');
            }
        }
        
        if (!isInside && wasInside) {
            this.activeTriggersInside.delete(mesh.name);

            let mostroMensajeSalida = false;
            if (conditions.includes('on_exit')) {
                mostroMensajeSalida = this.ejecutarLogicaTrigger(mesh, 'on_exit');
            }
            
            if (!mesh.metadata.isRepeatable) {
                 const reqEnter = conditions.includes('on_enter');
                 const reqExit = conditions.includes('on_exit');
                 const doneEnter = !reqEnter || mesh.metadata.hasTriggeredEnter;
                 const doneExit = !reqExit || mesh.metadata.hasTriggeredExit;

                 if (doneEnter && doneExit) {
                     mesh.metadata.isEnabled = false;
                 }
            }

            if (!mostroMensajeSalida) {
                const hudAct = this.state.mensajeTriggerHUD();
                if (hudAct === mesh.metadata.mensajeEntrada || hudAct === mesh.metadata.mensaje) {
                    this.state.mensajeTriggerHUD.set(null);
                    if (this.hudTimeouts.has('hud')) {
                        clearTimeout(this.hudTimeouts.get('hud'));
                    }
                }
            }
        }
    });
  }

  private ejecutarLogicaTrigger(triggerMesh: AbstractMesh, eventType: string): boolean {
      if (triggerMesh.metadata.isEnabled === false) return false;
      
      if (!triggerMesh.metadata.isRepeatable) {
          if (eventType === 'on_enter' && triggerMesh.metadata.hasTriggeredEnter) return false;
          if (eventType === 'on_exit' && triggerMesh.metadata.hasTriggeredExit) return false;
      }

      let mensaje = '';
      let soundUrl = '';
      let seqIdString = ''; 
      let msgTime = 4.5; 
      let videoUrl = ''; 

      if (triggerMesh.metadata.isComposite) {
          if (eventType === 'on_enter') {
              mensaje = triggerMesh.metadata.mensajeEntrada;
              soundUrl = triggerMesh.metadata.soundUrlEntrada;
              seqIdString = triggerMesh.metadata.seqEntrada;
              msgTime = triggerMesh.metadata.timeEntrada ?? 4.5;
              videoUrl = triggerMesh.metadata.videoEntrada ?? '';
          } else if (eventType === 'on_exit') {
              mensaje = triggerMesh.metadata.mensajeSalida;
              soundUrl = triggerMesh.metadata.soundUrlSalida;
              seqIdString = triggerMesh.metadata.seqSalida;
              msgTime = triggerMesh.metadata.timeSalida ?? 4.5;
              videoUrl = triggerMesh.metadata.videoSalida ?? '';
          }
      } else {
          if (triggerMesh.metadata.condition === eventType) {
              mensaje = triggerMesh.metadata.mensaje;
              soundUrl = triggerMesh.metadata.soundUrl;
              seqIdString = triggerMesh.metadata.interactSequenceId;
              msgTime = triggerMesh.metadata.timeNorm ?? 4.5;
              videoUrl = triggerMesh.metadata.videoNorm ?? '';
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
              const scene = this.motor3d.scene;
              
              idsToTrigger.forEach(sequenceToFind => {
                  let found = false;
                  
                  scene.meshes.forEach(m => {
                      if (m.metadata && m.metadata.playerConfig && m.metadata.playerConfig.sequences) {
                          const hasSequence = m.metadata.playerConfig.sequences.some((s: any) => s.id === sequenceToFind);
                          if (hasSequence) {
                              found = true;
                              this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceToFind, m as Mesh, m.metadata.playerConfig);
                          }
                      }
                  });

                  if (!found) {
                      console.warn(`⚠️ Trigger ${triggerMesh.name} intentó iniciar la secuencia [${sequenceToFind}] pero ningún objeto en la escena la tiene.`);
                  }
              });
          }
      }

      if (eventType === 'on_enter') triggerMesh.metadata.hasTriggeredEnter = true;
      if (eventType === 'on_exit') triggerMesh.metadata.hasTriggeredExit = true;

      return mostroMensaje;
  }
}