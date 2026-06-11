import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EpisodiosService {
  private http = inject(HttpClient);
  // Asegúrate de que esta URL apunte a tu backend real. Puedes usar environment.apiUrl
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

  // 🔥 ACTUALIZADO PARA RECIBIR DATA COMPLETA (Objetos + Triggers)
  guardarMapa(id: number, mapData: { sceneObjects: any[], triggers: any[] }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes/${id}/save-map`, mapData, { headers: this.getAuthHeaders() });
  }

  obtenerAssets(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/assets`, { headers: this.getAuthHeaders() });
  }

  // 🔥 NUEVO: Método para subir Assets (.glb, .mp4, etc) desde el Frontend
  subirAsset(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('assetFile', file);
    // IMPORTANTE: Al subir archivos con FormData NO debes establecer el Content-Type,
    // el navegador lo hace automáticamente agregando el 'boundary' correcto.
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    });
    return this.http.post<any>(`${this.baseUrl}/assets/upload`, formData, { headers });
  }
  
}