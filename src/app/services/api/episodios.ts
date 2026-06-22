
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class EpisodiosService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api`; 

  obtenerEpisodios(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/episodes`);
  }

  crearEpisodio(title: string, description: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes`, { title, description });
  }

  obtenerPlataformasEscena(episodeId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/episodes/${episodeId}/scenes`);
  }

  crearPlataformaEscena(episodeId: number, name: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes/${episodeId}/scenes`, { name });
  }

  obtenerEscenaCompleta(sceneId: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/episodes/scenes/${sceneId}`);
  }

  guardarMapaEscena(sceneId: number, mapData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes/scenes/${sceneId}/save-map`, mapData);
  }

  obtenerAssets(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/assets`);
  }

  subirAsset(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('assetFile', file);
    return this.http.post<any>(`${this.baseUrl}/assets/upload`, formData);
  }

  obtenerPrefabs(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/prefabs`);
  }

  crearPrefab(data: { name: string, type: string, assetId: number | null, properties: any }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/prefabs`, data);
  }

  eliminarPrefab(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/prefabs/${id}`);
  }

  cargarEstadoJugador(episodeId: number, slot: number = 1): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/episodes/${episodeId}/save-slots/${slot}`);
  }

  guardarEstadoJugador(episodeId: number, slot: number = 1, stateData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes/${episodeId}/save-slots/${slot}`, stateData);
  }
}