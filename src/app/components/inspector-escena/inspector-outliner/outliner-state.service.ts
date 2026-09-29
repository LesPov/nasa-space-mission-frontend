
import { Injectable, signal } from '@angular/core';
import { Node } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class OutlinerStateService {
  public draggedNode = signal<Node | null>(null);
  public dropAction = signal<'above' | 'below' | 'inside' | null>(null);
  public searchTerm = signal<string>('');

  public contextMenuOpen = signal<boolean>(false);
  public contextMenuPosition = signal<{x: number, y: number}>({x: 0, y: 0});
  public contextMenuNode = signal<Node | null>(null);

  public expandedNodes = new Set<string>();

  toggleExpand(id: string) {
    if (this.expandedNodes.has(id)) {
      this.expandedNodes.delete(id);
    } else {
      this.expandedNodes.add(id);
    }
  }

  isExpanded(id: string): boolean { 
    return this.expandedNodes.has(id); 
  }

  expand(id: string): void {
    this.expandedNodes.add(id);
  }

  clear(): void {
    this.expandedNodes.clear();
    this.contextMenuOpen.set(false);
    this.draggedNode.set(null);
    this.dropAction.set(null);
  }
}