import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../services/api/episodios';
import { Subscription } from 'rxjs';

export interface RadialItem {
  id: string;
  name: string;
  type: 'group' | 'asset' | 'action';
  icon: string;
  data?: any;
}

@Component({
  selector: 'app-ui-radial-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-radial-menu.html',
  styleUrls: ['./ui-radial-menu.css']
})
export class UiRadialMenu implements OnInit, OnDestroy {
  private eventBus = inject(GameEventBusService);
  private apiSvc = inject(EpisodiosService);
  private cdr = inject(ChangeDetectorRef);

  public isOpen = false;
  public hoveredItem: RadialItem | null = null;
  
  public currentItems: RadialItem[] = [];
  private navigationHistory: RadialItem[][] = [];
  private allAssetsLoaded = false;
  
  private sub!: Subscription;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(e => {
      if (e.type === 'RadialMenuToggled') {
        this.isOpen = e.payload;
        if (this.isOpen) {
            this.hoveredItem = null;
            if (!this.allAssetsLoaded) {
                this.fetchAssetsAndBuildMenu();
            } else {
                this.navigationHistory = [];
                this.buildRootMenu(this.lastFetchedAssets);
            }
        }
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  private lastFetchedAssets: any[] = [];

  private fetchAssetsAndBuildMenu() {
    this.apiSvc.obtenerAssets().subscribe({
      next: (assets) => {
         this.lastFetchedAssets = assets.filter(a => a.type === 'model_glb');
         this.allAssetsLoaded = true;
         this.buildRootMenu(this.lastFetchedAssets);
      },
      error: (err) => {
         console.error('[RadialMenu] Error cargando assets:', err);
         this.buildRootMenu([]);
      }
    });
  }

  private buildRootMenu(modelAssets: any[]) {
    const rootItems: RadialItem[] = [];

    rootItems.push({
      id: 'grp_prim', name: 'Formas Básicas', type: 'group', icon: '🔺',
      data: [
        { id: 'prim_1', name: 'Cubo', type: 'asset', icon: '🧊', data: { type: 'cube', path: null } },
        { id: 'prim_2', name: 'Esfera', type: 'asset', icon: '⚽', data: { type: 'sphere', path: null } },
        { id: 'prim_3', name: 'Cilindro', type: 'asset', icon: '🛢️', data: { type: 'cylinder', path: null } },
        { id: 'prim_4', name: 'Plano (Suelo)', type: 'asset', icon: '🗺️', data: { type: 'plane', path: null } }
      ]
    });

    const chunkSize = 7;
    for (let i = 0; i < modelAssets.length; i += chunkSize) {
      const chunk = modelAssets.slice(i, i + chunkSize);
      
      const chunkItems: RadialItem[] = chunk.map(m => ({
        id: m.id.toString(), 
        name: this.cleanName(m.name), 
        type: 'asset', 
        icon: '📦', 
        data: { id: m.id, name: m.name, type: 'model', path: m.path }
      }));

      rootItems.push({
        id: `grp_mod_${i}`, 
        name: `Modelos 3D (${i + 1}-${i + chunk.length})`, 
        type: 'group', 
        icon: '🏙️', 
        data: chunkItems
      });
    }

    this.currentItems = rootItems;
    this.cdr.detectChanges();
  }

  private cleanName(name: string): string {
    return name.replace(/\.(glb|gltf|obj)$/i, '').substring(0, 15);
  }

  public getItemTransform(index: number): string {
    const total = this.currentItems.length;
    const angle = (360 / total) * index;
    const offsetAngle = angle - 90;
    return `rotate(${offsetAngle}deg) translate(200px)`;
  }

  public getInverseRotation(index: number): string {
    const total = this.currentItems.length;
    const angle = (360 / total) * index;
    const offsetAngle = angle - 90;
    return `rotate(${-offsetAngle}deg)`;
  }

  public handleOverlayClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    // Solo cerrar si el clic fue directamente en el overlay oscuro o con click derecho
    if (event.type === 'contextmenu' || (event.target as HTMLElement).classList.contains('radial-overlay')) {
       this.closeMenu();
    }
  }

  public closeMenu() {
    this.isOpen = false;
    this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
    this.cdr.detectChanges();
  }

  public handleItemClick(item: RadialItem, event?: MouseEvent) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        
        // Si es clic derecho sobre un item, cerramos el menú
        if (event.button === 2) {
           this.closeMenu();
           return;
        }
    }

    if (item.type === 'group') {
       this.navigationHistory.push(this.currentItems);
       const nextView = [...item.data];
       nextView.push({ id: 'action_back', name: 'Volver', type: 'action', icon: '🔙' });
       this.currentItems = nextView;
       this.hoveredItem = null;

    } else if (item.type === 'action' && item.id === 'action_back') {
       this.currentItems = this.navigationHistory.pop() || [];
       this.hoveredItem = null;

    } else if (item.type === 'asset') {
       this.selectAsset(item.data);
    }
  }

  private selectAsset(asset: any) {
    this.eventBus.emit({ type: 'AssetSelectedForBuild', payload: asset });
    this.closeMenu();
  }
}