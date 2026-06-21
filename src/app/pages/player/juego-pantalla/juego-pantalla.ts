
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { Motor3dService } from '../../../services/motor-3d.service';
import { InputOrchestratorService } from '../../../core/engine/runtime/systems/input-orchestrator.service';
import { AuthService } from '../../../core/services/auth';
import { GameStateService } from '../../../core/engine/runtime/state/game-state.service'; 
import { AdminFreeCameraService } from '../../../core/engine/runtime/cameras/admin-free-camera.service';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';
import { GameContextService } from '../../../core/engine/session/game-context.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';

import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiLoading } from '../../../components/ui-loading/ui-loading';
import { WindowSyncService } from '../../../core/services/window-sync.service';

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
  private adminFreeCam = inject(AdminFreeCameraService);
  private ownership = inject(CameraOwnershipService);
  private gameContext = inject(GameContextService);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private windowSync = inject(WindowSyncService);

  public isInteracting = signal<boolean>(false);
  public pointerLocked = signal<boolean>(false);
  public isLoading = signal<boolean>(true);
  
  public isDetached = false;
  public isSyncing = signal<boolean>(false);

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

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.misionIniciada && !this.modalMisionUsuario) {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      } else {
        this.eventBus.emit({ type: 'GamePaused' });
      }
    }
    
    if (event.code === 'KeyC' && event.ctrlKey && this.isAdmin) {
      event.preventDefault();
      const canvas = this.motor3dSvc.engine.getRenderingCanvas();
      if (canvas) {
        this.adminFreeCam.toggle(canvas);
      }
    }
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.isDetached = params['detached'] === 'true';
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      forkJoin({
        episodio: this.epiApiSvc.obtenerEpisodio(Number(id)),
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
            
            await this.runtime.bootProductionGame(res.episodio);
            
            this.isLoading.set(false);
            this.modalMisionUsuario = true;
            this.cdr.detectChanges();

            this.fpsInterval = setInterval(() => {
              this.fps.set(this.motor3dSvc.currentFps.toFixed(0));
            }, 500);

            if (this.isDetached) {
               this.windowSync.messages$.subscribe(msg => {
                 if (msg.type === 'SYNC_MAP_DATA') {
                   this.handleLiveSync(msg.payload);
                 } else if (msg.type === 'SYNC_TRANSFORM_LIVE') {
                   // 🔥 FIX: Actualización instantánea 60fps
                   this.handleLiveTransform(msg.payload);
                 }
               });
            }

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
             
             const owner = this.ownership.getOwner();
             if (owner !== 'ADMIN_FREE' && this.activeCameraView === 'FPS') {
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

  // 🔥 FIX: Streaming de Posiciones sin Lag
  handleLiveTransform(data: any) {
      const entity = this.entityManager.getEntityByUid(data.uid);
      if (entity && entity.view) {
          entity.view.position.set(data.position.x, data.position.y, data.position.z);
          
          if (data.rotationQuaternion && entity.view.rotationQuaternion) {
              entity.view.rotationQuaternion.set(data.rotationQuaternion.x, data.rotationQuaternion.y, data.rotationQuaternion.z, data.rotationQuaternion.w);
          } else if (data.rotation) {
              entity.view.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
          }
          
          entity.view.scaling.set(data.scaling.x, data.scaling.y, data.scaling.z);
          entity.syncTransformFromView();
      }
  }

  async handleLiveSync(newMapData: any) {
    this.isSyncing.set(true);

    let requiereReboot = false;

    // 1. Eliminar objetos borrados (Cero lag)
    if (newMapData.deletedObjects?.length) {
        newMapData.deletedObjects.forEach((uid: string) => this.entityManager.removeEntity(uid));
    }
    if (newMapData.deletedTriggers?.length) {
        newMapData.deletedTriggers.forEach((uid: string) => this.entityManager.removeEntity(uid));
    }

    // 2. Aplicar Actualizaciones Ligeras (Cero lag)
    const procesarDeltas = (deltas: any[]) => {
        if (!deltas) return;
        for (const delta of deltas) {
            const entity = this.entityManager.getEntityByUid(delta.uid);
            if (entity) {
                if (delta.position) entity.transform.position = { ...delta.position };
                if (delta.rotation) entity.transform.rotation = { ...delta.rotation };
                if (delta.scale) entity.transform.scale = { ...delta.scale };
                
                if (delta.properties) {
                   if (delta.properties.color) entity.visual.color = delta.properties.color;
                   if (delta.properties.colorBW) entity.visual.colorBW = delta.properties.colorBW;
                }
                
                entity.syncToView();
                entity.isDirty = false;
            } else {
                requiereReboot = true;
            }
        }
    };

    procesarDeltas(newMapData.sceneObjectsDelta);
    procesarDeltas(newMapData.triggersDelta);

    // 3. Actualizar Settings Globales
    if (newMapData.worldSettings || newMapData.uiSettings) {
        this.worldSettingsSvc.loadFromDb(newMapData.worldSettings, newMapData.uiSettings);
        this.worldSettingsSvc.applyToScene(this.motor3dSvc.scene, (mode) => this.motor3dSvc.setVisualMode(mode));
    }

    // 4. Fallback: Reboot del motor solo si se agregan objetos estructurales nuevos
    if (requiereReboot) {
        let lastPos: any = null;
        let lastRotQuat: any = null;
        let lastRotEuler: any = null;
        
        const playerEnt = this.gameContext.activePlayerEntity();
        if (playerEnt && playerEnt.view) {
           lastPos = playerEnt.view.position.clone();
           if (playerEnt.view.rotationQuaternion) {
               lastRotQuat = { x: playerEnt.view.rotationQuaternion.x, y: playerEnt.view.rotationQuaternion.y, z: playerEnt.view.rotationQuaternion.z, w: playerEnt.view.rotationQuaternion.w };
           } else {
               lastRotEuler = { x: playerEnt.view.rotation.x, y: playerEnt.view.rotation.y, z: playerEnt.view.rotation.z };
           }
        }

        this.episodioActual = { ...this.episodioActual, ...newMapData };
        
        try {
          const spawnEntity = await this.runtime.bootProductionGame(this.episodioActual);
          
          if (lastPos && spawnEntity.view) {
             spawnEntity.view.position.copyFrom(lastPos);
             if (lastRotQuat && spawnEntity.view.rotationQuaternion) {
                 spawnEntity.view.rotationQuaternion.set(lastRotQuat.x, lastRotQuat.y, lastRotQuat.z, lastRotQuat.w);
             } else if (lastRotEuler && !spawnEntity.view.rotationQuaternion) {
                 spawnEntity.view.rotation.set(lastRotEuler.x, lastRotEuler.y, lastRotEuler.z);
             }
             spawnEntity.syncTransformFromView();
          }
        } catch(e) {
           console.warn('[Sync] Fallo la recarga en vivo del mapa:', e);
        }
    }

    this.isSyncing.set(false);
  }

  comenzarMisionUsuario() {
    this.cerrandoModalUsuario = true; 
    
    const owner = this.ownership.getOwner();
    if (owner !== 'ADMIN_FREE') {
        if (this.activeCameraView === 'TPS') {
           this.runtime.toggleCameraUser(false, 60); 
        } else {
           this.runtime.toggleCameraUser(true, 60);
        }
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
    if (this.isDetached) {
        window.close();
        return;
    }

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