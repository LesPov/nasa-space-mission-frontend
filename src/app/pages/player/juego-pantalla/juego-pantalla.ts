
import { Component, OnInit, OnDestroy, inject, signal, ChangeDetectorRef, computed } from '@angular/core';
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
import { UiRoleSelectorComponent } from '../../../components/ui-role-selector/ui-role-selector'; 
import { WindowSyncService } from '../../../core/services/window-sync.service';
import { LiveBuilderService } from '../../../services/editor/live-builder.service';
import { PlayerInputService } from '../../../core/engine/runtime/systems/player-input.service';
import { RoleModalService } from '../../../services/editor/modals/role-modal.service'; 
import { NarrativeRoleDto } from '../../../core/engine/models/api-dto.model';
import { PlatformLifecycleService } from '../../../core/engine/runtime/systems/platform-lifecycle.service';
 
@Component({
  selector: 'app-juego-pantalla',
  standalone: true, 
  imports: [CommonModule, MotorBabylon, UiHud, UiInspect, UiMission, UiLoading, UiRadialMenu, UiRoleSelectorComponent],
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
  public inputSvc = inject(PlayerInputService);
  private platformLifecycle = inject(PlatformLifecycleService);
  
  private roleModalSvc = inject(RoleModalService); 
  public isRoleSelectorVisible = computed(() => this.roleModalSvc.showRoleSelector());

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
  private syncSub: Subscription | null = null; 
  private fpsInterval: any;

  public get canViewDebug(): boolean {
    return this.gameContext.authorityProfile().canViewDebug && !this.isDetached;
  }

  ngOnInit() {
    this.inputOrchestrator.initializeListeners();

    this.route.queryParams.subscribe(params => {
      this.isDetached = params['detached'] === 'true';
      
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
        setTimeout(() => {
            if (this.misionIniciada && !this.cerrandoModalUsuario && !this.inputSvc.isRadialMenuOpen && !this.liveBuilderSvc.isBuilding() && !this.gameContext.isPointerLocked() && !this.isRoleSelectorVisible()) {
                this.modalMisionUsuario = true;
                this.cdr.detectChanges();
            }
        }, 150);
      }
    });

    this.kbSub = this.inputRouter.getGlobalKeyboardStream(['GAMEPLAY', 'ADMIN_PREVIEW', 'UI']).subscribe(e => {
        this.handleKeyDown(e);
    });
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.misionIniciada && !this.modalMisionUsuario && !this.isRoleSelectorVisible()) {
      if (this.inputSvc.isRadialMenuOpen || this.liveBuilderSvc.isBuilding()) {
          return;
      }

      if (this.gameContext.isPointerLocked()) {
        this.inputOrchestrator.unlockPointer();
      } else {
        this.eventBus.emit({ type: 'GamePaused' });
      }
    }
    
    if ((event.code === 'KeyQ' || event.key.toLowerCase() === 'q') && this.canViewDebug && !event.repeat) {
      // Bloqueamos en TPS la apertura del menú si se pulsa Q
      if (this.gameContext.cameraView() === 'TPS') return;

      if (!this.inputSvc.isRadialMenuOpen && !this.liveBuilderSvc.isBuilding()) {
          this.eventBus.emit({ type: 'RadialMenuToggled', payload: true });
      }
    }

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
    
    if (this.syncSub) {
      this.syncSub.unsubscribe();
      this.syncSub = null;
    }

    forkJoin({
      escenaData: this.epiApiSvc.obtenerEscenaCompleta(sceneId),
      partida: this.epiApiSvc.cargarEstadoJugador(sceneId, 1).pipe(
        catchError(() => of({ worldState: {}, inventory: [] }))
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
            cinematics: res.escenaData.cinematics || [],
            narrativeRoles: [] 
          };
          
          this.playerStateActual = res.partida;
          
          if (!res.escenaData.scene?.narrativeRoles) {
             const rolesFetched = await this.epiApiSvc.obtenerRoles(this.episodioActual.id).toPromise();
             this.episodioActual.narrativeRoles = rolesFetched || [];
          } else {
             this.episodioActual.narrativeRoles = res.escenaData.scene.narrativeRoles;
          }

          const roleBeforeLoad = this.gameStateSvc.playerRole;
          this.gameStateSvc.loadGame(this.playerStateActual);
          if (isTeleport && roleBeforeLoad) {
             this.gameStateSvc.setPlayerRole(roleBeforeLoad);
          }
          
          if (isTeleport) {
              this.gameStateSvc.clearSceneState();
          }

          const localLogic = res.escenaData.scene?.environmentSettings?.logicSettings;
          if (localLogic?.initialVariables) {
              localLogic.initialVariables.forEach((vr: any) => {
                  if (vr.key) this.gameStateSvc.setVar(vr.key, vr.value, 'scene');
              });
          }
          
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

          if (!this.fpsInterval) {
            this.fpsInterval = setInterval(() => {
              this.fps.set(this.motor3dSvc.getCurrentFps().toFixed(0));
            }, 500);
          }

          if (this.isDetached) {
             this.syncSub = this.windowSync.messages$.subscribe(async msg => {
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
      error: () => {
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

  handleMissionStart() {
      const currentRole = this.gameStateSvc.playerRole;
      const playableRoles = (this.episodioActual?.narrativeRoles || []).filter((r: NarrativeRoleDto) => r.isEnabled && r.isPlayable);

      if (!currentRole && playableRoles.length > 0) {
          this.modalMisionUsuario = false; 
          this.roleModalSvc.openSelector(playableRoles, (uid) => {
              this.gameStateSvc.setPlayerRole(uid);
              
              this.runtime.shutdownProductionGame();
              this.runtime.bootProductionGame(this.episodioActual, false).then(() => {
                  this.comenzarMisionUsuario();
              });
          }, () => {
              this.modalMisionUsuario = true;
          });
      } else {
          this.comenzarMisionUsuario();
      }
  }

  comenzarMisionUsuario() {
    this.cerrandoModalUsuario = true; 
    const owner = this.ownership.getOwner();
    
    if (owner !== 'ADMIN_FREE') {
        const view = this.gameContext.cameraView();
        if (view === 'TPS') {
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
         this.eventBus.emit({ type: 'SequenceTriggered', payload: { sequenceId: this.episodioActual.uiSettings.initialSequence } });
      }
      this.cdr.detectChanges(); 
    }, 400); 
  }

  onCanvasClick() {
    if (this.misionIniciada && !this.gameContext.isPointerLocked() && !this.isInteracting() && !this.modalMisionUsuario && !this.inputSvc.isRadialMenuOpen && !this.isRoleSelectorVisible()) {
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
    if (this.syncSub) this.syncSub.unsubscribe();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }
}