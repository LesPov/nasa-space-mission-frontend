// src/app/services/editor/playerservice/player-bubble.ts
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { LoopManagerService, GamePhase } from '../../../core/engine/behaviors/services/loop-manager.service';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService {
  private state = inject(EditorStateService);
  private loopManager = inject(LoopManagerService);
  
  // Usamos un Map para guardar qué burbuja se ocultó y el ID de su loop temporal
  private bubblesOcultas = new Map<string, any>();

  public ejecutarBurbuja(burbujaEntity: GameEntity): void {
    console.log('🫧 Burbuja Interactiva activada:', burbujaEntity.name);
    const burbuja = burbujaEntity.view as AbstractMesh;
    if (!burbuja) return;

    // 1. Ocultamos el objeto y deshabilitamos colisiones para que "desaparezca"
    burbuja.isVisible = false;
    burbuja.checkCollisions = false;
    
    // Leemos el tiempo de reaparición desde el InteractionComponent de la Entidad
    const respawnTimeMs = Number(burbujaEntity.interaction.respawnTime ?? 8) * 1000;
    
    let elapsed = 0;
    const loopId = `BubbleRespawn_${burbujaEntity.uid}`;

    // 2. Registramos el contador en el motor lógico (No más setTimeout)
    this.loopManager.register(loopId, GamePhase.LOGIC, (dtMs: number) => {
        elapsed += dtMs;
        if (elapsed >= respawnTimeMs) {
            if (!burbuja.isDisposed()) {
                burbuja.isVisible = true;
                burbuja.checkCollisions = false; 
                burbujaEntity.isProcessingAction = false;
            }
            this.bubblesOcultas.delete(burbujaEntity.uid);
            this.loopManager.unregister(loopId);
        }
    });

    this.bubblesOcultas.set(burbujaEntity.uid, { mesh: burbuja, loopId, entity: burbujaEntity });

    // 3. Limpiamos la UI al instante
    this.state.targetInteractuable.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.objetoHovereado.set(null);
    this.state.showToastE.set(false);
    this.state.showToastI.set(false);
    this.state.mensajeTriggerHUD.set(null);
  }

  public restaurarBurbujasParaEditor(): void {
    // Si el Admin sale del modo juego, matamos el timer lógico y restauramos a la fuerza
    this.bubblesOcultas.forEach((data, uid) => {
      this.loopManager.unregister(data.loopId);
      if (!data.mesh.isDisposed()) {
          data.mesh.isVisible = true;
          data.entity.isProcessingAction = false;
      }
    });
    this.bubblesOcultas.clear();
  }
}