
import { Component, Input, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameSession } from '../../core/engine/game-session';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-ui-hud',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-hud.html',
  styleUrls: ['./ui-hud.css']
})
export class UiHud implements OnInit, OnDestroy {
  @Input() isEditor = false;
  @Input() playState = 'PLAYING';
  @Input() hideStatus = false;

  public eventBus = inject(GameEventBusService);
  public gameSession = inject(GameSession);
  public cdr = inject(ChangeDetectorRef);

  public hudMessage = signal<string | null>(null);
  public actionAvailable = signal<boolean>(false);
  public inspectAvailable = signal<boolean>(false);
  public targetInteractuable = signal<GameEntity | null>(null);
  public hoveredMesh = signal<AbstractMesh | null>(null);

  private sub!: Subscription;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'MessageRequested': 
          this.hudMessage.set(event.payload); 
          break;
        case 'ObjectFocused':
          this.targetInteractuable.set(event.payload.entity);
          this.hoveredMesh.set(event.payload.mesh);
          this.actionAvailable.set(event.payload.canInteract);
          this.inspectAvailable.set(event.payload.canInspect);
          break;
      }
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }
}