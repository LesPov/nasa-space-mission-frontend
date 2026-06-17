
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService {
  private state = inject(EditorStateService);
  
  // Usamos un Map para guardar qué burbuja se ocultó y el ID de su Timeout
  private bubblesOcultas = new Map<string, any>();

  public ejecutarBurbuja(burbujaEntity: GameEntity): void {
    console.log('🫧 Burbuja Interactiva activada:', burbujaEntity.name);
    const burbuja = burbujaEntity.view as AbstractMesh;
    if (!burbuja) return;

    // 1. Ocultamos el objeto y deshabilitamos colisiones para que "desaparezca"
    burbuja.isVisible = false;
    burbuja.checkCollisions = false;
    
    // 🔥 FIX RESPAWN: Leemos el tiempo de reaparición desde el InteractionComponent de la Entidad
    const respawnTime = Number(burbujaEntity.interaction.respawnTime ?? 8) * 1000;

    // Ejecutamos la promesa de reaparición
    const timeoutId = setTimeout(() => {
        if (!burbuja.isDisposed()) {
            burbuja.isVisible = true;
            burbuja.checkCollisions = false; 
            this.bubblesOcultas.delete(burbujaEntity.uid);
            burbujaEntity.isProcessingAction = false;
        }
    }, respawnTime);

    this.bubblesOcultas.set(burbujaEntity.uid, { mesh: burbuja, timeoutId, entity: burbujaEntity });

    // 2. Limpiamos la UI al instante
    this.state.targetInteractuable.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.objetoHovereado.set(null);
    this.state.showToastE.set(false);
    this.state.showToastI.set(false);
    this.state.mensajeTriggerHUD.set(null);
  }

  public restaurarBurbujasParaEditor(): void {
    // Si el Admin sale del modo juego antes de que pasen los 8s, matamos el timer y las restauramos a la fuerza
    this.bubblesOcultas.forEach((data, uid) => {
      clearTimeout(data.timeoutId);
      if (!data.mesh.isDisposed()) {
          data.mesh.isVisible = true;
          data.entity.isProcessingAction = false;
      }
    });
    this.bubblesOcultas.clear();
  }
}