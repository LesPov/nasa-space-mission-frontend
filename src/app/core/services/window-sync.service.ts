// src/app/core/services/window-sync.service.ts
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

export interface SyncMessage {
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
      
      if (msg.type === 'SYNC_TRANSFORM_LIVE') {
        this.messageSubject.next(msg);
      } else {
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