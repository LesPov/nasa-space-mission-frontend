
import { Component, Output, EventEmitter, inject, OnInit, OnDestroy, ChangeDetectorRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-ui-inspect',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-inspect.html',
  styleUrls: ['./ui-inspect.css']
})
export class UiInspect implements OnInit, OnDestroy {
  @Output() onClose = new EventEmitter<void>();
  
  public eventBus = inject(GameEventBusService);
  public cdr = inject(ChangeDetectorRef);

  public isInteracting = signal<boolean>(false);
  public target = signal<GameEntity | null>(null);
  
  private sub!: Subscription;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'InteractionStateChanged') {
        this.isInteracting.set(event.payload);
      } else if (event.type === 'ObjectFocused') {
        this.target.set(event.payload.entity);
      }
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  cerrar() {
    this.onClose.emit();
  }
}