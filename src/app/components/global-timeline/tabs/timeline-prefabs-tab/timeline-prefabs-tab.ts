// src/app/components/global-timeline/tabs/timeline-prefabs-tab/timeline-prefabs-tab.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../../../services/api/episodios';
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
  private eventBus = inject(GameEventBusService);

  public prefabs: any[] = [];
  public filteredPrefabs: any[] = [];
  public searchTerm = '';
  public cargando = false;

  ngOnInit() {
    this.loadPrefabs();
  }

  loadPrefabs() {
    this.cargando = true;
    this.apiSvc.obtenerPrefabs().subscribe({
      next: (res) => {
        // Mapeamos indicando explícitamente que es un prefab para el LiveBuilder
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
      return;
    }
    const term = this.searchTerm.toLowerCase();
    this.filteredPrefabs = this.prefabs.filter(p => p.name.toLowerCase().includes(term));
  }

  selectPrefab(prefab: any) {
    this.eventBus.emit({ type: 'AssetSelectedForBuild', payload: prefab });
  }
}