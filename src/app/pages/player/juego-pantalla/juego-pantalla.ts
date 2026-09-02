
// src/app/pages/player/juego-pantalla/juego-pantalla.ts

import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { InputOrchestratorService } from '../../../core/engine/runtime/systems/input-orchestrator.service';
import { InputRouterService } from '../../../core/engine/session/input-router.service';
import { AuthService } from '../../../core/services/auth';
import { GameStateService } from '../../../core/engine/runtime/state/game-state.service'; 
import { AdminFreeCameraService } from '../../../core/engine/runtime/cameras/admin-free-camera.service';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';
import { GameContextService } from '../../../core/engine/session/game-context.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { EditorCinematicService } from '../../../services/editor/editor-cinematic.service';
import { EditorLiveSyncService } from '../../../services/editor/editor-live-sync.service';

import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiLoading } from '../../../components/ui-loading/ui-loading';
import { UiRadialMenu } from '../../../components/ui-radial-menu/ui-radial-menu';
import { WindowSyncService } from '../../../core/services/window-sync.service';
import { LiveBuilderService } from '../../../services/editor/live-builder.service';

@Component({
  selector: 'app-juego-pantalla',
  standalone: true, 
  imports: [CommonModule, MotorBabylon, UiHud, UiInspect, UiMission, UiLoading, UiRadialMenu],
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
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private inputOrchestrator = inject(InputOrchestratorService);
  private inputRouter = inject(InputRouterService);
  private authSvc = inject(AuthService);
  private gameStateSvc = inject(GameStateService); 
  private adminFreeCam = inject(AdminFreeCameraService);
  private ownership = inject(CameraOwnershipService);
  public gameContext = inject(GameContextService);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private windowSync = inject(WindowSyncService);
  private cinematicSvc = inject(EditorCinematicService); 
  private liveBuilderSvc = inject(LiveBuilderService);
  private liveSync = inject(EditorLiveSyncService);

  public isInteracting = signal<boolean>(false);
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
  private kbSub!: Subscription;
  private fpsInterval: any;

  // Propiedad de autoridad para el template UI
  public get canViewDebug(): boolean {
    return this.gameContext.authorityProfile().canViewDebug && !this.isDetached;
  }

  ngOnInit() {
    // 🔥 FIX FASE 3.1: Inicializar los listeners globales del DOM para que el Input funcione en Player/Admin Preview.
    // Sin esto, el motor está "sordo" a los eventos Pointer Lock y Teclado.
    this.inputOrchestrator.initializeListeners();

    this.route.queryParams.subscribe(params => {
      this.isDetached = params['detached'] === 'true';
      
      // La capa de aplicación traduce la sesión a un contexto de ejecución explícito en el Engine
      const userIsAdmin = this.authSvc.isAdmin();
      const execContext = (userIsAdmin && !this.isDetached) ? 'ADMIN_PREVIEW' : 'PLAYER_PREVIEW';
      this.gameContext.setupContext(execContext, { cameraView: 'FPS' });
    });

    if (this.gameContext.authorityProfile().canUseAdminFeatures) {
      this.liveBuilderSvc.initialize();
    }

    const sceneId = this.route.snapshot.paramMap.get('id');
    if (sceneId) {
      this.cargarPlataforma(Number(sceneId));
    }

    this.sub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'ChangeSceneRequested') {
        this.cambiarPlataformaEnJuego(event.payload.sceneId);
      } else if (event.type === 'GamePaused') {
        // 🔥 FIX FASE 3.1: Asegurar que el modal de pausa se abre cuando el juego pierde el Pointer Lock
        // (ya sea por pulsar ESC u otra razón nativa del navegador).
        if (this.misionIniciada && !this.cerrandoModalUsuario) {
            this.modalMisionUsuario = true;
            this.cdr.detectChanges();
        }
      }
    });

    // Centralización del Input de teclado exclusivo de Gameplay / UI
    this.kbSub = this.inputRouter.getGlobalKeyboardStream(['GAMEPLAY', 'ADMIN_PREVIEW', 'UI']).subscribe(e => {
        this.handleKeyDown(e);
    });
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.misionIniciada && !this.modalMisionUsuario) {
      if (this.gameContext.isPointerLocked()) {
        this.inputOrchestrator.unlockPointer();
      } else {
        this.eventBus.emit({ type: 'GamePaused' });
      }
    }
    
    // Función administrativa de cámara libre basada en la autoridad del engine
    if ((event.code === 'KeyC' || event.key.toLowerCase() === 'c') && event.ctrlKey && this.gameContext.authorityProfile().canUseAdminFeatures) {
      event.preventDefault();
      const canvas = this.motor3dSvc.getEngine()?.getRenderingCanvas();
      if (canvas) {
        this.adminFreeCam.toggle(canvas);
      }
    }
  }

  private cargarPlataforma(sceneId: number, isTeleport: boolean = false) {
    this.isLoading.set(true);
    
    forkJoin({
      escenaData: this.epiApiSvc.obtenerEscenaCompleta(sceneId),
      partida: this.epiApiSvc.cargarEstadoJugador(sceneId, 1).pipe(
        catchError(err => of({ worldState: {}, inventory: [] }))
      )
    }).subscribe({
      next: async (res) => {
        try {
          this.episodioActual = {
            id: res.escenaData.scene?.episodeId || res.escenaData.scene?.episodeVersionId || sceneId, 
            title: res.escenaData.scene?.name || 'Escena',
            description: 'Explora esta zona.',
            sceneObjects: res.escenaData.sceneObjects,
            triggers: res.escenaData.triggers,
            scene: res.escenaData.scene,
            cinematics: res.escenaData.cinematics || []
          };
          
          this.playerStateActual = res.partida;
          
          const localLogic = res.escenaData.scene?.environmentSettings?.logicSettings;
          if (localLogic?.initialVariables) {
              localLogic.initialVariables.forEach((vr: any) => {
                  if (vr.key) this.playerStateActual.worldState[vr.key] = vr.value;
              });
          }

          this.gameStateSvc.loadGame(this.playerStateActual);
          
          await this.runtime.bootProductionGame(this.episodioActual, isTeleport);
          
          this.isLoading.set(false);
          
          if (isTeleport) {
              this.modalMisionUsuario = false;
              this.misionIniciada = true;
              this.inputOrchestrator.lockPointer();
          } else {
              this.modalMisionUsuario = true;
          }

          this.cdr.detectChanges();

          this.fpsInterval = setInterval(() => {
            this.fps.set(this.motor3dSvc.getCurrentFps().toFixed(0));
          }, 500);

          if (this.isDetached) {
             this.windowSync.messages$.subscribe(async msg => {
               if (msg.type === 'SYNC_MAP_DATA') {
                 this.isSyncing.set(true);
                 if (this.liveSync.requiresFullReboot(msg.payload)) {
                    this.cambiarPlataformaEnJuego(this.episodioActual.id);
                 } else {
                    this.episodioActual = await this.liveSync.applyDelta(msg.payload, this.episodioActual);
                 }
                 this.isSyncing.set(false);
               } else if (msg.type === 'SYNC_TRANSFORM_LIVE') {
                 this.liveSync.applyTransformLive(msg.payload);
               }
             });
          }

        } catch (err: any) {
          alert(err.message);
          this.salirDelJuego();
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        alert('Error crítico al cargar el mapa.');
        this.salirDelJuego();
      }
    });
  }

  public cambiarPlataformaEnJuego(sceneId: number) {
    if (this.episodioActual && this.playerStateActual) {
      const stateToSave = this.gameStateSvc.getSaveData();
      this.epiApiSvc.guardarEstadoJugador(this.episodioActual.id, 1, stateToSave).subscribe();
    }
    this.runtime.shutdownProductionGame();
    this.cargarPlataforma(sceneId, true);
  }

  comenzarMisionUsuario() {
    this.cerrandoModalUsuario = true; 
    const owner = this.ownership.getOwner();
    
    if (owner !== 'ADMIN_FREE') {
        const view = this.gameContext.cameraView();
        this.runtime.toggleCameraUser(view === 'TPS', 60);
    }

    this.inputOrchestrator.lockPointer();

    setTimeout(() => {
      const esPrimeraVez = !this.misionIniciada;
      this.misionIniciada = true; 
      this.modalMisionUsuario = false;
      this.cerrandoModalUsuario = false;
      
      if (esPrimeraVez && this.episodioActual?.uiSettings?.initialSequence) {
         this.eventBus.emit({ type: 'SequenceTriggered', payload: { sequenceId: this.episodioActual.uiSettings.initialSequence } });
      }
      this.cdr.detectChanges(); 
    }, 2000); 
  }

  onCanvasClick() {
    if (this.misionIniciada && !this.gameContext.isPointerLocked() && !this.isInteracting() && !this.modalMisionUsuario) {
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

    this.entityManager.getAllEntities().forEach(e => e.isPersistent = false);
    this.runtime.shutdownProductionGame();
    
    if (this.gameContext.authorityProfile().canUseAdminFeatures) {
       this.liveBuilderSvc.destroy(); 
       this.router.navigate(['/admin/editor-escena']);
    } else {
       this.router.navigate(['/jugador/episodios']);
    }
  }

  cerrarInteraccion() {
     this.runtime.cerrarInteraccion();
  }

  ngOnDestroy() {
    this.entityManager.getAllEntities().forEach(e => e.isPersistent = false);
    this.runtime.shutdownProductionGame();
    this.inputOrchestrator.disposeListeners();
    this.liveBuilderSvc.destroy();
    if (this.sub) this.sub.unsubscribe();
    if (this.kbSub) this.kbSub.unsubscribe();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }
}