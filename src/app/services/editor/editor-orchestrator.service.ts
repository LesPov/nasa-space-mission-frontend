// file: src/app/services/editor/editor-orchestrator.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorMapaService } from '../editor-mapa.service';
import { EditorStateService } from './editor-state.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorToolsService } from './editor-tools.service';
import { LayoutService } from '../../services/layout.service';
import { EpisodiosService } from '../api/episodios';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { EditorPlayModeService } from './editor-play-mode.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { InputRouterService } from '../../core/engine/session/input-router.service';
import { GameContextService } from '../../core/engine/session/game-context.service'; 
import { GameMode } from '../../core/engine/session/game-mode.model'; 
import { EditorCinematicService } from './editor-cinematic.service';
import { LiveBuilderService } from './live-builder.service';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { EditorLiveSyncService } from './editor-live-sync.service';
import { MissionModalService } from './modals/mission-modal.service';
import { CameraViewMode } from '../../core/engine/session/game-context.model';
import { SnapshotReconcilerService } from './utils/snapshot-reconciler.service';
import { CinematicPlaybackManagerService } from '../../core/engine/runtime/cinematics/cinematic-playback-manager.service';
import { EngineSessionService } from '../../core/engine/session/engine-session.service';
import { LiveLifecycleManagerService } from '../../core/engine/runtime/live/live-lifecycle-manager.service';
import { NarrativeRoleDto } from '../../core/engine/models/api-dto.model';
import { DynamicLightingSystem } from '../../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { ShadowOrchestratorService } from '../../core/engine/runtime/shadows/shadow-orchestrator.service';
import { LocalRenderingSystem } from '../../core/engine/runtime/systems/local-rendering.system';

@Injectable({ providedIn: 'root' })
export class EditorOrchestratorService {
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private editorSvc = inject(EditorMapaService);
  private stateSvc = inject(EditorStateService);
  private sceneSvc = inject(EditorSceneService);
  private toolsSvc = inject(EditorToolsService);
  private layoutSvc = inject(LayoutService);
  private epiApiSvc = inject(EpisodiosService);
  private eventBus = inject(GameEventBusService);
  private playModeSvc = inject(EditorPlayModeService);
  private runtime = inject(RuntimeEngineService);
  private entityManager = inject(EntityManagerService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private inputRouter = inject(InputRouterService);
  private gameContext = inject(GameContextService);
  private cinematicSvc = inject(EditorCinematicService);
  private liveBuilderSvc = inject(LiveBuilderService);
  private gameState = inject(GameStateService);
  private transitionSvc = inject(EditorModeTransitionService);
  private liveSync = inject(EditorLiveSyncService);
  private router = inject(Router);
  private missionSvc = inject(MissionModalService);
  private snapshotReconciler = inject(SnapshotReconcilerService);
  private playbackManager = inject(CinematicPlaybackManagerService);
  private sessionSvc = inject(EngineSessionService);
  private liveLifecycle = inject(LiveLifecycleManagerService);
  private dynLighting = inject(DynamicLightingSystem);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private localRendering = inject(LocalRenderingSystem);

  public readonly editando = signal(false);
  public readonly isPlayable = signal(false);
  public readonly cargandoEscena = signal(false);
  public readonly cargandoTexto = signal('Preparando entorno...');
  public readonly fps = signal('0');
  public readonly estadoGuardado = signal('Guardado');
  
  public readonly listaEpisodios = signal<any[]>([]);
  public episodioCompletoData: any = null;
  public mapaActualNombre = '';

  private fpsInterval: any;
  private autoSaveSub!: Subscription;
  private eventBusSub!: Subscription;
  private reqPlatformSub!: Subscription;
  private mapChangeSub!: Subscription;

  public initialize(): void {
    this.cargarEpisodios();
    this.liveBuilderSvc.initialize();

    this.reqPlatformSub = this.editorSvc.onRequestPlatformChange.subscribe(id => {
      if (this.editorSvc.escenaIdActiva() !== id && this.stateSvc.playState() === 'EDITOR') {
        this.cambiarPlataformaActiva(id);
      }
    });

    this.eventBusSub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'ChangeSceneRequested') {
        if (this.stateSvc.playState() === 'PLAYING' || this.stateSvc.playState() === 'EDITING_IN_GAME') {
          this.cambiarPlataformaTestLive(event.payload.sceneId);
        }
      }
    });

    this.mapChangeSub = this.editorSvc.onMapChanged.subscribe(() => {
      setTimeout(() => this.revisarSiEsJugable(), 0);
    });

    this.autoSaveSub = this.editorSvc.onMapChanged.pipe(
      debounceTime(1500) 
    ).subscribe(() => {
      try {
        const state = this.stateSvc.playState();
        if (this.gameContext.authorityProfile().canEdit && this.editando() && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
          this.guardarMapaEnBD(true); 
        }
      } catch (e) {
        console.error('Error durante autoguardado:', e);
      }
    });
  }

  public destroy(): void {
    if (this.fpsInterval) clearInterval(this.fpsInterval);
    if (this.autoSaveSub) this.autoSaveSub.unsubscribe();
    if (this.eventBusSub) this.eventBusSub.unsubscribe();
    if (this.reqPlatformSub) this.reqPlatformSub.unsubscribe();
    if (this.mapChangeSub) this.mapChangeSub.unsubscribe();
    this.liveBuilderSvc.destroy(); 
  }

  public getGameState(): GameStateService {
    return this.gameState;
  }

  public cargarEpisodios(): void {
    this.epiApiSvc.obtenerEpisodios().subscribe({
      next: (res: any) => { 
        const list = Array.isArray(res) ? res : (res?.data || res?.episodes || []);
        this.listaEpisodios.set(list); 
      },
      error: (err) => console.error('Error al cargar episodios', err)
    });
  }

  public crearNuevoEpisodio(title: string, desc: string): void {
    if (!title) return;
    this.epiApiSvc.crearEpisodio(title, desc).subscribe({
      next: (res) => {
        const episodeData = res.episode || res;
        this.listaEpisodios.update(v => [episodeData, ...v]);
        this.missionSvc.cerrarCrearMapa();
        
        if (res.initialScene) {
          episodeData.initialScene = res.initialScene;
        }
        this.entrarAlEditor(episodeData);
      },
      error: (err) => alert('Error creando episodio')
    });
  }

  public entrarAlEditor(episodio: any): void {
    this.layoutSvc.ocultarMenu();
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Cargando herramientas de creador...');
    
    this.epiApiSvc.obtenerPlataformasEscena(episodio.id).subscribe({
      next: (plataformas) => {
        this.editorSvc.setPlataformasEscena(plataformas);
        const sceneId = episodio.initialScene?.id || plataformas[0]?.id || episodio.id;
        this.procesarCarga(episodio, sceneId);
      },
      error: (err) => {
        console.error('Error cargando plataformas', err);
        const sceneId = episodio.initialScene?.id || episodio.id;
        this.procesarCarga(episodio, sceneId);
      }
    });
  }

  public async procesarCarga(episodio: any, sceneId: number): Promise<void> {
    const sessionId = this.sessionSvc.startNewSession();
    this.mapaActualNombre = episodio.title;
    if (!this.editando()) {
      this.editando.set(true);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    this.epiApiSvc.obtenerEscenaCompleta(sceneId).subscribe({
      next: async (res) => {
        if (!this.sessionSvc.isSessionActive(sessionId)) return;
        
        this.episodioCompletoData = { ...res, episode: episodio }; 
        this.editorSvc.setEscenaIdActiva(sceneId);
        
        if (!episodio.narrativeRoles) {
          this.epiApiSvc.obtenerRoles(episodio.id).subscribe({
            next: (roles) => {
              if (!this.sessionSvc.isSessionActive(sessionId)) return;
              episodio.narrativeRoles = roles;
              this.editorSvc.setEpisodioActualData(episodio);
            }
          });
        } else {
          this.editorSvc.setEpisodioActualData(episodio);
        }

        this.editorSvc.setEscenaActualData(res);
        this.cargandoTexto.set('Preparando modelos, jerarquías, luces y sombras...');
        
        this.motor3dSvc.forceResize(); 
        this.toolsSvc.activarEventosEditor();
        this.sceneSvc.crearSuelo();

        if (res) {
          await this.sceneSvc.cargarEscenaDesdeDatos(res);
        }

        if (!this.sessionSvc.isSessionActive(sessionId)) return;

        const scene = this.motor3dSvc.getScene();
        scene.executeWhenReady(async () => {
          if (!this.sessionSvc.isSessionActive(sessionId)) return;
          
          this.cargandoTexto.set('Estabilizando sombreadores e iluminación del editor...');
          
          // Asegurar que las matrices de transformación del Player estén completamente calculadas
          const allEntities = this.entityManager.getAllEntities();
          allEntities.forEach(e => {
            if (e.view && !e.view.isDisposed()) {
              e.view.computeWorldMatrix(true);
            }
          });

          // Obtener la posición de referencia real del Player/Actor
          const realPlayerRefPos = this.dynLighting.getReferencePosition('AUTO');

          this.dynLighting.start();
          this.dynLighting.prepareAllLights();
          this.shadowOrchestrator.reconcileShadows();
          
          // Precalentar con la posición del Player para que las luces próximas enciendan de inmediato
          await this.dynLighting.forceWarmup(realPlayerRefPos);
          this.localRendering.ensureAllEntitiesVisibleForEditor();

          // Ejecutar un tick completo inicial de iluminación con la posición real
          this.dynLighting.update(16.66);

          scene.render();
          scene.render();

          this.cargandoEscena.set(false);
          this.revisarSiEsJugable(); 
          this.toolsSvc.forceResetVisuals();
          
          if (!this.fpsInterval) {
            this.fpsInterval = setInterval(() => {
              this.fps.set(this.motor3dSvc.getCurrentFps().toFixed(0));
            }, 500);
          }
        });
      },
      error: (err) => {
        if (!this.sessionSvc.isSessionActive(sessionId)) return;
        this.cargandoEscena.set(false);
        alert('Error conectando con el servidor. No se pudo cargar la escena.');
      }
    });
  }

  public confirmarCrearPlataforma(nombre: string): void {
    if (!nombre.trim()) return;
    const epId = this.editorSvc.episodioActualData()?.id;
    if (!epId) return;

    this.epiApiSvc.crearPlataformaEscena(epId, nombre).subscribe({
      next: (nuevaEscena) => {
        const actuales = this.editorSvc.plataformasEscena();
        this.editorSvc.setPlataformasEscena([...actuales, nuevaEscena]);
        this.cambiarPlataformaActiva(nuevaEscena.id);
      },
      error: (err) => alert('Error creando la plataforma')
    });
  }

  public cambiarPlataformaActiva(sceneId: number): void {
    this.guardarMapaEnBD(true); 
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Cambiando de zona...');
    this.procesarCarga(this.editorSvc.episodioActualData(), sceneId);
  }

  public async cambiarPlataformaTestLive(sceneId: number): Promise<void> {
    const sessionId = this.sessionSvc.startNewSession();
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Teletransportando a nueva zona...');
    
    this.runtime.stopTestSession();
    this.editorSvc.setEscenaIdActiva(sceneId);
    
    this.entityManager.clear();

    this.epiApiSvc.obtenerEscenaCompleta(sceneId).subscribe({
      next: async (res) => {
        if (!this.sessionSvc.isSessionActive(sessionId)) return;
        const currentEpisodio = this.editorSvc.episodioActualData();
        this.episodioCompletoData = { ...res, episode: currentEpisodio }; 
        this.editorSvc.setEscenaIdActiva(sceneId);
        this.editorSvc.setEscenaActualData(res);
        
        this.motor3dSvc.forceResize(); 
        this.sceneSvc.crearSuelo();

        if (res) {
          await this.sceneSvc.cargarEscenaDesdeDatos(res);
        }
        
        if (!this.sessionSvc.isSessionActive(sessionId)) return;

        this.motor3dSvc.getScene().executeWhenReady(() => {
          if (!this.sessionSvc.isSessionActive(sessionId)) return;
          setTimeout(async () => {
            if (!this.sessionSvc.isSessionActive(sessionId)) return;
            
            try {
                await this.playModeSvc.prepararEscenaParaTest(this.gameContext.cameraView(), (msg) => this.cargandoTexto.set(msg));
            } catch(e) {
                console.error(e);
            }
            await this.playModeSvc.estabilizarEntornoVisual(this.gameContext.cameraView());
            await this.playModeSvc.finalizarEntradaTestLive(this.gameContext.cameraView(), true);
            
            this.cargandoEscena.set(false);
            this.revisarSiEsJugable();
          }, 100);
        });
      },
      error: (err) => {
        if (!this.sessionSvc.isSessionActive(sessionId)) return;
        this.cargandoEscena.set(false);
        alert('Error al teletransportar a la plataforma.');
        this.detenerModoPrueba();
      }
    });
  }

  public guardarMapaEnBD(silencioso = false): void {
    const sceneId = this.editorSvc.escenaIdActiva();
    if (!sceneId || !this.editando() || !this.gameContext.authorityProfile().canEdit) return;
    this.estadoGuardado.set('Guardando...');

    const mapData = this.sceneSvc.obtenerDatosParaGuardar(this.editorSvc.escenaActualData());
    
    this.epiApiSvc.guardarMapaEscena(sceneId, mapData).subscribe({
      next: () => {
        this.entityManager.clearDirtyFlags();
        this.entityManager.clearDeletedRecords();
        this.cinematicSvc.deletedCinematics = [];

        this.estadoGuardado.set('Guardado automático ✓');
        this.liveSync.broadcastMapData(mapData);

        if (!silencioso) alert('Plataforma guardada exitosamente');
        setTimeout(() => { if (this.estadoGuardado() === 'Guardado automático ✓') this.estadoGuardado.set(''); }, 3000);
      },
      error: (err) => {
        this.estadoGuardado.set('Error al guardar ⚠️');
      }
    });
  }

  public abrirVentanaPreview(): void {
    const sceneId = this.editorSvc.escenaIdActiva();
    if (!sceneId || !this.isPlayable()) return;
    
    this.guardarMapaEnBD(true);
    
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/jugador/jugar', sceneId], { queryParams: { detached: 'true' } })
    );
    
    window.open(url, '_blank', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
  }

  public revisarSiEsJugable(): void {
    const obj = this.stateSvc.objetoSeleccionado() as AbstractMesh;
    let playable = false;
    
    if (this.gameState.playerRole) {
      playable = true;
    } 
    else if (obj) {
      const entity = this.entityManager.getEntityByMesh(obj);
      if (entity?.characterConfig) playable = true;
    }
    
    if (!playable) {
      const characters = this.entityManager.getEntitiesWithComponent('characterConfig');
      playable = characters.some(c => c.characterConfig?.isPlayable) || characters.length > 0;
    }
    
    if (this.isPlayable() !== playable) {
      this.isPlayable.set(playable);
    }
  }

  public async iniciarModoPrueba(vista: CameraViewMode, skipIntro: boolean = false, roleUid?: string): Promise<void> {
    if (!this.isPlayable()) return;

    this.playbackManager.stop();
    this.guardarMapaEnBD(true);

    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Iniciando Runtime Ready...');

    this.liveLifecycle.captureEditorState();

    if (!skipIntro) {
      if (roleUid) {
        this.gameState.setPlayerRole(roleUid);
      }
      this.transitionSvc.beginTestLive(vista);
    }

    try {
      await this.playModeSvc.prepararEscenaParaTest(vista, (msg, pct) => {
        this.cargandoTexto.set(msg);
      });

      if (skipIntro) {
        await this.playModeSvc.estabilizarEntornoVisual(vista);
        await this.playModeSvc.finalizarEntradaTestLive(vista, true);
      } else {
        this.cargandoTexto.set('Desplazando cámara a posición inicial...');
        await this.playModeSvc.iniciarVueloCamara(vista);

        this.cargandoTexto.set('Estabilizando iluminación y sombras...');
        await this.playModeSvc.estabilizarEntornoVisual(vista, (msg, pct) => {
          this.cargandoTexto.set(msg);
        });

        await this.playModeSvc.finalizarEntradaTestLive(vista, false);
      }

      this.cargandoEscena.set(false);
      this.revisarSiEsJugable();

    } catch (e) {
      console.error('[EditorOrchestrator] Error en transición:', e);
      this.cargandoEscena.set(false);
      this.detenerModoPrueba();
    }
  }

  public async detenerModoPrueba(): Promise<void> {
    if (this.stateSvc.playState() === 'EDITOR') return;
    
    this.inputRouter.setSuppressPointerLockEvents(true);
    this.transitionSvc.beginStopTestLive();

    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Restaurando Editor...');

    this.liveLifecycle.endLiveSession();

    const canSelectHidden = this.gameContext.authorityProfile().canSelectHidden;

    this.playModeSvc.restaurarEscenaPostTest(canSelectHidden);
    this.transitionSvc.finishStopTestLive();
    this.inputRouter.setSuppressPointerLockEvents(false);

    this.cargandoEscena.set(false);
    this.revisarSiEsJugable(); 

    setTimeout(() => {
        this.editorSvc.onMapChanged.next();
        this.toolsSvc.forceResetVisuals();
    }, 100);
  }

  public salirDelEditor(): void {
    this.sessionSvc.invalidateSession();
    this.editando.set(false);
    this.cargandoEscena.set(false);
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    this.toolsSvc.limpiarEstado();
    this.cargarEpisodios();

    this.gameContext.setInteracting(false);
    if (this.fpsInterval) {
      clearInterval(this.fpsInterval);
      this.fpsInterval = null;
    }
  }
}