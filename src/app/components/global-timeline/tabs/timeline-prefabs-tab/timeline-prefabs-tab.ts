
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../../../services/api/episodios';
import { GameEventBusService } from '../../../../core/engine/events/game-event-bus.service';

export interface LibraryItem {
  id: number | undefined;
  uid: string;
  name: string;
  type: string;
  displayType: string;
  icon: string;
  thumbnailUrl: string | null;
  data: any; 
}

export interface CategoryTree {
  name: string;
  items: LibraryItem[];
}

export interface CollectionTree {
  name: string;
  categories: CategoryTree[];
}

export interface LibraryTree {
  name: string;
  collections: CollectionTree[];
}

@Component({
  selector: 'app-timeline-prefabs-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-prefabs-tab.html',
  styleUrls: ['./timeline-prefabs-tab.css']
})
export class TimelinePrefabsTab implements OnInit {
  private apiSvc = inject(EpisodiosService);
  private eventBus = inject(GameEventBusService);
  private cdr = inject(ChangeDetectorRef);

  public libraries: LibraryTree[] = [];
  public activeLibraryName: string = '';
  public activeCollectionName: string = '';
  public activeCategoryName: string = '';
  
  public selectedItem: LibraryItem | null = null;
  
  public searchQuery = '';
  public isSearching = false;
  public filteredItems: LibraryItem[] = [];

  private lastFetchedAssets: any[] = [];

  get activeLibrary() { return this.libraries.find(l => l.name === this.activeLibraryName); }
  get activeCollection() { return this.activeLibrary?.collections.find(c => c.name === this.activeCollectionName); }
  get activeCategory() { return this.activeCollection?.categories.find(c => c.name === this.activeCategoryName); }

  get displayItems(): LibraryItem[] {
    if (this.isSearching) return this.filteredItems;
    return this.activeCategory?.items || [];
  }

  ngOnInit() {
    this.fetchAssetsAndBuildTree();
  }

  private fetchAssetsAndBuildTree() {
    this.apiSvc.obtenerPrefabs().subscribe({
      next: (prefabs) => {
         const syntheticPrefabs = [
           { isPrefab: true, name: 'Cubo Básico', type: 'cube', properties: { library: 'Core Primitives', collection: 'Geometry', category: 'Basic Shapes' } },
           { isPrefab: true, name: 'Esfera', type: 'sphere', properties: { library: 'Core Primitives', collection: 'Geometry', category: 'Basic Shapes' } },
           { isPrefab: true, name: 'Cilindro', type: 'cylinder', properties: { library: 'Core Primitives', collection: 'Geometry', category: 'Basic Shapes' } },
           { isPrefab: true, name: 'Plano Suelo', type: 'plane', properties: { library: 'Core Primitives', collection: 'Geometry', category: 'Basic Shapes' } },
           { isPrefab: true, name: 'Luz Direccional', type: 'light_directional', properties: { library: 'Core Primitives', collection: 'Systems', category: 'Lighting' } },
           { isPrefab: true, name: 'Luz Focal', type: 'light_spot', properties: { library: 'Core Primitives', collection: 'Systems', category: 'Lighting' } },
           { isPrefab: true, name: 'Luz Omnidireccional', type: 'light_point', properties: { library: 'Core Primitives', collection: 'Systems', category: 'Lighting' } },
           { isPrefab: true, name: 'Trigger Normal', type: 'trigger', properties: { library: 'Core Primitives', collection: 'Systems', category: 'Logic' } },
           { isPrefab: true, name: 'Trigger Compuesto', type: 'trigger_compuesto', properties: { library: 'Core Primitives', collection: 'Systems', category: 'Logic' } }
         ];
         this.lastFetchedAssets = [...syntheticPrefabs, ...prefabs];
         this.buildLibraryTree(this.lastFetchedAssets);
      },
      error: (err) => {
         console.error('Error cargando prefabs:', err);
      }
    });
  }

  private getDisplayType(p: any): string {
     const props = p.properties || {};
     if (props.rol === 'player') return 'PLAYER';
     if (props.characterConfig) return 'CHARACTER';
     if (p.type.startsWith('light_')) return 'LIGHT';
     if (p.type === 'trigger' || p.type === 'trigger_compuesto') return 'TRIGGER';
     if (p.type === 'model') return '3D OBJECT';
     return 'GEOMETRY';
  }

  private getIconForType(type: string): string {
    switch (type) {
      case 'cube': return '🧊'; case 'sphere': return '⚽'; case 'cylinder': return '🛢️'; case 'plane': return '🗺️';
      case 'model': return '📦'; case 'light_directional': return '☀️'; case 'light_spot': return '🔦';
      case 'light_point': return '💡'; case 'trigger': return '📍'; case 'trigger_compuesto': return '💠';
      case 'bubble': return '🫧'; case 'video_plane': return '📺'; case 'image_plane': return '🖼️';
      default: return '📄';
    }
  }

  private buildLibraryTree(rawAssets: any[]) {
    const libMap = new Map<string, Map<string, Map<string, LibraryItem[]>>>();

    rawAssets.forEach(p => {
      const props = p.properties || {};
      const lib = props.library || 'General';
      const coll = props.collection || 'Uncategorized';
      const cat = props.category || 'Misc';
      
      const item: LibraryItem = {
        id: p.id,
        uid: p.uid || (p.id ? p.id.toString() : Math.random().toString(36).substring(2, 9)),
        name: p.name || 'Desconocido',
        type: p.type,
        displayType: this.getDisplayType(p),
        icon: this.getIconForType(p.type),
        thumbnailUrl: props.thumbnailUrl || (p.asset?.type?.startsWith('image') ? p.asset.path : null),
        data: p
      };

      if (!libMap.has(lib)) libMap.set(lib, new Map());
      const collMap = libMap.get(lib)!;
      if (!collMap.has(coll)) collMap.set(coll, new Map());
      const catMap = collMap.get(coll)!;
      if (!catMap.has(cat)) catMap.set(cat, []);
      
      catMap.get(cat)!.push(item);
    });

    this.libraries = Array.from(libMap.entries()).map(([libName, collMap]) => ({
      name: libName,
      collections: Array.from(collMap.entries()).map(([collName, catMap]) => ({
          name: collName,
          categories: Array.from(catMap.entries()).map(([catName, items]) => ({
              name: catName,
              items: items.sort((a, b) => a.name.localeCompare(b.name))
          })).sort((a, b) => a.name.localeCompare(b.name))
      })).sort((a, b) => a.name.localeCompare(b.name))
    })).sort((a, b) => a.name.localeCompare(b.name));

    if (this.libraries.length > 0) {
        this.activeLibraryName = this.libraries[0].name;
        this.onLibraryChange();
    }
    this.cdr.detectChanges();
  }

  public onLibraryChange() {
    if (this.activeLibrary && this.activeLibrary.collections.length > 0) {
       this.activeCollectionName = this.activeLibrary.collections[0].name;
       this.onCollectionChange();
    }
  }

  public onCollectionChange() {
    if (this.activeCollection && this.activeCollection.categories.length > 0) {
       this.activeCategoryName = this.activeCollection.categories[0].name;
       this.onCategoryChange();
    }
  }

  public onCategoryChange() {
    if (this.activeCategory && this.activeCategory.items.length > 0 && !this.selectedItem) {
        this.selectedItem = this.activeCategory.items[0];
    }
  }

  public selectItem(item: LibraryItem) {
    this.selectedItem = item;
  }

  public onSearchChange(event: any) {
    const query = event.target.value.toLowerCase().trim();
    this.searchQuery = query;

    if (query === '') {
      this.isSearching = false;
      return;
    }

    this.isSearching = true;
    const results: LibraryItem[] = [];
    
    this.libraries.forEach(lib => lib.collections.forEach(coll => coll.categories.forEach(cat => cat.items.forEach(item => {
        if (item.name.toLowerCase().includes(query) || item.displayType.toLowerCase().includes(query)) {
            results.push(item);
        }
    }))));

    this.filteredItems = results;
    if (results.length > 0 && !results.find(i => String(i.id) === String(this.selectedItem?.id))) {
      this.selectedItem = results[0];
    } else if (results.length === 0) {
      this.selectedItem = null;
    }
  }

  public placeItem() {
    if (!this.selectedItem) return;
    // 🔥 Dispara la colocación (Placement Mode) usando el sistema real
    this.eventBus.emit({ type: 'AssetSelectedForBuild', payload: this.selectedItem.data });
  }
}