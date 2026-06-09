import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/episodes`;

  getEpisodes() {
    return this.http.get<any[]>(this.baseUrl);
  }

  createEpisode(title: string, description: string) {
    return this.http.post<any>(this.baseUrl, { title, description });
  }

  getEpisodeData(episodeId: number) {
    return this.http.get<any>(`${this.baseUrl}/${episodeId}`);
  }

  saveFullMap(episodeId: number, sceneObjects: any[]) {
    return this.http.post<any>(`${this.baseUrl}/${episodeId}/save-map`, { sceneObjects });
  }
}