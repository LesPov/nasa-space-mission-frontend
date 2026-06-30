
import { Injectable, computed, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { GameContextService } from '../core/engine/session/game-context.service';
 
@Injectable({
  providedIn: 'root'
})
export class EditorMapaService {
  private context = inject(GameContextService);

  // ==========================================
  // FACHADA DE ESTADO (COMPUTED READONLY)
  // ==========================================
  public episodioActualData = computed(() => this.context.activeEpisode());
  public escenaIdActiva = computed(() => this.context.activePlatformId());
  public escenaActualData = computed(() => this.context.activePlatformData());
  public plataformasEscena = computed(() => this.context.platforms());

  // ==========================================
  // SETTERS DELEGADOS AL CONTEXTO (SSOT)
  // ==========================================
  public setEpisodioActualData(data: any): void { this.context.setActiveEpisode(data); }
  public setEscenaIdActiva(id: number | null): void { this.context.setActivePlatformId(id); }
  public setEscenaActualData(data: any): void { this.context.setActivePlatformData(data); }
  public setPlataformasEscena(plats: any[]): void { this.context.setPlatforms(plats); }

  // Eventos Globales del Mapa
  public onMapChanged = new Subject<void>();
  public onGizmoDrag = new Subject<void>();
  public onRequestPlatformChange = new Subject<number>();

  public limpiarEstado(): void {
    this.context.setActiveEpisode(null);
    this.context.setActivePlatformId(null);
    this.context.setActivePlatformData(null);
    this.context.setPlatforms([]);
  }
}