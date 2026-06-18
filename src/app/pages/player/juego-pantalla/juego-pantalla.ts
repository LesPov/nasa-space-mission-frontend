
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { Subscription } from 'rxjs';
import { GameSession } from '../../../core/engine/game-session';
import { PlayerInteractionService } from '../../../core/engine/systems/player-interaction.service';
import { Motor3dService } from '../../../services/motor-3d.service';

import { EpisodiosService } from '../../../services/api/episodios';
 import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiLoading } from '../../../components/ui-loading/ui-loading';
import { CoreSceneLoaderService } from '../../../core/engine/scene/utils/core-scene-loader.service';

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
  private runtime = inject(RuntimeEngineService);
  private eventBus = inject(GameEventBusService);
  public gameSession = inject(GameSession);
  private interactSvc = inject(PlayerInteractionService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);

  private epiApiSvc = inject(EpisodiosService);
  private loaderSvc = inject(CoreSceneLoaderService);
  private entityManager = inject(EntityManagerService);

  public isInteracting = signal<boolean>(false);
  public pointerLocked = signal<boolean>(false);

  public isLoading = signal<boolean>(true);

  public modalMisionUsuario = false;
  public misionIniciada = false;
  public cerrandoModalUsuario = false;
  public mapaActualNombre = '';

  private sub!: Subscription;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.epiApiSvc.obtenerEpisodio(Number(id)).subscribe({
        next: async (res) => {
          this.motor3dSvc.forzarRedimension();
          this.loaderSvc.createInvisibleFloor(this.motor3dSvc.scene);
          
          if(res) {
            await this.loaderSvc.loadSceneFromData(res, false);
          }

          this.motor3dSvc.scene.executeWhenReady(() => {
            const spawnEntity = this.entityManager.getEntitiesByRol('spawn_point')[0] || 
                                this.entityManager.getEntitiesByRol('npc')[0];
            if (spawnEntity) {
              this.runtime.startSession(spawnEntity, 'FPS', false);
              this.mapaActualNombre = res?.title || 'Episodio Desconocido';
              this.isLoading.set(false);
              this.modalMisionUsuario = true;
              this.cdr.detectChanges();

              setTimeout(() => {
                document.exitPointerLock(); 
                this.runtime.toggleCameraUser(true, 500); 
              }, 100);
            } else {
              alert('Este episodio aún no tiene un punto de aparición (Spawn Point). Vuelve más tarde.');
              this.salirDelJuego();
            }
          });
        },
        error: (err) => {
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
        }
      });
    }

    this.sub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'InteractionStateChanged': 
          this.isInteracting.set(event.payload); 
          break;
        case 'GamePaused': 
          this.pointerLocked.set(false); 
          if (this.misionIniciada && !this.isInteracting()) {
             this.modalMisionUsuario = true;
             if (this.gameSession.cameraView() === 'FPS') {
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
    
    if (this.gameSession.cameraView() === 'TPS') {
       this.runtime.toggleCameraUser(false, 60); 
    }

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