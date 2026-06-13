
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService {
  private state = inject(EditorStateService);
  
  // Usamos un Map para guardar qué burbuja se ocultó y el ID de su Timeout
  private bubblesOcultas = new Map<AbstractMesh, any>();

  public ejecutarBurbuja(burbuja: AbstractMesh): void {
    console.log('🫧 Burbuja Interactiva activada:', burbuja.name);
    
    // 1. Ocultamos el objeto y deshabilitamos colisiones para que "desaparezca"
    burbuja.isVisible = false;
    burbuja.checkCollisions = false;
    
    // 🔥 FIX RESPAWN: Leemos el tiempo de reaparición. Por defecto 8 segundos.
    const respawnTime = Number(burbuja.metadata?.respawnTime ?? 8) * 1000;

    // Ejecutamos la promesa de reaparición
    const timeoutId = setTimeout(() => {
        if (!burbuja.isDisposed()) {
            burbuja.isVisible = true;
            burbuja.checkCollisions = false; 
            this.bubblesOcultas.delete(burbuja);
            burbuja.metadata.isProcessingAction = false;
        }
    }, respawnTime);

    this.bubblesOcultas.set(burbuja, timeoutId);

    // 2. Limpiamos la UI al instante
    this.state.targetInteractuable.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.objetoHovereado.set(null);
    this.state.showToastE.set(false);
    this.state.showToastI.set(false);
    this.state.mensajeTriggerHUD.set(null);

    // 🚀 AQUÍ A FUTURO IRÁ LA LÓGICA DE CINEMÁTICAS, VARIABLES DE HISTORIA, AUDIO Y VIDEOS.
  }

  public restaurarBurbujasParaEditor(): void {
    // Si el Admin sale del modo juego antes de que pasen los 8s, matamos el timer y las restauramos a la fuerza
    this.bubblesOcultas.forEach((timeoutId, b) => {
      clearTimeout(timeoutId);
      if (!b.isDisposed()) {
          b.isVisible = true;
          b.metadata.isProcessingAction = false;
      }
    });
    this.bubblesOcultas.clear();
  }
}
