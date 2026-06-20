
import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from '../../entities/game.entity';
import { LoopManagerService, GamePhase } from '../../behaviors/services/loop-manager.service';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { PlayerInteractionService } from './player-interaction.service';

@Injectable({ providedIn: 'root' })
export class PlayerBubbleService {
  private loopManager = inject(LoopManagerService);
  private eventBus = inject(GameEventBusService);
  private injector = inject(Injector);
  
  // 🔥 Lazy Injection
  private get interactSvc(): PlayerInteractionService { return this.injector.get(PlayerInteractionService); }
  
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
                if (burbujaEntity.interactionRuntime) {
                    burbujaEntity.interactionRuntime.isProcessingAction = false;
                }
            }
            this.bubblesOcultas.delete(burbujaEntity.uid);
            this.loopManager.unregister(loopId);
        }
    });

    this.bubblesOcultas.set(burbujaEntity.uid, { mesh: burbuja, loopId, entity: burbujaEntity });

    this.interactSvc.currentTarget = null;
    this.interactSvc.canInteract = false;
    this.interactSvc.canInspect = false;
    this.interactSvc.currentHoveredMesh = null;

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
  }

  public stop(): void {
    this.bubblesOcultas.forEach((data, uid) => {
      this.loopManager.unregister(data.loopId);
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