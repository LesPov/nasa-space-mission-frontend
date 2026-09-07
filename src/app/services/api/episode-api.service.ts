
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NarrativeRoleDto } from '../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class EpisodeApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api`;

  obtenerEpisodios(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/episodes`);
  }

  crearEpisodio(title: string, description: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/episodes`, { title, description });
  }

  obtenerRoles(episodeId: number): Observable<NarrativeRoleDto[]> {
    return this.http.get<NarrativeRoleDto[]>(`${this.baseUrl}/episodes/${episodeId}/roles`);
  }

  crearRol(episodeId: number, roleData: NarrativeRoleDto): Observable<NarrativeRoleDto> {
    return this.http.post<NarrativeRoleDto>(`${this.baseUrl}/episodes/${episodeId}/roles`, roleData);
  }

  actualizarRol(roleId: number, roleData: Partial<NarrativeRoleDto>): Observable<NarrativeRoleDto> {
    return this.http.put<NarrativeRoleDto>(`${this.baseUrl}/episodes/roles/${roleId}`, roleData);
  }

  eliminarRol(roleId: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/episodes/roles/${roleId}`);
  }
}