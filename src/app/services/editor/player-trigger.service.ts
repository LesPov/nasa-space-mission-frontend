import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { EditorStateService } from './editor-state.service';
import { Motor3dService } from '../motor-3d.service';
import { PlayerSequenceService } from './playerservice/player-sequence.service';

@Injectable({ providedIn: 'root' })
export class PlayerTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private sequenceSvc = inject(PlayerSequenceService);
  
  // Guardamos qué triggers está pisando el jugador actualmente
  private activeTriggersInside = new Set<string>();

  // Mapas para manejar los temporizadores y poder cancelarlos
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
    this.hudTimeouts.forEach(t => clearTimeout(t));

    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            m.isVisible = isAdmin; 
        }
    });
  }

  public verificarTriggers(jugador: Mesh): void {
    if (!jugador) return;
    const scene = this.motor3d.scene;

    const colMeta = jugador.metadata?.collider || { offsetY: 0.9 };
    const playerCenterY = colMeta.offsetY * (jugador.scaling.y || 1);
    const playerPos = jugador.getAbsolutePosition();
    
    // Punto central del cuerpo del jugador (pecho/cintura)
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

        // ==========================================
        // CASO 1: EL JUGADOR ENTRA AL TRIGGER
        // ==========================================
        if (isInside && !wasInside) {
            this.activeTriggersInside.add(mesh.name);
            if (conditions.includes('on_enter')) {
                this.ejecutarLogicaTrigger(mesh, jugador, 'on_enter');
            }
        }
        
        // ==========================================
        // CASO 2: EL JUGADOR SALE DEL TRIGGER
        // ==========================================
        if (!isInside && wasInside) {
            this.activeTriggersInside.delete(mesh.name);

            let mostroMensajeSalida = false;
            
            if (conditions.includes('on_exit')) {
                mostroMensajeSalida = this.ejecutarLogicaTrigger(mesh, jugador, 'on_exit');
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

  private ejecutarLogicaTrigger(triggerMesh: AbstractMesh, jugador: Mesh, eventType: string): boolean {
      if (triggerMesh.metadata.isEnabled === false) return false;
      
      if (!triggerMesh.metadata.isRepeatable) {
          if (eventType === 'on_enter' && triggerMesh.metadata.hasTriggeredEnter) return false;
          if (eventType === 'on_exit' && triggerMesh.metadata.hasTriggeredExit) return false;
      }

      let mensaje = '';
      let soundUrl = '';
      let seqId = '';
      let msgTime = 4.5; // Tiempo por defecto
      let videoUrl = ''; // Nuevo campo cinemática

      if (triggerMesh.metadata.isComposite) {
          if (eventType === 'on_enter') {
              mensaje = triggerMesh.metadata.mensajeEntrada;
              soundUrl = triggerMesh.metadata.soundUrlEntrada;
              seqId = triggerMesh.metadata.seqEntrada;
              msgTime = triggerMesh.metadata.timeEntrada ?? 4.5;
              videoUrl = triggerMesh.metadata.videoEntrada ?? '';
          } else if (eventType === 'on_exit') {
              mensaje = triggerMesh.metadata.mensajeSalida;
              soundUrl = triggerMesh.metadata.soundUrlSalida;
              seqId = triggerMesh.metadata.seqSalida;
              msgTime = triggerMesh.metadata.timeSalida ?? 4.5;
              videoUrl = triggerMesh.metadata.videoSalida ?? '';
          }
      } else {
          if (triggerMesh.metadata.condition === eventType) {
              mensaje = triggerMesh.metadata.mensaje;
              soundUrl = triggerMesh.metadata.soundUrl;
              seqId = triggerMesh.metadata.interactSequenceId;
              msgTime = triggerMesh.metadata.timeNorm ?? 4.5;
              videoUrl = triggerMesh.metadata.videoNorm ?? '';
          } else {
              return false; 
          }
      }

      let mostroMensaje = false;

      // 1. Mostrar Mensaje en el HUD con su tiempo personalizado
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

      // 2. Reproducir Sonido
      if (soundUrl && soundUrl.trim() !== '') {
          try {
             const audio = new Audio(soundUrl);
             audio.volume = 0.8; 
             audio.play().catch(err => console.warn('Bloqueo de audio:', err));
          } catch(e) { console.error(e); }
      }

      // 3. (FUTURO) Reproducir Video Cinemático
      if (videoUrl && videoUrl.trim() !== '') {
          console.log("🎬 Reproduciendo Video Cinemático en Trigger:", videoUrl);
          // Aquí más adelante llamaremos a un servicio de UI para poner el video en pantalla completa.
      }

      // 4. Ejecutar Secuencias Cinemáticas del Personaje
      if (seqId && seqId.trim() !== '') {
          const ids = seqId.split(',').map((id: string) => id.trim()).filter(Boolean);
          if (ids.length > 0) {
              const playerConfig = jugador.metadata?.playerConfig;
              if (playerConfig) {
                  this.sequenceSvc.iniciarSecuenciaEnJuego(ids[0], jugador, playerConfig);
              }
          }
      }

      // Marcamos banderas de uso
      if (eventType === 'on_enter') triggerMesh.metadata.hasTriggeredEnter = true;
      if (eventType === 'on_exit') triggerMesh.metadata.hasTriggeredExit = true;

      return mostroMensaje;
  }
}