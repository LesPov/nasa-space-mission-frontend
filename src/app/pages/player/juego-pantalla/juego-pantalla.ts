
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { Subscription } from 'rxjs';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';
import { GameSession } from '../../../core/engine/game-session';
import { PlayerInteractionService } from '../../../services/editor/playerservice/player-interaction.service';
import { Motor3dService } from '../../../services/motor-3d.service';

@Component({
  selector: 'app-juego-pantalla',
  standalone: true,
  imports: [CommonModule, MotorBabylon],
  templateUrl: './juego-pantalla.html',
  styleUrls: ['./juego-pantalla.css']
})
export class JuegoPantalla implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private runtime = inject(RuntimeEngineService);
  private eventBus = inject(GameEventBusService);
  private gameSession = inject(GameSession);
  private interactSvc = inject(PlayerInteractionService);
  private motor3dSvc = inject(Motor3dService);
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

  public modalMisionUsuario = false;
  public misionIniciada = false;
  public cerrandoModalUsuario = false;
  public mapaActualNombre = '';

  private sub!: Subscription;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.runtime.loadAndPlayEpisode(Number(id), 'FPS').then((res) => {
        this.mapaActualNombre = res?.title || 'Episodio Desconocido';
        this.isLoading.set(false);
        this.modalMisionUsuario = true;
        this.cdr.detectChanges();

        setTimeout(() => {
          document.exitPointerLock(); 
          this.runtime.toggleCameraUser(true, 500); 
        }, 100);
      }).catch(err => {
        console.error('Error loading game:', err);
        this.isLoading.set(false);
        
        if (err.status === 403) {
            this.mapaActualNombre = 'Acceso Denegado (403)';
            alert(`🛑 ACCESO DENEGADO 🛑\n\nTu servidor bloqueó el acceso. Como eres "usuario", no puedes jugar episodios ocultos.\n\nSOLUCIÓN:\nVe a tu base de datos y pon "isPublished = 1" en el episodio con ID ${id}`);
        } else {
            this.mapaActualNombre = 'Error de Servidor';
            alert('Error al cargar el mapa. Verifica la consola y que tu backend esté corriendo.');
        }
        this.salirDelJuego();
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
        case 'GamePaused': 
          this.pointerLocked.set(false); 
          if (this.misionIniciada && !this.isInteracting()) {
             this.modalMisionUsuario = true;
             if (this.cameraView() === 'FPS') {
                this.runtime.toggleCameraUser(false, 45); 
             }
          }
          break;
        case 'GameResumed': 
          this.pointerLocked.set(true); 
          // NOTA: No quitamos el modal aquí para que la animación de cierre de la misión (estilo GTA) fluya bien en comenzarMisionUsuario()
          break;
        case 'CameraViewChanged': this.cameraView.set(event.payload); break;
      }
      this.cdr.detectChanges();
    });
  }

  comenzarMisionUsuario() {
    this.cerrandoModalUsuario = true; 
    
    if (this.cameraView() === 'TPS') {
       this.runtime.toggleCameraUser(false, 60); 
    }

    // EL BLOQUEO DEBE SER SINCRÓNICO AL GESTO DEL USUARIO PARA EVITAR EL BUG DEL CONGELAMIENTO
    const canvas = this.motor3dSvc.engine.getRenderingCanvas();
    if (canvas) {
      canvas.focus();
      try { canvas.requestPointerLock(); } catch {}
    }

    setTimeout(() => {
      this.misionIniciada = true; 
      this.modalMisionUsuario = false;
      this.cerrandoModalUsuario = false;
      this.cdr.detectChanges(); 
    }, 2000); 
  }

  salirDelJuego() {
    this.runtime.stopSession();
    this.router.navigate(['/jugador/episodios']);
  }

  cerrarInteraccion() {
     this.interactSvc.cerrarMensajeInteractivo();
  }

  ngOnDestroy() {
    this.runtime.stopSession();
    if (this.sub) this.sub.unsubscribe();
  }
}