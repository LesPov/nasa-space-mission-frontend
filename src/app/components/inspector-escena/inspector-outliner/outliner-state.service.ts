
import { Injectable, signal, inject } from '@angular/core';
import { Node } from '@babylonjs/core';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class OutlinerStateService {
  public draggedNode = signal<Node | null>(null);
  public dropAction = signal<'above' | 'below' | 'inside' | null>(null);
  public searchTerm = signal<string>('');

  public contextMenuOpen = signal<boolean>(false);
  public contextMenuPosition = signal<{x: number, y: number}>({x: 0, y: 0});
  public contextMenuNode = signal<Node | null>(null);

  public expandedNodes = new Set<string>();

  // 🔥 Mecanismos de invalidación reactiva granulada (0 detectChanges masivos por frame)
  public structureRevision = signal<number>(0);
  public visibilityRevision = signal<number>(0);

  constructor() {
     const eventBus = inject(GameEventBusService);
     eventBus.events$.subscribe(e => {
        if (e.type === 'RuntimeVisibilityBatchChanged') {
            this.notifyVisibilityChanged();
        }
     });
  }

  public notifyStructureChanged(): void { 
    this.structureRevision.update(v => v + 1); 
  }
  
  public notifyVisibilityChanged(): void { 
    this.visibilityRevision.update(v => v + 1); 
  }

  public toggleExpand(id: string): void {
    if (this.expandedNodes.has(id)) {
      this.expandedNodes.delete(id);
    } else {
      this.expandedNodes.add(id);
    }
  }

  public isExpanded(id: string): boolean { 
    return this.expandedNodes.has(id); 
  }

  public expand(id: string): void {
    this.expandedNodes.add(id);
  }

  public clear(): void {
    this.expandedNodes.clear();
    this.contextMenuOpen.set(false);
    this.draggedNode.set(null);
    this.dropAction.set(null);
  }
}