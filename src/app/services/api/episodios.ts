
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EpisodiosService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:4000/api'; 

  private getAuthHeaders() {
    const token = localStorage.getItem('token');
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });
  }

  obtenerEpisodios(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/episodes`, { headers: this.getAuthHeaders() });
  }

  obtenerEpisodio(id: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/episodes/${id}`, { headers: this.getAuthHeaders() });
  }

  crearEpisodio(title: string, description: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes`, { title, description }, { headers: this.getAuthHeaders() });
  }

  guardarMapa(id: number, mapData: { sceneObjectsDelta: any[], triggersDelta: any[], deletedObjects: string[], deletedTriggers: string[], worldSettings?: any, uiSettings?: any, title?: string, description?: string }): Observable<any> {
      return this.http.post<any>(`${this.baseUrl}/episodes/${id}/save-map`, mapData, { headers: this.getAuthHeaders() });
  }

  obtenerAssets(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/assets`, { headers: this.getAuthHeaders() });
  }

  subirAsset(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('assetFile', file);
    return this.http.post<any>(`${this.baseUrl}/assets/upload`, formData, { 
      headers: new HttpHeaders({ 'Authorization': `Bearer ${localStorage.getItem('token')}` }) 
    });
  }

  obtenerPrefabs(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/prefabs`, { headers: this.getAuthHeaders() });
  }

  crearPrefab(data: { name: string, type: string, assetId: number | null, properties: any }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/prefabs`, data, { headers: this.getAuthHeaders() });
  }

  eliminarPrefab(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/prefabs/${id}`, { headers: this.getAuthHeaders() });
  }

  cargarEstadoJugador(episodeId: number, slot: number = 1): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/episodes/${episodeId}/save-slots/${slot}`, { headers: this.getAuthHeaders() });
  }

  guardarEstadoJugador(episodeId: number, slot: number = 1, stateData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes/${episodeId}/save-slots/${slot}`, stateData, { headers: this.getAuthHeaders() });
  }
}