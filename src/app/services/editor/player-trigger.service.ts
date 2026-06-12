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

  public prepararTriggersParaJuego(): void {
    this.activeTriggersInside.clear();
    const scene = this.motor3d.scene;
    
    // 🔥 LÓGICA DE ROL: Saber si es Admin.
    const isAdmin = this.state.rolSimulado() === 'admin';

    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            // 🔥 Si es Admin, los triggers se quedan VISIBLES para poder editarlos. Si es User, se ocultan.
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

    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            // 🔥 Restauramos la visibilidad dependiendo del rol activo
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

        // Evaluamos si el centro del jugador cruzó los límites de la caja del Trigger
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

            if (conditions.includes('on_exit')) {
                this.ejecutarLogicaTrigger(mesh, jugador, 'on_exit');
            }
            
            // Si el trigger no es repetible, lo apagamos para siempre una vez haya entrado y salido
            if (!mesh.metadata.isRepeatable) {
                 mesh.metadata.isEnabled = false;
            }

            // Limpiamos el mensaje de la pantalla si era de este trigger
            if (this.state.mensajeTriggerHUD() === mesh.metadata.mensajeEntrada || this.state.mensajeTriggerHUD() === mesh.metadata.mensajeSalida || this.state.mensajeTriggerHUD() === mesh.metadata.mensaje) {
                this.state.mensajeTriggerHUD.set(null);
            }
        }
    });
  }

  private ejecutarLogicaTrigger(triggerMesh: AbstractMesh, jugador: Mesh, eventType: string): void {
      if (triggerMesh.metadata.isEnabled === false) return;
      
      if (!triggerMesh.metadata.isRepeatable) {
          if (eventType === 'on_enter' && triggerMesh.metadata.hasTriggeredEnter) return;
          if (eventType === 'on_exit' && triggerMesh.metadata.hasTriggeredExit) return;
      }

      let mensaje = '';
      let soundUrl = '';
      let seqId = '';

      if (triggerMesh.metadata.isComposite) {
          if (eventType === 'on_enter') {
              mensaje = triggerMesh.metadata.mensajeEntrada;
              soundUrl = triggerMesh.metadata.soundUrlEntrada;
              seqId = triggerMesh.metadata.seqEntrada;
          } else if (eventType === 'on_exit') {
              mensaje = triggerMesh.metadata.mensajeSalida;
              soundUrl = triggerMesh.metadata.soundUrlSalida;
              seqId = triggerMesh.metadata.seqSalida;
          }
      } else {
          if (triggerMesh.metadata.condition === eventType) {
              mensaje = triggerMesh.metadata.mensaje;
              soundUrl = triggerMesh.metadata.soundUrl;
              seqId = triggerMesh.metadata.interactSequenceId; // Reusamos campo
          } else {
              return; 
          }
      }

      // 1. Mostrar Mensaje en el HUD
      if (mensaje && mensaje.trim() !== '') {
          this.state.mensajeTriggerHUD.set(mensaje);
          setTimeout(() => {
              if (this.state.mensajeTriggerHUD() === mensaje) {
                  this.state.mensajeTriggerHUD.set(null);
              }
          }, 4500); // 4.5 segundos en pantalla
      }

      // 2. Reproducir Sonido (Musica, efectos, voces)
      if (soundUrl && soundUrl.trim() !== '') {
          try {
             const audio = new Audio(soundUrl);
             audio.volume = 0.8; // Volumen general
             audio.play().catch(err => console.warn('El navegador bloqueó el audio automático:', err));
          } catch(e) {
             console.error("Error reproduciendo audio del trigger", e);
          }
      }

      // 3. Ejecutar Secuencias Cinemáticas (Por si quieres que al entrar lance animación)
      if (seqId && seqId.trim() !== '') {
          const ids = seqId.split(',').map((id: string) => id.trim()).filter(Boolean);
          if (ids.length > 0) {
              const playerConfig = jugador.metadata?.playerConfig;
              if (playerConfig) {
                  // Ejecuta siempre el primero en Triggers simples
                  this.sequenceSvc.iniciarSecuenciaEnJuego(ids[0], jugador, playerConfig);
              }
          }
      }

      // Marcamos la bandera para no repetirlo si no debe
      if (eventType === 'on_enter') triggerMesh.metadata.hasTriggeredEnter = true;
      if (eventType === 'on_exit') triggerMesh.metadata.hasTriggeredExit = true;
  }
}