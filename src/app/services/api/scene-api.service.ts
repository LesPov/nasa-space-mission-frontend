import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SceneSavePayload, SceneLoadPayload } from '../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class SceneApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/episodes`;

  obtenerPlataformasEscena(episodeId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/${episodeId}/scenes`);
  }

  crearPlataformaEscena(episodeId: number, name: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/${episodeId}/scenes`, { name });
  }

  obtenerEscenaCompleta(sceneId: number): Observable<SceneLoadPayload> {
    return this.http.get<SceneLoadPayload>(`${this.baseUrl}/scenes/${sceneId}`);
  }

  guardarMapaEscena(sceneId: number, mapData: SceneSavePayload): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/scenes/${sceneId}/save-map`, mapData);
  }
}