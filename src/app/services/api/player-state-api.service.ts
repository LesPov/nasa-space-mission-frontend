import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PlayerStateApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/episodes`;

  cargarEstadoJugador(episodeId: number, slot: number = 1): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/${episodeId}/save-slots/${slot}`);
  }

  guardarEstadoJugador(episodeId: number, slot: number = 1, stateData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/${episodeId}/save-slots/${slot}`, stateData);
  }
}