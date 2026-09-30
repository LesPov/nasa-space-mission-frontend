// src/app/services/api/episodios.ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EpisodeApiService } from './episode-api.service';
import { SceneApiService } from './scene-api.service';
import { AssetApiService } from './asset-api.service';
import { PlayerStateApiService } from './player-state-api.service';
import { 
  SceneSavePayload, SceneLoadPayload, NarrativeRoleDto, 
  MissionProfileDto, CreateMissionProfileDto 
} from '../../core/engine/models/api-dto.model';

@Injectable({
  providedIn: 'root'
})
export class EpisodiosService {
  private episodeApi = inject(EpisodeApiService);
  private sceneApi = inject(SceneApiService);
  private assetApi = inject(AssetApiService);
  private playerStateApi = inject(PlayerStateApiService);

  obtenerEpisodios(): Observable<any[]> { return this.episodeApi.obtenerEpisodios(); }
  crearEpisodio(title: string, description: string): Observable<any> { return this.episodeApi.crearEpisodio(title, description); }
  actualizarEpisodio(episodeId: number, data: { title: string, description?: string }): Observable<any> { return this.episodeApi.actualizarEpisodio(episodeId, data); }

  obtenerPlataformasEscena(episodeId: number): Observable<any[]> { return this.sceneApi.obtenerPlataformasEscena(episodeId); }
  crearPlataformaEscena(episodeId: number, name: string): Observable<any> { return this.sceneApi.crearPlataformaEscena(episodeId, name); }
  actualizarPlataformaEscena(sceneId: number, data: { name?: string }): Observable<any> { return this.sceneApi.actualizarPlataformaEscena(sceneId, data); }
  obtenerEscenaCompleta(sceneId: number): Observable<SceneLoadPayload> { return this.sceneApi.obtenerEscenaCompleta(sceneId); }
  guardarMapaEscena(sceneId: number, mapData: SceneSavePayload): Observable<any> { return this.sceneApi.guardarMapaEscena(sceneId, mapData); }

  obtenerAssets(): Observable<any[]> { return this.assetApi.obtenerAssets(); }
  subirAsset(file: File): Observable<any> { return this.assetApi.subirAsset(file); }
  obtenerPrefabs(): Observable<any[]> { return this.assetApi.obtenerPrefabs(); }
  crearPrefab(data: { name: string, type: string, assetId: number | null, properties: any }): Observable<any> { return this.assetApi.crearPrefab(data); }
  eliminarPrefab(id: number): Observable<any> { return this.assetApi.eliminarPrefab(id); }
  
  // 🔥 NUEVO: Pasarela del servicio Episodios
  actualizarPrefab(id: number, data: { name: string, type: string, assetId: number | null, properties: any }): Observable<any> {
    return this.assetApi.actualizarPrefab(id, data);
  }

  cargarEstadoJugador(episodeId: number, slot: number = 1): Observable<any> { return this.playerStateApi.cargarEstadoJugador(episodeId, slot); }
  guardarEstadoJugador(episodeId: number, slot: number = 1, stateData: any): Observable<any> { return this.playerStateApi.guardarEstadoJugador(episodeId, slot, stateData); }

  obtenerRoles(episodeId: number): Observable<NarrativeRoleDto[]> { return this.episodeApi.obtenerRoles(episodeId); }
  crearRol(episodeId: number, roleData: NarrativeRoleDto): Observable<NarrativeRoleDto> { return this.episodeApi.crearRol(episodeId, roleData); }
  actualizarRol(roleId: number, roleData: Partial<NarrativeRoleDto>): Observable<NarrativeRoleDto> { return this.episodeApi.actualizarRol(roleId, roleData); }
  eliminarRol(roleId: number): Observable<any> { return this.episodeApi.eliminarRol(roleId); }

  obtenerMissionProfile(episodeId: number): Observable<MissionProfileDto> { return this.episodeApi.obtenerMissionProfile(episodeId); }
  crearMissionProfile(episodeId: number, profile: CreateMissionProfileDto): Observable<MissionProfileDto> { return this.episodeApi.crearMissionProfile(episodeId, profile); }
  actualizarMissionProfile(episodeId: number, profile: Partial<MissionProfileDto>): Observable<MissionProfileDto> { return this.episodeApi.actualizarMissionProfile(episodeId, profile); }
}