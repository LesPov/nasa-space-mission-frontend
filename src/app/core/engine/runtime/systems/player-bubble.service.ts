import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from '../../entities/game.entity';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameEventBusService } from '../../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService implements IUpdatable {
  public id = 'PlayerBubbleSystem';
  private eventBus = inject(GameEventBusService);
  
  private bubblesOcultas = new Map<string, { mesh: AbstractMesh, remainingMs: number, entity: GameEntity }>();

  public update(dtMs: number): void {
    this.bubblesOcultas.forEach((data, uid) => {
      data.remainingMs -= dtMs;
      if (data.remainingMs <= 0) {
        if (!data.mesh.isDisposed()) {
            data.mesh.isVisible = true;
            data.mesh.checkCollisions = false; 
            if (data.entity.interactionRuntime) {
                data.entity.interactionRuntime.isProcessingAction = false;
            }
        }
        this.bubblesOcultas.delete(uid);
      }
    });
  }

  public ejecutarBurbuja(burbujaEntity: GameEntity): void {
    const burbuja = burbujaEntity.view as AbstractMesh;
    if (!burbuja) return;

    burbuja.isVisible = false;
    burbuja.checkCollisions = false;
    
    const respawnTimeMs = Number(burbujaEntity.interaction.respawnTime ?? 8) * 1000;
    this.bubblesOcultas.set(burbujaEntity.uid, { mesh: burbuja, remainingMs: respawnTimeMs, entity: burbujaEntity });

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
  }

  public start(): void {
    this.bubblesOcultas.clear();
  }

  public stop(): void {
    this.bubblesOcultas.forEach((data) => {
      if (!data.mesh.isDisposed()) {
          data.mesh.isVisible = true;
          if (data.entity.interactionRuntime) {
              data.entity.interactionRuntime.isProcessingAction = false;
          }
      }
    });
    this.bubblesOcultas.clear();
  }
}