
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { Subscription } from 'rxjs';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';
import { GameSession } from '../../../core/engine/game-session';
import { PlayerInteractionService } from '../../../services/editor/playerservice/player-interaction.service';

@Component({
  selector: 'app-juego-pantalla',
  standalone: true,
  imports: [CommonModule, MotorBabylon],
  templateUrl: './juego-pantalla.html',
  styleUrls: ['./juego-pantalla.css']
})
export class JuegoPantalla implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private runtime = inject(RuntimeEngineService);
  private eventBus = inject(GameEventBusService);
  private gameSession = inject(GameSession);
  private interactSvc = inject(PlayerInteractionService);
  private cdr = inject(ChangeDetectorRef);

  public hudMessage = signal<string | null>(null);
  public actionAvailable = signal<boolean>(false);
  public inspectAvailable = signal<boolean>(false);
  public targetInteractuable = signal<GameEntity | null>(null);
  public hoveredMesh = signal<AbstractMesh | null>(null);
  public isInteracting = signal<boolean>(false);
  public pointerLocked = signal<boolean>(false);
  public cameraView = signal<'FPS'|'TPS'>('FPS');

  public isLoading = signal<boolean>(true);

  private sub!: Subscription;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.runtime.loadAndPlayEpisode(Number(id), 'FPS').then(() => {
        this.isLoading.set(false);
      }).catch(err => {
        console.error('Error loading game:', err);
        this.isLoading.set(false);
      });
    }

    this.sub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'MessageRequested': this.hudMessage.set(event.payload); break;
        case 'ObjectFocused':
          this.targetInteractuable.set(event.payload.entity);
          this.hoveredMesh.set(event.payload.mesh);
          this.actionAvailable.set(event.payload.canInteract);
          this.inspectAvailable.set(event.payload.canInspect);
          break;
        case 'InteractionStateChanged': this.isInteracting.set(event.payload); break;
        case 'GamePaused': this.pointerLocked.set(false); break;
        case 'GameResumed': this.pointerLocked.set(true); break;
        case 'CameraViewChanged': this.cameraView.set(event.payload); break;
      }
      this.cdr.detectChanges();
    });
    
    document.addEventListener('pointerlockchange', this.onPointerLock);
  }

  onPointerLock = () => {
     this.pointerLocked.set(!!document.pointerLockElement);
     this.cdr.detectChanges();
  };

  cerrarInteraccion() {
     this.interactSvc.cerrarMensajeInteractivo();
  }

  ngOnDestroy() {
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    this.runtime.stopSession();
    if (this.sub) this.sub.unsubscribe();
  }
}