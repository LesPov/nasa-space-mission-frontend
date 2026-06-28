import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EpisodeApiService } from './episode-api.service';
import { SceneApiService } from './scene-api.service';
import { AssetApiService } from './asset-api.service';
import { PlayerStateApiService } from './player-state-api.service';
import { SceneSavePayload, SceneLoadPayload } from '../../core/engine/models/api-dto.model';

@Injectable({
  providedIn: 'root'
})
export class EpisodiosService {
  private episodeApi = inject(EpisodeApiService);
  private sceneApi = inject(SceneApiService);
  private assetApi = inject(AssetApiService);
  private playerStateApi = inject(PlayerStateApiService);

  obtenerEpisodios(): Observable<any[]> {
    return this.episodeApi.obtenerEpisodios();
  }

  crearEpisodio(title: string, description: string): Observable<any> {
    return this.episodeApi.crearEpisodio(title, description);
  }

  obtenerPlataformasEscena(episodeId: number): Observable<any[]> {
    return this.sceneApi.obtenerPlataformasEscena(episodeId);
  }

  crearPlataformaEscena(episodeId: number, name: string): Observable<any> {
    return this.sceneApi.crearPlataformaEscena(episodeId, name);
  }

  obtenerEscenaCompleta(sceneId: number): Observable<SceneLoadPayload> {
    return this.sceneApi.obtenerEscenaCompleta(sceneId);
  }

  guardarMapaEscena(sceneId: number, mapData: SceneSavePayload): Observable<any> {
    return this.sceneApi.guardarMapaEscena(sceneId, mapData);
  }

  obtenerAssets(): Observable<any[]> {
    return this.assetApi.obtenerAssets();
  }

  subirAsset(file: File): Observable<any> {
    return this.assetApi.subirAsset(file);
  }

  obtenerPrefabs(): Observable<any[]> {
    return this.assetApi.obtenerPrefabs();
  }

  crearPrefab(data: { name: string, type: string, assetId: number | null, properties: any }): Observable<any> {
    return this.assetApi.crearPrefab(data);
  }

  eliminarPrefab(id: number): Observable<any> {
    return this.assetApi.eliminarPrefab(id);
  }

  cargarEstadoJugador(episodeId: number, slot: number = 1): Observable<any> {
    return this.playerStateApi.cargarEstadoJugador(episodeId, slot);
  }

  guardarEstadoJugador(episodeId: number, slot: number = 1, stateData: any): Observable<any> {
    return this.playerStateApi.guardarEstadoJugador(episodeId, slot, stateData);
  }
}