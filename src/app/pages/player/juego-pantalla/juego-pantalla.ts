import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators'; // 🔥 FIX: Importación requerida

import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { Motor3dService } from '../../../services/motor-3d.service';
import { InputOrchestratorService } from '../../../core/engine/runtime/systems/input-orchestrator.service';
import { AuthService } from '../../../core/services/auth';
import { GameStateService } from '../../../core/engine/runtime/state/game-state.service'; 

import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiLoading } from '../../../components/ui-loading/ui-loading';

@Component({
  selector: 'app-juego-pantalla',
  standalone: true, 
  imports: [CommonModule, MotorBabylon, UiHud, UiInspect, UiMission, UiLoading],
  templateUrl: './juego-pantalla.html',
  styleUrls: ['./juego-pantalla.css']
})
export class JuegoPantalla implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public runtime = inject(RuntimeEngineService);
  private eventBus = inject(GameEventBusService);
  private cdr = inject(ChangeDetectorRef);
  private epiApiSvc = inject(EpisodiosService);
  private motor3dSvc = inject(Motor3dService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private authSvc = inject(AuthService);
  private gameStateSvc = inject(GameStateService); 

  public isInteracting = signal<boolean>(false);
  public pointerLocked = signal<boolean>(false);
  public isLoading = signal<boolean>(true);
  
  public modalMisionUsuario = false;
  public misionIniciada = false;
  public cerrandoModalUsuario = false;
  
  public episodioActual: any = null;
  public playerStateActual: any = null;
  
  public fps = signal<string>('0');

  private sub!: Subscription;
  private fpsInterval: any;
  private activeCameraView = 'FPS';

  public get isAdmin(): boolean {
    return this.authSvc.isAdmin();
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      forkJoin({
        episodio: this.epiApiSvc.obtenerEpisodio(Number(id)),
        // 🔥 FIX: Hacemos que la carga de partida sea inmortal. Si el server falla, devuelve un perfil en blanco.
        partida: this.epiApiSvc.cargarEstadoJugador(Number(id), 1).pipe(
          catchError(err => {
            console.warn('[JuegoPantalla] No se pudo cargar estado guardado, usando partida limpia', err);
            return of({ worldState: {}, inventory: [] });
          })
        )
      }).subscribe({
        next: async (res) => {
          try {
            this.episodioActual = res.episodio?.episode || res.episodio; 
            this.playerStateActual = res.partida;

            this.gameStateSvc.loadGame(this.playerStateActual);
            
            await this.runtime.bootProductionGame(res.episodio, this.isAdmin);
            
            this.isLoading.set(false);
            this.modalMisionUsuario = true;
            this.cdr.detectChanges();

            this.fpsInterval = setInterval(() => {
              this.fps.set(this.motor3dSvc.currentFps.toFixed(0));
            }, 500);

          } catch (err: any) {
            alert(err.message);
            this.salirDelJuego();
          }
        },
        error: (err) => {
          console.error('Error loading game:', err);
          this.isLoading.set(false);
          alert('Error crítico al cargar el mapa. Verifica tu conexión.');
          this.salirDelJuego();
        }
      });
    }

    this.sub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'InteractionStateChanged': 
          this.isInteracting.set(event.payload); 
          break;
        case 'CameraViewChanged':
          this.activeCameraView = event.payload;
          break;
        case 'GamePaused': 
          this.pointerLocked.set(false); 
          if (this.misionIniciada && !this.isInteracting()) {
             this.modalMisionUsuario = true;
             this.cerrandoModalUsuario = false;
             if (this.activeCameraView === 'FPS') {
                this.runtime.toggleCameraUser(false, 45); 
             }
          }
          break;
        case 'GameResumed': 
          this.pointerLocked.set(true); 
          break;
      }
      this.cdr.detectChanges();
    });
  }

  comenzarMisionUsuario() {
    this.cerrandoModalUsuario = true; 
    
    if (this.activeCameraView === 'TPS') {
       this.runtime.toggleCameraUser(false, 60); 
    } else {
       this.runtime.toggleCameraUser(true, 60);
    }

    this.inputOrchestrator.lockPointer();

    setTimeout(() => {
      const esPrimeraVez = !this.misionIniciada;
      this.misionIniciada = true; 
      this.modalMisionUsuario = false;
      this.cerrandoModalUsuario = false;
      
      if (esPrimeraVez && this.episodioActual?.uiSettings?.initialSequence) {
         this.eventBus.emit({ 
           type: 'SequenceTriggered', 
           payload: { sequenceId: this.episodioActual.uiSettings.initialSequence } 
         });
      }

      this.cdr.detectChanges(); 
    }, 2000); 
  }

  onCanvasClick() {
    if (this.misionIniciada && !this.pointerLocked() && !this.isInteracting() && !this.modalMisionUsuario) {
      this.inputOrchestrator.lockPointer();
    }
  }

  salirDelJuego() {
    if (this.episodioActual && this.playerStateActual) {
      const stateToSave = this.gameStateSvc.getSaveData();
      this.epiApiSvc.guardarEstadoJugador(this.episodioActual.id, 1, stateToSave).subscribe();
    }

    this.runtime.shutdownProductionGame();
    if (this.isAdmin) {
        this.router.navigate(['/admin/editor-escena']);
    } else {
        this.router.navigate(['/jugador/episodios']);
    }
  }

  cerrarInteraccion() {
     this.runtime.cerrarInteraccion();
  }

  ngOnDestroy() {
    this.runtime.shutdownProductionGame();
    this.inputOrchestrator.disposeListeners();
    if (this.sub) this.sub.unsubscribe();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }
}