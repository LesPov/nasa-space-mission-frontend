import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/episodes`;

  // Este servicio quedó por compatibilidad legacy. 
  // Usa EpisodiosService en src/app/services/api/episodios.ts en su lugar para la nueva arquitectura.

  getEpisodes() {
    return this.http.get<any[]>(this.baseUrl);
  }

  createEpisode(title: string, description: string) {
    return this.http.post<any>(this.baseUrl, { title, description });
  }

  getSceneData(sceneId: number) {
    return this.http.get<any>(`${this.baseUrl}/scenes/${sceneId}`);
  }

  saveFullMap(sceneId: number, sceneObjects: any[]) {
    return this.http.post<any>(`${this.baseUrl}/scenes/${sceneId}/save-map`, { sceneObjectsDelta: sceneObjects });
  }
}