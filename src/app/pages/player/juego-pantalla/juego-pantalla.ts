
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { Motor3dService } from '../../../services/motor-3d.service';

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

  public isInteracting = signal<boolean>(false);
  public pointerLocked = signal<boolean>(false);
  public isLoading = signal<boolean>(true);
  
  public modalMisionUsuario = false;
  public misionIniciada = false;
  public cerrandoModalUsuario = false;
  public mapaActualNombre = '';
  
  public fps = signal<string>('0');

  private sub!: Subscription;
  private fpsInterval: any;
  private activeCameraView = 'FPS';

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.epiApiSvc.obtenerEpisodio(Number(id)).subscribe({
        next: async (res) => {
          try {
            this.mapaActualNombre = res?.title || 'Episodio Desconocido';
            
            await this.runtime.bootProductionGame(res);
            
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

    // FIX: Referencia segura al canvas desde el motor en vez del DOM genérico
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
    this.runtime.shutdownProductionGame();
    this.router.navigate(['/jugador/episodios']);
  }

  cerrarInteraccion() {
     this.runtime.cerrarInteraccion();
  }

  ngOnDestroy() {
    this.runtime.shutdownProductionGame();
    if (this.sub) this.sub.unsubscribe();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }
}