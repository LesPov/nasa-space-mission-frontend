
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

export interface SyncMessage {
  // 🔥 AÑADIDO: Nuevo evento ultraligero para sincronizar a 60FPS
  type: 'SYNC_MAP_DATA' | 'FOCUS_OBJECT' | 'SYNC_TRANSFORM_LIVE';
  payload: any;
}

@Injectable({ providedIn: 'root' })
export class WindowSyncService implements OnDestroy {
  private channel: BroadcastChannel;
  private messageSubject = new Subject<SyncMessage>();
  public messages$ = this.messageSubject.asObservable();

  constructor(private ngZone: NgZone) {
    this.channel = new BroadcastChannel('juego_politico_sync');
    
    this.channel.onmessage = (event) => {
      const msg = event.data as SyncMessage;
      
      // 🔥 FIX DE LAG: Si es un movimiento de gizmo en vivo, NO entramos en la zona de Angular.
      // Esto evita que Angular intente re-renderizar la UI 60 veces por segundo, eliminando el lag.
      if (msg.type === 'SYNC_TRANSFORM_LIVE') {
        this.messageSubject.next(msg);
      } else {
        // Para actualizaciones completas del mapa, sí usamos NgZone
        this.ngZone.run(() => {
          this.messageSubject.next(msg);
        });
      }
    };
  }

  public broadcast(message: SyncMessage): void {
    this.channel.postMessage(message);
  }

  ngOnDestroy(): void {
    this.channel.close();
  }
}