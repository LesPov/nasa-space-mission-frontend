// src/app/components/ui-hud/ui-hud.ts

import { Component, Input, OnInit, OnDestroy, inject, signal, computed, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameSession } from '../../core/engine/runtime/game-session';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { UiDialogos } from '../ui-dialogos/ui-dialogos';
import { CinematicDirectorService } from '../../core/engine/runtime/systems/cinematic-director.service';
import { GameContextService } from '../../core/engine/session/game-context.service';

@Component({
  selector: 'app-ui-hud',
  standalone: true,
  imports: [CommonModule, UiDialogos],
  templateUrl: './ui-hud.html',
  styleUrls: ['./ui-hud.css']
})
export class UiHud implements OnInit, OnDestroy {
  @Input() playState = 'PLAYING';
  @Input() hideStatus = false;

  public eventBus = inject(GameEventBusService);
  public gameSession = inject(GameSession);
  public gameContext = inject(GameContextService);
  public cdr = inject(ChangeDetectorRef);
  public cinematicDirector = inject(CinematicDirectorService);

  public hudMessage = signal<string | null>(null);
  public actionAvailable = signal<boolean>(false);
  public inspectAvailable = signal<boolean>(false);
  public targetInteractuable = signal<GameEntity | null>(null);
  public hoveredMesh = signal<AbstractMesh | null>(null);

  // Capacidades derivadas del perfil de autoridad
  public canEdit = computed(() => this.gameContext.authorityProfile().canEdit);
  public canSelect = computed(() => this.gameContext.authorityProfile().canSelect);
  public canViewDebug = computed(() => this.gameContext.authorityProfile().canViewDebug);

  private sub!: Subscription;
  private messageTimer: any = null;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'MessageRequested': 
          if (event.payload === null) {
              this.hudMessage.set(null);
              if (this.messageTimer) clearTimeout(this.messageTimer);
          } else {
              const text = event.payload.text;
              const duration = event.payload.durationMs || 4500;
              this.hudMessage.set(text);
              if (this.messageTimer) clearTimeout(this.messageTimer);
              this.messageTimer = setTimeout(() => {
                  this.hudMessage.set(null);
                  this.cdr.detectChanges();
              }, duration);
          }
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
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}