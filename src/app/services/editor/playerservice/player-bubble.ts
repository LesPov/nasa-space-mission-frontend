import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { LoopManagerService, GamePhase } from '../../../core/engine/behaviors/services/loop-manager.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { PlayerInteractionService } from './player-interaction.service';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService {
  private loopManager = inject(LoopManagerService);
  private eventBus = inject(GameEventBusService);
  private interactSvc = inject(PlayerInteractionService);
  
  private bubblesOcultas = new Map<string, any>();

  public ejecutarBurbuja(burbujaEntity: GameEntity): void {
    const burbuja = burbujaEntity.view as AbstractMesh;
    if (!burbuja) return;

    burbuja.isVisible = false;
    burbuja.checkCollisions = false;
    
    const respawnTimeMs = Number(burbujaEntity.interaction.respawnTime ?? 8) * 1000;
    
    let elapsed = 0;
    const loopId = `BubbleRespawn_${burbujaEntity.uid}`;

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

    // Reseteamos el estado interno de interacción y emitimos al bus
    this.interactSvc.currentTarget = null;
    this.interactSvc.currentShowE = false;
    this.interactSvc.currentShowI = false;
    this.interactSvc.currentHoveredMesh = null;

    this.eventBus.emit({ type: 'INTERACTION_TARGET', payload: { entity: null, showE: false, showI: false } });
    this.eventBus.emit({ type: 'HOVER_MESH', payload: null });
    this.eventBus.emit({ type: 'HUD_MESSAGE', payload: null });
  }

  public restaurarBurbujasParaEditor(): void {
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