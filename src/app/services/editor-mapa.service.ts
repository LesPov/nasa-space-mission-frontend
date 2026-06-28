
import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EditorMapaService {
  // Estado Puro de la Plataforma/Escena
  public episodioActualData = signal<any>(null);
  public escenaIdActiva = signal<number | null>(null);
  public escenaActualData = signal<any>(null);
  public plataformasEscena = signal<any[]>([]);

  // Eventos Globales del Mapa
  public onMapChanged = new Subject<void>();
  public onGizmoDrag = new Subject<void>();
  public onRequestPlatformChange = new Subject<number>();

  public limpiarEstado(): void {
    this.episodioActualData.set(null);
    this.escenaIdActiva.set(null);
    this.escenaActualData.set(null);
    this.plataformasEscena.set([]);
  }
}