// src/app/services/api/asset-api.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AssetApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api`;

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

  // 🔥 NUEVO: Enlace HTTP a la API de actualización
  actualizarPrefab(id: number, data: { name: string, type: string, assetId: number | null, properties: any }): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/prefabs/${id}`, data);
  }

  eliminarPrefab(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/prefabs/${id}`);
  }
}