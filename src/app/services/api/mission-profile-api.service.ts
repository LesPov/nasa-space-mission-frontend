import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateMissionProfileDto, MissionProfileDto, UpdateMissionProfileDto } from '../../core/engine/models/space-mission.model';
  
@Injectable({ providedIn: 'root' })
export class MissionProfileApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/episodes`;

  obtenerMissionProfile(episodeId: number): Observable<MissionProfileDto> {
    return this.http.get<MissionProfileDto>(`${this.baseUrl}/${episodeId}/mission-profile`);
  }

  crearMissionProfile(episodeId: number, profileData: CreateMissionProfileDto): Observable<MissionProfileDto> {
    return this.http.post<MissionProfileDto>(`${this.baseUrl}/${episodeId}/mission-profile`, profileData);
  }

  actualizarMissionProfile(episodeId: number, profileData: UpdateMissionProfileDto): Observable<MissionProfileDto> {
    return this.http.put<MissionProfileDto>(`${this.baseUrl}/${episodeId}/mission-profile`, profileData);
  }
}