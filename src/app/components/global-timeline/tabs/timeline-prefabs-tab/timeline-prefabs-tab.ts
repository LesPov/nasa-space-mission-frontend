
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../../../services/api/episodios';
import { EditorSceneService } from '../../../../services/editor/editor-scene.service';
import { GameEventBusService } from '../../../../core/engine/events/game-event-bus.service';

@Component({
  selector: 'app-timeline-prefabs-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-prefabs-tab.html',
  styleUrls: ['./timeline-prefabs-tab.css']
})
export class TimelinePrefabsTab implements OnInit {
  private apiSvc = inject(EpisodiosService);
  private sceneSvc = inject(EditorSceneService);
  private eventBus = inject(GameEventBusService);

  public prefabs: any[] = [];
  public filteredPrefabs: any[] = [];
  public searchTerm = '';
  public cargando = false;
  
  public selectedPrefab: any = null;

  ngOnInit() {
    this.loadPrefabs();
  }

  loadPrefabs() {
    this.cargando = true;
    this.selectedPrefab = null;
    this.apiSvc.obtenerPrefabs().subscribe({
      next: (res) => {
        // Marcamos los datos como prefab para que el motor entienda cómo tratarlos
        this.prefabs = res.map(p => ({ ...p, isPrefab: true }));
        this.filterPrefabs();
        this.cargando = false;
      },
      error: (err) => {
        console.error('Error cargando prefabs:', err);
        this.cargando = false;
      }
    });
  }

  filterPrefabs() {
    if (!this.searchTerm.trim()) {
      this.filteredPrefabs = [...this.prefabs];
    } else {
      const term = this.searchTerm.toLowerCase();
      this.filteredPrefabs = this.prefabs.filter(p => p.name.toLowerCase().includes(term));
    }
    
    // Si filtramos y el seleccionado ya no está en la lista, lo deseleccionamos
    if (this.selectedPrefab && !this.filteredPrefabs.find(p => p.id === this.selectedPrefab.id)) {
        this.selectedPrefab = null;
    }
  }

  selectPrefab(prefab: any) {
    this.selectedPrefab = prefab;
  }

  instanciarEnEscena(prefab: any) {
    if (!prefab) return;
    // 🔥 Recuperamos la funcionalidad de interactividad enviando al Live Builder
    this.eventBus.emit({ type: 'AssetSelectedForBuild', payload: prefab });
  }

  eliminarPrefab(id: number) {
    if (confirm('¿Estás seguro de eliminar este Prefab de la base de datos? Esto no afectará a los objetos que ya pusiste en la escena.')) {
        this.apiSvc.eliminarPrefab(id).subscribe({
            next: () => {
                this.loadPrefabs();
            },
            error: (err) => alert('Error al eliminar el prefab.')
        });
    }
  }

  // Utilidad para extraer los badges o etiquetas en base al JSON del Prefab
  getResumen(prefab: any): string[] {
      if(!prefab || !prefab.properties) return [];
      
      // Si el prefab tiene jerarquía (múltiples mallas), analizamos la principal
      const root = prefab.properties.prefabHierarchy ? prefab.properties.prefabHierarchy[0] : prefab;
      const props = root.properties || {};
      
      const badges: string[] = [];
      
      if (props.rol === 'player') badges.push('🏃 Jugador Principal');
      if (props.characterConfig) badges.push('🤖 NPC / Personaje');
      if (props.light) badges.push('💡 Emisor de Luz');
      if (props.trigger || props.actionType) badges.push('📍 Trigger de Evento');
      if (props.media) badges.push('📺 Pantalla / Media');
      if (props.playerConfig?.sequences && props.playerConfig.sequences.length > 0) badges.push('🎬 Cinemática Interna');
      if (props.playerConfig?.fog?.enabled) badges.push('☁️ Sistema de Niebla');
      
      if (badges.length === 0) badges.push('🧊 Objeto Estático Simple');
      
      return badges;
  }
}