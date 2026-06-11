import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, BoundingBox } from '@babylonjs/core';
import { EditorStateService } from './editor-state.service';
import { Motor3dService } from '../motor-3d.service';
import { PlayerSequenceService } from './playerservice/player-sequence.service';
import { EditorPlayerService } from './editor-player.service';

@Injectable({ providedIn: 'root' })
export class PlayerTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private sequenceSvc = inject(PlayerSequenceService);
  
  // Guardamos un registro de los triggers en los que el jugador está parado actualmente
  private activeTriggersInside = new Set<string>();

  public prepararTriggersParaJuego(): void {
    this.activeTriggersInside.clear();
    const scene = this.motor3d.scene;
    
    // Ocultar mallas verdes de trigger en el juego
    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            m.isVisible = false;
            m.metadata.hasTriggered = false; // Reset de repeticiones
        }
    });
  }

  public restaurarTriggersParaEditor(): void {
    const scene = this.motor3d.scene;
    // Volver a mostrar
    scene.meshes.forEach(m => {
        if (m.metadata && m.metadata.type === 'trigger') {
            m.isVisible = true;
        }
    });
  }

  public verificarTriggers(jugador: Mesh): void {
    if (!jugador) return;
    const scene = this.motor3d.scene;

    // Actualizamos las matrices de colisión del jugador
    jugador.computeWorldMatrix(true);
    const jugadorBox = jugador.getBoundingInfo().boundingBox;

    scene.meshes.forEach(mesh => {
        if (!mesh.metadata || mesh.metadata.type !== 'trigger' || !mesh.metadata.isEnabled) return;
        
        const conditions = mesh.metadata.conditions as string[] || [];
        
        // No gastamos cálculos si el trigger no detecta entradas o salidas
        if (!conditions.includes('on_enter') && !conditions.includes('on_exit')) return;

        mesh.computeWorldMatrix(true);
        const triggerBox = mesh.getBoundingInfo().boundingBox;

        // Comprobación rápida de intersección de cajas (AABB)
        const isInside = BoundingBox.Intersects(jugadorBox, triggerBox);

        const wasInside = this.activeTriggersInside.has(mesh.name);

        // CASO 1: Entró al trigger este frame
        if (isInside && !wasInside) {
            this.activeTriggersInside.add(mesh.name);
            if (conditions.includes('on_enter')) {
                this.dispararEventoTrigger(mesh, jugador);
            }
        }
        
        // CASO 2: Salió del trigger este frame
        if (!isInside && wasInside) {
            this.activeTriggersInside.delete(mesh.name);
            
            // Si el trigger no es repetible y ya se usó, se apaga. Si es repetible, reseteamos.
            if (!mesh.metadata.isRepeatable && mesh.metadata.hasTriggered) {
                 mesh.metadata.isEnabled = false;
            } else {
                 mesh.metadata.hasTriggered = false;
            }

            if (conditions.includes('on_exit')) {
                this.dispararEventoTrigger(mesh, jugador);
            }
            
            // Ocultamos el mensaje del HUD si nos fuimos
            if (this.state.mensajeTriggerHUD() === mesh.metadata.mensaje) {
                this.state.mensajeTriggerHUD.set(null);
            }
        }
    });
  }

  private dispararEventoTrigger(triggerMesh: AbstractMesh, jugador: Mesh): void {
      if (!triggerMesh.metadata.isRepeatable && triggerMesh.metadata.hasTriggered) return;

      triggerMesh.metadata.hasTriggered = true;

      const mensaje = triggerMesh.metadata.mensaje;
      if (mensaje && mensaje.trim() !== '') {
          this.state.mensajeTriggerHUD.set(mensaje);
          
          // Ocultar mensaje automáticamente si solo es un texto temporal
          setTimeout(() => {
              if (this.state.mensajeTriggerHUD() === mensaje) {
                  this.state.mensajeTriggerHUD.set(null);
              }
          }, 4000);
      }

      // Si el trigger tiene una secuencia configurada, la ejecutamos
      const view = this.state.modoVistaPrueba;
      const seqId = view === 'FPS' 
        ? triggerMesh.metadata.interactSequenceIdFPS 
        : triggerMesh.metadata.interactSequenceIdTPS;

      if (seqId && seqId.trim() !== '') {
          // Buscamos la secuencia en el jugador activo (ya que el trigger no es un modelo animado)
          const playerConfig = jugador.metadata?.playerConfig;
          if (playerConfig) {
              this.sequenceSvc.iniciarSecuenciaEnJuego(seqId, jugador, playerConfig);
          }
      }
  }
}