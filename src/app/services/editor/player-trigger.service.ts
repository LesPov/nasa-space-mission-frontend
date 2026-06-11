import { Injectable, inject } from '@angular/core';
import { Mesh, AbstractMesh } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
 
@Injectable({ providedIn: 'root' })
export class PlayerTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private triggersActivos: AbstractMesh[] = [];

  // Se llama cuando el usuario le da a "Play"
  public prepararTriggersParaJuego(): void {
    const scene = this.motor3d.scene;
    this.triggersActivos = [];

    scene.meshes.forEach(mesh => {
      if (mesh.metadata?.type === 'trigger') {
        mesh.isVisible = false; // El jugador no ve la caja verde
        mesh.metadata.hasTriggered = false; // Reiniciamos estado
        this.triggersActivos.push(mesh);
      }
    });
  }

  // Se llama cuando el usuario sale de "Play" al Editor
  public restaurarTriggersParaEditor(): void {
    this.triggersActivos.forEach(mesh => {
      mesh.isVisible = true; // Volvemos a ver la caja en el editor
    });
    this.state.mensajeTriggerHUD.set(null);
  }

  // Se ejecuta 60 veces por segundo para detectar colisiones (Intersects)
  public verificarTriggers(jugador: Mesh): void {
    if (!jugador) return;

    this.triggersActivos.forEach(trigger => {
        if (!trigger.metadata?.isEnabled) return;

        // Verifica si el colisionador del jugador toca la caja del trigger
        const intersecta = jugador.intersectsMesh(trigger, false);

        if (intersecta) {
            if (!trigger.metadata.hasTriggered && trigger.metadata.condition === 'on_enter') {
                trigger.metadata.hasTriggered = true;
                this.ejecutarAccion(trigger);
            }
        } else {
            // El jugador salió de la zona
            if (trigger.metadata.hasTriggered) {
                // Si es repetible, al salir se resetea para que vuelva a funcionar al entrar
                if (trigger.metadata.isRepeatable) {
                    trigger.metadata.hasTriggered = false;
                }
                
                // Si el mensaje actual es el de este trigger, lo limpiamos al salir
                if (this.state.mensajeTriggerHUD() === trigger.metadata.mensaje) {
                    this.state.mensajeTriggerHUD.set(null);
                }
            }
        }
    });
  }

  private ejecutarAccion(trigger: AbstractMesh): void {
      const meta = trigger.metadata;
      if (!meta) return;

      // Si el trigger tiene texto, lo mostramos como cinemática
      if (meta.mensaje && meta.mensaje.trim() !== '') {
          this.state.mensajeTriggerHUD.set(meta.mensaje);
          
          // Ocultar a los 5 segundos automáticamente (por si se queda quieto adentro)
          setTimeout(() => {
              if (this.state.mensajeTriggerHUD() === meta.mensaje) {
                  this.state.mensajeTriggerHUD.set(null);
              }
          }, 5000);
      }
  }
}