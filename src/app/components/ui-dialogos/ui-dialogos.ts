
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-ui-dialogos',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-dialogos.html',
  styleUrls: ['./ui-dialogos.css'],
})
export class UiDialogos implements OnInit, OnDestroy {
  private eventBus = inject(GameEventBusService);
  private cdr = inject(ChangeDetectorRef);
  private sub!: Subscription;

  public isActive = signal<boolean>(false);
  public actor = signal<string>('');
  public text = signal<string>('');
  
  private hideTimer: any = null;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'DialogueRequested') {
        const payload = event.payload;
        if (!payload.durationMs || payload.durationMs <= 0) {
            this.isActive.set(false);
        } else {
            this.actor.set(payload.actor || '');
            this.text.set(payload.text || '');
            this.isActive.set(true);
            
            if (this.hideTimer) clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                this.isActive.set(false);
                this.cdr.detectChanges();
            }, payload.durationMs);
        }
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}