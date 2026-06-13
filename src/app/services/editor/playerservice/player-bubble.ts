import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService {
  private state = inject(EditorStateService);
  private bubblesOcultas = new Set<AbstractMesh>();

  public ejecutarBurbuja(burbuja: AbstractMesh): void {
    console.log('🫧 Burbuja Interactiva activada:', burbuja.name);
    
    // 1. Ocultamos el objeto y deshabilitamos colisiones para que "desaparezca"
    burbuja.isVisible = false;
    burbuja.checkCollisions = false;
    
    // Lo guardamos en memoria para volverlo a mostrar cuando termine el modo juego
    this.bubblesOcultas.add(burbuja);

    // 2. Limpiamos la UI para que el texto o el punto de selección desaparezcan inmediatamente
    this.state.targetInteractuable.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.objetoHovereado.set(null);
    this.state.showToastE.set(false);
    this.state.showToastI.set(false);
    this.state.mensajeTriggerHUD.set(null);

    // 🚀 AQUÍ A FUTURO IRÁ LA LÓGICA DE CINEMÁTICAS, VARIABLES DE HISTORIA, AUDIO Y VIDEOS.
  }

  public restaurarBurbujasParaEditor(): void {
    // Cuando el Admin sale del modo juego, restauramos las burbujas a la escena
    this.bubblesOcultas.forEach(b => {
      b.isVisible = true;
      // No restauramos las colisiones porque originalmente las burbujas no deberían ser sólidas
    });
    this.bubblesOcultas.clear();
  }
}