// src/app/components/ui-radial-menu/ui-radial-menu.ts
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../services/api/episodios';
import { Subscription } from 'rxjs';
import { Engine, Scene, ArcRotateCamera, HemisphericLight, Vector3, Color4, SceneLoader, Tools, MeshBuilder, AbstractMesh, Mesh, StandardMaterial, Color3 } from '@babylonjs/core';

export interface LibraryItem {
  id: number | undefined;
  uid: string;
  name: string;
  type: string;
  displayType: string;
  icon: string;
  thumbnailUrl: string | null;
  description: string;
  tags: string[];
  library: string;
  collection: string;
  category: string;
  data: any; 
}

export interface CategoryTree {
  name: string;
  items: LibraryItem[];
}

export interface CollectionTree {
  name: string;
  expanded: boolean;
  categories: CategoryTree[];
}

export interface LibraryTree {
  name: string;
  expanded: boolean;
  collections: CollectionTree[];
}

@Component({
  selector: 'app-ui-radial-menu',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-radial-menu.html',
  styleUrls: ['./ui-radial-menu.css']
})
export class UiRadialMenu implements OnInit, OnDestroy {
  private eventBus = inject(GameEventBusService);
  private apiSvc = inject(EpisodiosService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('previewCanvas', { static: false }) previewCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('detailsPreviewArea', { static: false }) detailsPreviewElement?: ElementRef<HTMLElement>;

  public isOpen = false;
  
  // Jerarquía Dinámica
  public libraries: LibraryTree[] = [];
  public activeLibraryName: string = '';
  public activeCollectionName: string = '';
  public activeCategory: CategoryTree | null = null;
  
  public selectedItem: LibraryItem | null = null;
  
  // Búsqueda Global
  public searchQuery: string = '';
  public filteredItems: LibraryItem[] = [];
  public isSearching: boolean = false;

  // Edición
  public isEditing = false;
  public isSaving = false;
  public isGeneratingThumb = false;
  public editForm: any = {};
  public allLibraries: string[] = [];
  public allCollections: string[] = [];
  public allCategories: string[] = [];

  private allAssetsLoaded = false;
  private lastFetchedAssets: any[] = [];
  private sub!: Subscription;

  // Motor de Previsualización (0-Leaks)
  private previewEngine: Engine | null = null;
  private previewScene: Scene | null = null;
  private previewCamera: ArcRotateCamera | null = null;
  public isPreviewActive = false;
  private isRenderLoopRunning = false;
  private previewMeshes: AbstractMesh[] = [];
  private currentPreviewItemId: number | string | null = null;
  private loadSequence = 0;
  
  public hoveredItem: LibraryItem | null = null;
  public hoveredElement: HTMLElement | null = null;

  public resetBtnStyle: any = { display: 'none', top: '0px', left: '0px' };
  
  // Almacenamiento del encuadre óptimo (Auto-Fit)
  private originalCameraTarget: Vector3 = Vector3.Zero();
  private originalCameraRadius: number = 5;
  private originalCameraMinZ: number = 0.01;
  private originalCameraMaxZ: number = 1000;
  private originalWheelPrecision: number = 50;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(e => {
      if (e.type === 'RadialMenuToggled') {
        this.isOpen = e.payload;
        if (this.isOpen) {
            this.searchQuery = '';
            this.isSearching = false;
            this.isEditing = false;
            
            if (!this.allAssetsLoaded) {
                this.fetchAssetsAndBuildMenu();
            } else {
                this.buildLibraryTree(this.lastFetchedAssets);
            }
            
            setTimeout(() => this.initPreviewEngine(), 100);
        } else {
            this.disposePreviewEngine();
        }
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    this.disposePreviewEngine();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.isOpen) {
      if (event.key === 'Escape') {
        if (this.isEditing) {
           this.isEditing = false;
           setTimeout(() => this.updateCanvasPosition(), 0);
        } else {
           this.closeMenu();
        }
      }
    }
  }

  // Evento de Scroll del Grid para reposicionar el Hover
  onGridScroll() {
     if (this.hoveredItem && this.hoveredElement) {
         this.updateCanvasPosition();
     }
  }

  private fetchAssetsAndBuildMenu() {
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
         this.allAssetsLoaded = true;
         this.buildLibraryTree(this.lastFetchedAssets);
      },
      error: (err) => {
         console.error('[BuildLibrary] Error cargando prefabs:', err);
         this.buildLibraryTree([]);
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
    const lSet = new Set<string>(); const colSet = new Set<string>(); const catSet = new Set<string>();

    rawAssets.forEach(p => {
      const props = p.properties || {};
      const lib = props.library || 'General';
      const coll = props.collection || 'Uncategorized';
      const cat = props.category || 'Misc';
      
      lSet.add(lib); colSet.add(coll); catSet.add(cat);
      
      const item: LibraryItem = {
        id: p.id,
        uid: p.uid || (p.id ? p.id.toString() : Math.random().toString(36).substring(2, 9)),
        name: p.name || 'Desconocido',
        type: p.type,
        displayType: this.getDisplayType(p),
        icon: this.getIconForType(p.type),
        thumbnailUrl: props.thumbnailUrl || (p.asset?.type?.startsWith('image') ? p.asset.path : null),
        description: props.description || '',
        tags: props.tags || [],
        library: lib, collection: coll, category: cat,
        data: p
      };

      if (!libMap.has(lib)) libMap.set(lib, new Map());
      const collMap = libMap.get(lib)!;
      if (!collMap.has(coll)) collMap.set(coll, new Map());
      const catMap = collMap.get(coll)!;
      if (!catMap.has(cat)) catMap.set(cat, []);
      
      catMap.get(cat)!.push(item);
    });

    this.allLibraries = Array.from(lSet).sort();
    this.allCollections = Array.from(colSet).sort();
    this.allCategories = Array.from(catSet).sort();

    this.libraries = Array.from(libMap.entries()).map(([libName, collMap]) => ({
      name: libName,
      expanded: true,
      collections: Array.from(collMap.entries()).map(([collName, catMap]) => ({
          name: collName,
          expanded: true,
          categories: Array.from(catMap.entries()).map(([catName, items]) => ({
              name: catName,
              items: items.sort((a, b) => a.name.localeCompare(b.name))
          })).sort((a, b) => a.name.localeCompare(b.name))
      })).sort((a, b) => a.name.localeCompare(b.name))
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Restaurar la referencia de activeCategory al nuevo árbol generado
    if (this.activeCategory && this.activeLibraryName && this.activeCollectionName) {
        const newLib = this.libraries.find(l => l.name === this.activeLibraryName);
        if (newLib) {
            const newCol = newLib.collections.find(c => c.name === this.activeCollectionName);
            if (newCol) {
                const newCat = newCol.categories.find(c => c.name === this.activeCategory!.name);
                if (newCat) {
                    this.activeCategory = newCat;
                }
            }
        }
    }

    if (!this.selectedItem && this.libraries.length > 0 && this.libraries[0].collections.length > 0 && this.libraries[0].collections[0].categories.length > 0) {
        const firstCat = this.libraries[0].collections[0].categories[0];
        this.selectCategory(firstCat, this.libraries[0].name, this.libraries[0].collections[0].name);
    } else if (this.selectedItem) {
        const fresh = this.activeCategory?.items.find(i => String(i.id) === String(this.selectedItem!.id));
        if (fresh) this.selectedItem = fresh;
    }
    
    setTimeout(() => {
        this.updateCanvasPosition();
    }, 0);
  }

  // --- INTERACCIÓN UI ---

  public selectCategory(cat: CategoryTree, libName?: string, collName?: string) {
    this.activeCategory = cat;
    if (libName) this.activeLibraryName = libName;
    if (collName) this.activeCollectionName = collName;
    
    this.isSearching = false;
    this.searchQuery = '';
    this.isEditing = false;
    
    if (cat.items.length > 0 && !this.selectedItem) {
      this.selectedItem = cat.items[0];
    } else if (this.selectedItem && !cat.items.find(i => String(i.id) === String(this.selectedItem?.id))) {
      this.selectedItem = cat.items[0] || null;
    }
    setTimeout(() => this.updateCanvasPosition(), 0);
  }

  public selectItem(item: LibraryItem) {
    this.selectedItem = item;
    this.isEditing = false;
    setTimeout(() => this.updateCanvasPosition(), 10);
  }

  public onSearchChange(event: any) {
    const query = event.target.value.toLowerCase().trim();
    this.searchQuery = query;

    if (query === '') {
      this.isSearching = false;
      if (this.libraries.length > 0) this.selectCategory(this.libraries[0].collections[0].categories[0], this.libraries[0].name, this.libraries[0].collections[0].name);
      return;
    }

    this.isSearching = true;
    this.activeCategory = null;
    this.isEditing = false;

    const results: LibraryItem[] = [];
    this.libraries.forEach(lib => lib.collections.forEach(coll => coll.categories.forEach(cat => cat.items.forEach(item => {
        if (item.name.toLowerCase().includes(query) || item.displayType.toLowerCase().includes(query) || item.tags.some(t => t.toLowerCase().includes(query))) {
            results.push(item);
        }
    }))));

    this.filteredItems = results;
    if (results.length > 0 && !results.find(i => String(i.id) === String(this.selectedItem?.id))) {
      this.selectedItem = results[0];
    } else if (results.length === 0) {
      this.selectedItem = null;
    }
    setTimeout(() => this.updateCanvasPosition(), 0);
  }

  get canEdit() { return this.selectedItem && typeof this.selectedItem.id === 'number'; }

  public openEditForm() {
    if (!this.canEdit) return;
    this.editForm = {
        name: this.selectedItem!.name, type: this.selectedItem!.type,
        library: this.selectedItem!.library, collection: this.selectedItem!.collection, category: this.selectedItem!.category,
        description: this.selectedItem!.description, tags: this.selectedItem!.tags.join(', '),
        thumbnailUrl: this.selectedItem!.thumbnailUrl || ''
    };
    this.isEditing = true;
    setTimeout(() => this.updateCanvasPosition(), 0); 
  }

  public savePrefab() {
    this.isSaving = true;
    const item = this.selectedItem!;
    const updatedProps = {
        ...item.data.properties,
        library: this.editForm.library, collection: this.editForm.collection, category: this.editForm.category,
        description: this.editForm.description, tags: this.editForm.tags.split(',').map((t:string) => t.trim()).filter(Boolean),
        thumbnailUrl: this.editForm.thumbnailUrl
    };

    const payload = {
        name: this.editForm.name, type: this.editForm.type,
        assetId: item.data.assetId, properties: updatedProps
    };

    this.apiSvc.actualizarPrefab(item.id!, payload).subscribe({
        next: (res) => {
            this.isSaving = false; this.isEditing = false;
            const idx = this.lastFetchedAssets.findIndex(a => String(a.id) === String(item.id));
            if (idx !== -1) {
                this.lastFetchedAssets[idx] = res;
            }
            this.activeLibraryName = this.editForm.library;
            this.activeCollectionName = this.editForm.collection;
            const targetCatName = this.editForm.category;

            this.buildLibraryTree(this.lastFetchedAssets);
            
            const lib = this.libraries.find(l => l.name === this.activeLibraryName);
            if (lib) {
                lib.expanded = true;
                const col = lib.collections.find(c => c.name === this.activeCollectionName);
                if (col) {
                    col.expanded = true;
                    const cat = col.categories.find(c => c.name === targetCatName);
                    if (cat) {
                        this.selectCategory(cat, lib.name, col.name);
                        const newItem = cat.items.find(i => String(i.id) === String(item.id));
                        if (newItem) this.selectItem(newItem);
                    }
                }
            }
        },
        error: (err) => { this.isSaving = false; alert('Error guardando el prefab'); }
    });
  }

  public deletePrefab(item: LibraryItem) {
    if (!item.id) return;
    if (confirm(`¿Estás seguro de eliminar el prefab "${item.name}"?\nEsta acción es irreversible y eliminará el prefab de la base de datos.`)) {
       this.apiSvc.eliminarPrefab(item.id).subscribe({
          next: () => {
             this.lastFetchedAssets = this.lastFetchedAssets.filter(a => String(a.id) !== String(item.id));
             this.selectedItem = null;
             this.buildLibraryTree(this.lastFetchedAssets);
          },
          error: () => alert('Error al eliminar el prefab.')
       });
    }
  }

  // --- MOTOR PREVISUALIZADOR 3D FLOTANTE (0 Leaks / Auto-Fit) ---

  private initPreviewEngine() {
    if (this.previewEngine) return;
    const canvas = this.previewCanvas.nativeElement;
    this.previewEngine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.previewScene = new Scene(this.previewEngine);
    this.previewScene.clearColor = new Color4(0, 0, 0, 0); 
    
    this.previewScene.createDefaultEnvironment({ createSkybox: false, createGround: false, enableGroundShadow: false });

    // Instancia de cámara base, se ajustará sola por cada modelo
    this.previewCamera = new ArcRotateCamera("prevCam", Math.PI/4, Math.PI/3, 5, Vector3.Zero(), this.previewScene);

    const light = new HemisphericLight("prevLight", new Vector3(0, 1, 0), this.previewScene);
    light.intensity = 1.5;

    this.updateCanvasPosition();
  }

  private disposePreviewEngine() {
    if (this.previewEngine) {
        this.previewEngine.stopRenderLoop();
        this.previewScene?.dispose();
        this.previewEngine.dispose();
        this.previewEngine = null;
        this.previewScene = null;
        this.previewCamera = null;
    }
    this.isPreviewActive = false;
    this.isRenderLoopRunning = false;
    this.currentPreviewItemId = null;
  }

  private renderLoop = () => {
    // Rotación sutil y continua si el ratón está en hover de card
    if (this.hoveredItem && this.previewCamera) {
       this.previewCamera.alpha += 0.005;
    }
    if (this.previewScene) this.previewScene.render();
  }

  public onCardEnter(item: LibraryItem, event: MouseEvent) {
    if (this.isEditing) return;
    this.hoveredItem = item;
    this.hoveredElement = event.currentTarget as HTMLElement;
    this.updateCanvasPosition();
  }

  public onCardLeave() {
    this.hoveredItem = null;
    this.hoveredElement = null;
    this.updateCanvasPosition();
  }

  private updateCanvasPosition() {
    if (!this.previewCanvas) return;
    const canvas = this.previewCanvas.nativeElement;
    let targetEl: HTMLElement | null = null;
    
    let isHover = false;

    if (this.hoveredElement) {
        targetEl = this.hoveredElement.querySelector('.card-preview') as HTMLElement;
        isHover = true;
    } else if (this.selectedItem && this.detailsPreviewElement && !this.isEditing) {
        targetEl = this.detailsPreviewElement.nativeElement;
        isHover = false;
    }
    
    if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        
        // Match exacto sobre el contenedor de destino
        canvas.style.display = 'block';
        canvas.style.top = rect.top + 'px';
        canvas.style.left = rect.left + 'px';
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        
        // INTERACTIVITY ISOLATION:
        if (isHover) {
            // Permite que la rueda del ratón siga haciendo scroll sobre el Grid de cards
            canvas.style.pointerEvents = 'none';
            if (this.previewCamera) {
                this.previewCamera.detachControl();
            }
            this.resetBtnStyle = { display: 'none', top: '0px', left: '0px' };
        } else {
            // Permite rotar y hacer zoom SOLO al canvas, sin afectar lo de atrás
            canvas.style.pointerEvents = 'auto';
            if (this.previewCamera) {
                this.previewCamera.attachControl(canvas, true);
            }
            this.resetBtnStyle = {
                display: 'block',
                top: (rect.bottom - 36) + 'px',
                left: (rect.right - 95) + 'px'
            };
        }

        // Encendemos flags
        this.isPreviewActive = true;
        
        if (this.previewEngine) this.previewEngine.resize();
        
        if (!this.isRenderLoopRunning && this.previewEngine) {
            this.previewEngine.runRenderLoop(this.renderLoop);
            this.isRenderLoopRunning = true;
        }

        // Cargamos o reutilizamos el modelo activo
        const targetItem = this.hoveredItem || this.selectedItem;
        if (targetItem) this.loadPreviewModel(targetItem);

    } else {
        // Ocultar limpiamente
        canvas.style.pointerEvents = 'none';
        this.resetBtnStyle = { display: 'none', top: '0px', left: '0px' };
        if (this.previewCamera) this.previewCamera.detachControl();
        
        this.isPreviewActive = false;
        if (this.isRenderLoopRunning && this.previewEngine) {
            this.previewEngine.stopRenderLoop();
            this.isRenderLoopRunning = false;
        }
    }
  }

  public resetPreviewCamera() {
      if (this.previewCamera) {
          this.previewCamera.setTarget(this.originalCameraTarget);
          this.previewCamera.radius = this.originalCameraRadius;
          
          this.previewCamera.minZ = this.originalCameraMinZ;
          this.previewCamera.maxZ = this.originalCameraMaxZ;
          this.previewCamera.wheelPrecision = this.originalWheelPrecision;

          // Ángulo isométrico clásico para reset
          this.previewCamera.alpha = Math.PI / 4;
          this.previewCamera.beta = Math.PI / 3;
      }
  }

  private async loadPreviewModel(item: LibraryItem) {
    const seq = ++this.loadSequence;
    if (this.currentPreviewItemId === item.uid) return;
    this.currentPreviewItemId = item.uid;
    
    // 🔥 Limpiamos memoria 3D inmediata sin matar la Scene entera
    this.previewMeshes.forEach(m => m.dispose(false, true));
    this.previewMeshes = [];
    if (!this.previewScene) return;

    const type = item.type;
    const isModel = type === 'model' || type.startsWith('light_') || type === 'player' || type === 'character';
    const path = item.data.properties?.path || item.data.asset?.path;

    if (isModel && path) {
        try {
            const res = await SceneLoader.ImportMeshAsync("", "http://localhost:4000" + path, "", this.previewScene);
            if (seq !== this.loadSequence) { res.meshes.forEach(m => m.dispose(false, true)); return; }
            this.previewMeshes = res.meshes as AbstractMesh[];
            res.animationGroups.forEach(ag => { ag.stop(); ag.dispose(); }); 
            
            // Garantizar visibilidad base sin oscuridad absoluta en materiales estándar
            this.previewMeshes.forEach(m => {
               if (m.material && m.material.getClassName() === 'StandardMaterial') {
                   (m.material as any).specularColor = new Color3(0,0,0);
               }
            });
        } catch(e) {}
    } else {
        // Fallback Primitivas
        let m: Mesh;
        switch(type) {
            case 'sphere': m = MeshBuilder.CreateSphere('p', {diameter:1}, this.previewScene); break;
            case 'cylinder': m = MeshBuilder.CreateCylinder('p', {height:1, diameter:1}, this.previewScene); break;
            case 'plane': case 'video_plane': case 'image_plane': m = MeshBuilder.CreatePlane('p', {size:1}, this.previewScene); break;
            case 'light_directional': 
            case 'light_spot': 
            case 'light_point':
                m = MeshBuilder.CreateSphere('p', {diameter:0.4}, this.previewScene); 
                const mat = new StandardMaterial('lightMat', this.previewScene);
                mat.emissiveColor = new Color3(1, 1, 0.8);
                mat.disableLighting = true;
                m.material = mat;
                break;
            default: m = MeshBuilder.CreateBox('p', {size:1}, this.previewScene); break;
        }
        this.previewMeshes.push(m);
    }
    
    // 🔥 AUTO-FIT MATEMÁTICO: Calcula el tamaño real y ajusta la cámara perfecto
    if (this.previewMeshes.length > 0 && this.previewCamera) {
        let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        let max = new Vector3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);
        let valid = false;
        
        this.previewMeshes.forEach(m => {
            if (m instanceof Mesh && m.getTotalVertices() > 0) {
                m.computeWorldMatrix(true);
                const b = m.getBoundingInfo().boundingBox;
                min = Vector3.Minimize(min, b.minimumWorld);
                max = Vector3.Maximize(max, b.maximumWorld);
                valid = true;
            }
        });

        if (valid) {
            const center = max.add(min).scale(0.5);
            const sizeVec = max.subtract(min);
            const maxDimension = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);

            this.originalCameraTarget = center.clone();
            
            // Fórmula trigonométrica de encuadre según Field of View (Factor 1.15 da buen padding)
            const fov = this.previewCamera.fov;
            const framingFactor = 1.15; 
            let radius = (maxDimension / 2) / Math.tan(fov / 2) * framingFactor;
            
            // Evitar que mallas largas y delgadas queden fuera de foco
            radius = Math.max(radius, sizeVec.z);
            radius = Math.max(0.05, radius); 

            this.originalCameraRadius = radius;

            // Ajuste Inteligente Anti-Clipping
            this.originalCameraMinZ = Math.min(0.01, maxDimension * 0.01);
            this.originalCameraMaxZ = Math.max(1000, maxDimension * 100);
            
            // Permite al usuario acercarse hasta rozar el centro
            this.previewCamera.lowerRadiusLimit = maxDimension * 0.05; 
            
            // Sensibilidad de rueda adaptable: modelos grandes = zoom rápido. Pequeños = zoom quirúrgico.
            this.originalWheelPrecision = Math.max(1, 50 / radius);
            this.previewCamera.panningSensibility = Math.max(1, 1000 / radius);

            // Aplicar Todo
            this.resetPreviewCamera();
        }
    }
  }

  public async generateThumbnail() {
      this.isGeneratingThumb = true;
      if (!this.selectedItem || !this.previewEngine || !this.previewCamera) {
          this.isGeneratingThumb = false; return;
      }
      
      await this.loadPreviewModel(this.selectedItem);

      Tools.CreateScreenshotUsingRenderTarget(this.previewEngine, this.previewCamera, { width: 512, height: 512 }, async (dataUrl) => {
          try {
              const res = await fetch(dataUrl);
              const blob = await res.blob();
              const file = new File([blob], `thumb_${Date.now()}.png`, { type: 'image/png' });
              
              this.apiSvc.subirAsset(file).subscribe({
                  next: (assetRes) => {
                      this.editForm.thumbnailUrl = assetRes.path; 
                      this.isGeneratingThumb = false;
                      this.cdr.detectChanges();
                  },
                  error: () => { this.isGeneratingThumb = false; this.cdr.detectChanges(); }
              });
          } catch(e) {
              this.isGeneratingThumb = false; this.cdr.detectChanges();
          }
      });
  }

  // --- CORE ACTIONS ---

  public handleOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('library-overlay')) {
       this.closeMenu();
    }
  }

  public closeMenu() {
    this.isOpen = false;
    this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
    this.disposePreviewEngine();
    this.cdr.detectChanges();
  }

  public equipSelectedItem() {
    if (!this.selectedItem) return;
    this.eventBus.emit({ type: 'AssetSelectedForBuild', payload: this.selectedItem.data });
    this.closeMenu(); 
  }
}