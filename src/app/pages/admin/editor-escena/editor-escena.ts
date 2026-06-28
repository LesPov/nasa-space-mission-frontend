

import { Component, OnDestroy, OnInit, inject, signal, ChangeDetectorRef, HostListener, effect } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, debounceTime } from 'rxjs';

import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { InspectorEscena } from '../../../components/inspector-escena/inspector-escena';
import { ToolbarEscena } from '../../../components/toolbar-escena/toolbar-escena';
import { MiniVisorEscena } from '../../../components/mini-visor-escena/mini-visor-escena';
import { GlobalTimeline } from '../../../components/global-timeline/global-timeline';
import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiLoading } from '../../../components/ui-loading/ui-loading';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiRadialMenu } from '../../../components/ui-radial-menu/ui-radial-menu';

import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { EditorSceneService } from '../../../services/editor/editor-scene.service';
import { EditorToolsService } from '../../../services/editor/editor-tools.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { LayoutService } from '../../../services/layout.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { GameSession } from '../../../core/engine/runtime/game-session';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { EditorPlayModeService } from '../../../services/editor/editor-play-mode.service';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { EditorLayoutService } from '../../../services/editor/editor-layout.service';
import { EditorKeyboardService } from '../../../services/editor/editor-keyboard.service';
import { InputOrchestratorService } from '../../../core/engine/runtime/systems/input-orchestrator.service';
import { AddObjectModalService } from '../../../services/editor/modals/add-object-modal.service';
import { MissionModalService } from '../../../services/editor/modals/mission-modal.service';
import { AuthService } from '../../../core/services/auth';
import { GameContextService } from '../../../core/engine/session/game-context.service'; 
import { GameMode } from '../../../core/engine/session/game-mode.model'; 
import { AbstractMesh, Tags } from '@babylonjs/core';
import { WindowSyncService } from '../../../core/services/window-sync.service';
import { EditorCinematicService } from '../../../services/editor/editor-cinematic.service';
import { LiveBuilderService } from '../../../services/editor/live-builder.service';

@Component({
  selector: 'app-editor-escena', 
  standalone: true,
  imports: [
    MotorBabylon, InspectorEscena, ToolbarEscena, CommonModule, FormsModule,
    MiniVisorEscena, GlobalTimeline, UiHud, UiInspect, UiLoading, UiMission, UiRadialMenu 
  ],
  templateUrl:'./editor-escena.html',
  styleUrl: './editor-escena.css', 
})
export class EditorEscena implements OnInit, OnDestroy {
  public stateSvc = inject(EditorStateService);
  public editorSvc = inject(EditorMapaService); 
  public motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  public layoutSvc = inject(LayoutService);
  public epiApiSvc = inject(EpisodiosService);
  public gameSession = inject(GameSession);
  private eventBus = inject(GameEventBusService);
  private entityManager = inject(EntityManagerService);
  public runtime = inject(RuntimeEngineService);
  public layoutUI = inject(EditorLayoutService);
  public keyboard = inject(EditorKeyboardService);
  public inputOrchestrator = inject(InputOrchestratorService);
  public addObjSvc = inject(AddObjectModalService);
  public missionSvc = inject(MissionModalService);
  public authSvc = inject(AuthService);
  private gameContext = inject(GameContextService); 
  public cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private windowSync = inject(WindowSyncService);
  public playModeSvc = inject(EditorPlayModeService);
  private cinematicSvc = inject(EditorCinematicService);
  private liveBuilderSvc = inject(LiveBuilderService); 
  public toolsSvc = inject(EditorToolsService);
  public sceneSvc = inject(EditorSceneService);

  public isInteracting = signal(false);
  public editando = false;
  public isPlayable = signal<boolean>(false);

  public get esAdmin(): boolean {
    return this.authSvc.isAdmin();
  }

  public cargandoEscena = signal(false);
  public episodioPendienteCarga: any = null;
  public cargandoTexto = signal('Preparando entorno...');

  public mapaActualNombre = '';
  public episodioCompletoData: any = null;

  public mostrarModalMisionPreview = false;
  public cerrandoModalMision = false; 
  public misionIniciada = false;

  public fps = signal('0');
  public estadoGuardado = signal('Guardado');

  public listaEpisodios: any[] = [];
  public hoveredEpisodio: number | null = null;

  public plataformaActualId: number | null = null;
  public mostrandoCrearPlataforma = false;
  public nuevaPlataformaNombre = '';
  
  public vistaPrueba: 'FPS' | 'TPS' = 'FPS';
  private activeCameraView = 'FPS';

  private fpsInterval: any;
  private autoSaveSub!: Subscription;
  private eventBusSub!: Subscription;
  private reqPlatformSub!: Subscription;
  private mapChangeSub!: Subscription;

  get objNombre() { return this.addObjSvc.objNombre; } set objNombre(v) { this.addObjSvc.objNombre = v; }
  get objTipo() { return this.addObjSvc.objTipo; } set objTipo(v) { this.addObjSvc.objTipo = v; }
  get objRol() { return this.addObjSvc.objRol; } set objRol(v) { this.addObjSvc.objRol = v; }
  get objColor() { return this.addObjSvc.objColor; } set objColor(v) { this.addObjSvc.objColor = v; }
  get objSizeX() { return this.addObjSvc.objSizeX; } set objSizeX(v) { this.addObjSvc.objSizeX = v; }
  get objSizeY() { return this.addObjSvc.objSizeY; } set objSizeY(v) { this.addObjSvc.objSizeY = v; }
  get objSizeZ() { return this.addObjSvc.objSizeZ; } set objSizeZ(v) { this.addObjSvc.objSizeZ = v; }
  get objAssetSeleccionado() { return this.addObjSvc.objAssetSeleccionado; } set objAssetSeleccionado(v) { this.addObjSvc.objAssetSeleccionado = v; }
  get objEsSolido() { return this.addObjSvc.objEsSolido; } set objEsSolido(v) { this.addObjSvc.objEsSolido = v; }
  get objEsSeleccionable() { return this.addObjSvc.objEsSeleccionable; } set objEsSeleccionable(v) { this.addObjSvc.objEsSeleccionable = v; }
  get objMensaje() { return this.addObjSvc.objMensaje; } set objMensaje(v) { this.addObjSvc.objMensaje = v; }
  get objHacerHijo() { return this.addObjSvc.objHacerHijo; } set objHacerHijo(v) { this.addObjSvc.objHacerHijo = v; }
  get listaAssets() { return this.addObjSvc.listaAssets; }
  get archivoSubida() { return this.addObjSvc.archivoSubida; } set archivoSubida(v) { this.addObjSvc.archivoSubida = v; }
  get subiendoAsset() { return this.addObjSvc.subiendoAsset; }

  constructor() {
    effect(() => {
      this.stateSvc.playState();
    });

    effect(() => {
      const obj = this.stateSvc.objetoSeleccionado();
      setTimeout(() => this.revisarSiEsJugable(), 0);
    });
  }

  ngOnInit() {
    this.gameContext.setMode(GameMode.EDITOR); 
    this.cargarEpisodios();
    this.addObjSvc.cargarAssets();

    if (this.esAdmin) {
       this.liveBuilderSvc.initialize();
    }

    this.reqPlatformSub = this.editorSvc.onRequestPlatformChange.subscribe(id => {
      if (this.plataformaActualId !== id && this.stateSvc.playState() === 'EDITOR') {
        this.plataformaActualId = id;
        this.cambiarPlataformaActiva();
      }
    });

    this.eventBusSub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'InteractionStateChanged': 
          this.isInteracting.set(event.payload); 
          break;
        case 'CameraViewChanged':
          this.activeCameraView = event.payload;
          this.stateSvc.modoVistaPrueba = event.payload;
          this.vistaPrueba = event.payload as 'FPS' | 'TPS';
          break;
        case 'GamePaused': 
          if (this.stateSvc.playState() === 'PLAYING') {
              this.cerrandoModalMision = false;
          }
          break;
        case 'ChangeSceneRequested':
          if (this.stateSvc.playState() === 'PLAYING' || this.stateSvc.playState() === 'EDITING_IN_GAME') {
              this.cambiarPlataformaTestLive(event.payload.sceneId);
          }
          break;
      }
      this.cdr.detectChanges();
    });

    this.mapChangeSub = this.editorSvc.onMapChanged.subscribe(() => {
       setTimeout(() => this.revisarSiEsJugable(), 0);
    });

    this.autoSaveSub = this.editorSvc.onMapChanged.pipe(
      debounceTime(1500) 
    ).subscribe(() => {
      try {
        const state = this.stateSvc.playState();
        if (this.esAdmin && this.editando && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
          this.guardarMapaEnBD(true); 
        }
      } catch (e) {
        console.error('Error durante autoguardado:', e);
      }
    });
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) { this.layoutUI.onMouseMove(event); }

  @HostListener('window:mouseup')
  onMouseUp() { this.layoutUI.onMouseUp(); }

  @HostListener('window:keydown', ['$event'])
  manejarAtajos(event: KeyboardEvent) { 
    if (event.key === 'Escape') {
      if (this.mostrarModalMisionPreview) {
        this.mostrarModalMisionPreview = false;
        this.cdr.detectChanges();
        return;
      }
      if (this.stateSvc.previewMissionModal()) {
        this.stateSvc.previewMissionModal.set(false);
        this.cdr.detectChanges();
        return;
      }
    }
    this.keyboard.handleKeydown(event, this.editando); 
  }

  revisarSiEsJugable(): void {
    const obj = this.stateSvc.objetoSeleccionado() as AbstractMesh;
    let playable = false;
    
    if (obj) {
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

  toggleNieblaTemporal() {
    this.stateSvc.fogDesactivadoTemporalmente.set(!this.stateSvc.fogDesactivadoTemporalmente());
    setTimeout(() => this.motor3dSvc.forceResize(), 10);
    this.editorSvc.onMapChanged.next();
  }

  togglePreviewMission() {
    const state = this.stateSvc.playState();
    if (state === 'EDITING_IN_GAME' || state === 'PLAYING') {
      this.mostrarModalMisionPreview = !this.mostrarModalMisionPreview;
    } else {
      this.stateSvc.previewMissionModal.set(!this.stateSvc.previewMissionModal());
    }
  }

  jugarModoFinal(episodio: any) {
    this.router.navigate(['/jugador/jugar', episodio.initialScene?.id || episodio.id]);
  }

  entrarAlEditor(episodio: any) {
    this.episodioPendienteCarga = episodio;
    this.layoutSvc.ocultarMenu();
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Cargando herramientas de creador...');
    
    this.epiApiSvc.obtenerPlataformasEscena(episodio.id).subscribe({
       next: (plataformas) => {
         this.editorSvc.plataformasEscena.set(plataformas);
         const sceneId = episodio.initialScene?.id || plataformas[0]?.id || episodio.id;
         this.plataformaActualId = sceneId;
         this.procesarCarga(episodio, sceneId);
       },
       error: (err) => {
         console.error('Error cargando plataformas', err);
         const sceneId = episodio.initialScene?.id || episodio.id;
         this.plataformaActualId = sceneId;
         this.procesarCarga(episodio, sceneId);
       }
    });
  }

  private async procesarCarga(episodio: any, sceneId: number) {
    this.mapaActualNombre = episodio.title;
    
    if (!this.editando) {
      this.editando = true;
      this.cdr.detectChanges(); 
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    this.epiApiSvc.obtenerEscenaCompleta(sceneId).subscribe({
      next: async (res) => {
        this.episodioCompletoData = res; 
        this.editorSvc.escenaIdActiva.set(sceneId);
        this.editorSvc.escenaActualData.set(res);
        this.editorSvc.episodioActualData.set(episodio);
        
        this.cargandoTexto.set('Preparando modelos, texturas y físicas 3D...');
        
        this.motor3dSvc.forceResize(); 
        this.toolsSvc.activarEventosEditor();
        this.sceneSvc.crearSuelo();

        if(res) {
          await this.sceneSvc.cargarEscenaDesdeDatos(res);
        }

        this.motor3dSvc.getScene().executeWhenReady(() => {
          this.cargandoEscena.set(false);
          this.episodioPendienteCarga = null;
          this.revisarSiEsJugable(); 
          this.cdr.detectChanges(); 
          
          if (!this.fpsInterval) {
            this.fpsInterval = setInterval(() => {
              this.fps.set(this.motor3dSvc.getCurrentFps().toFixed(0));
            }, 500);
          }
        });
      },
      error: (err) => {
        this.cargandoEscena.set(false);
        alert('Error conectando con el servidor. No se pudo cargar la escena.');
      }
    });
  }

  abrirModalCrearPlataforma() {
    this.nuevaPlataformaNombre = '';
    this.mostrandoCrearPlataforma = true;
  }

  confirmarCrearPlataforma() {
    if (!this.nuevaPlataformaNombre.trim()) return;
    const epId = this.editorSvc.episodioActualData()?.id;
    if (!epId) return;

    this.epiApiSvc.crearPlataformaEscena(epId, this.nuevaPlataformaNombre).subscribe({
      next: (nuevaEscena) => {
         const actuales = this.editorSvc.plataformasEscena();
         this.editorSvc.plataformasEscena.set([...actuales, nuevaEscena]);
         this.mostrandoCrearPlataforma = false;
         
         this.plataformaActualId = nuevaEscena.id;
         this.cambiarPlataformaActiva();
      },
      error: (err) => alert('Error creando la plataforma')
    });
  }

  cambiarPlataformaActiva() {
    if (!this.plataformaActualId) return;
    this.guardarMapaEnBD(true); 
    
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Cambiando de zona...');
    this.procesarCarga(this.editorSvc.episodioActualData(), this.plataformaActualId);
  }

  async cambiarPlataformaTestLive(sceneId: number) {
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Teletransportando a nueva zona...');
    
    this.runtime.stopTestSession();
    this.plataformaActualId = sceneId;
    
    this.entityManager.clear();

    this.epiApiSvc.obtenerEscenaCompleta(sceneId).subscribe({
      next: async (res) => {
        this.episodioCompletoData = res; 
        this.editorSvc.escenaIdActiva.set(sceneId);
        this.editorSvc.escenaActualData.set(res);
        
        this.motor3dSvc.forceResize(); 
        this.sceneSvc.crearSuelo();

        if(res) {
          await this.sceneSvc.cargarEscenaDesdeDatos(res);
        }

        this.motor3dSvc.getScene().executeWhenReady(() => {
          setTimeout(() => {
            (this.playModeSvc as any).testearEscena(this.vistaPrueba, true);
            this.cargandoEscena.set(false);
            this.revisarSiEsJugable();
            this.cdr.detectChanges(); 
          }, 100);
        });
      },
      error: (err) => {
        this.cargandoEscena.set(false);
        alert('Error al teletransportar a la plataforma.');
        this.detenerModoPrueba();
      }
    });
  }

  onCanvasClick() {
    if (this.stateSvc.playState() === 'PLAYING' && !this.gameSession.pointerLocked() && !this.isInteracting() && !this.mostrarModalMisionPreview) {
      this.inputOrchestrator.lockPointer();
    }
  }

  cargarEpisodios() {
    this.epiApiSvc.obtenerEpisodios().subscribe({
      next: (res) => { this.listaEpisodios = res; this.cdr.detectChanges(); },
      error: (err) => console.error('Error al cargar episodios', err)
    });
  }

  seleccionarArchivoSubida(event: any) { this.addObjSvc.seleccionarArchivoSubida(event); }
  subirNuevoAsset() { this.addObjSvc.subirNuevoAsset(() => this.cdr.detectChanges()); }
  onRolChange() { this.addObjSvc.onRolChange(); }
  onTipoChange() { this.addObjSvc.onTipoChange(); }
  crearObjeto3D() { this.addObjSvc.crearObjeto3D(); }
  cerrarModalObjeto() { this.addObjSvc.cerrarModalObjeto(); }

  crearNuevoEpisodio() {
    if (!this.missionSvc.newMapTitle) return;
    this.epiApiSvc.crearEpisodio(this.missionSvc.newMapTitle, this.missionSvc.newMapDesc).subscribe({
      next: (res) => {
        const episodeData = res.episode || res;
        this.listaEpisodios.unshift(episodeData);
        this.missionSvc.cerrarCrearMapa();
        
        if (res.initialScene) {
          episodeData.initialScene = res.initialScene;
        }
        this.entrarAlEditor(episodeData);
      },
      error: (err) => alert('Error creando episodio')
    });
  }

  guardarMapaEnBD(silencioso = false) {
    const sceneId = this.editorSvc.escenaIdActiva();
    if (!sceneId || !this.editando || !this.esAdmin) return;
    this.estadoGuardado.set('Guardando...');

    const mapData = this.sceneSvc.obtenerDatosParaGuardar(this.editorSvc.escenaActualData());
    
    this.epiApiSvc.guardarMapaEscena(sceneId, mapData).subscribe({
      next: () => {
        this.entityManager.clearDirtyFlags();
        this.entityManager.clearDeletedRecords();
        
        this.cinematicSvc.deletedCinematics = [];

        this.estadoGuardado.set('Guardado automático ✓');
        
        this.windowSync.broadcast({
          type: 'SYNC_MAP_DATA',
          payload: mapData
        });

        if (!silencioso) alert('Plataforma guardada exitosamente');
        setTimeout(() => { if (this.estadoGuardado() === 'Guardado automático ✓') this.estadoGuardado.set(''); }, 3000);
      },
      error: (err) => {
        this.estadoGuardado.set('Error al guardar ⚠️');
      }
    });
  }

  abrirVentanaPreview() {
    const sceneId = this.editorSvc.escenaIdActiva();
    if (!sceneId || !this.isPlayable()) return;
    
    this.guardarMapaEnBD(true);
    
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/jugador/jugar', sceneId], { queryParams: { detached: 'true' } })
    );
    
    window.open(url, '_blank', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
  }

  iniciarModoPrueba() {
    if (!this.isPlayable()) return;
    this.guardarMapaEnBD(true);
    
    this.mostrarModalMisionPreview = false;
    this.misionIniciada = true;
    
    (this.playModeSvc as any).testearEscena(this.vistaPrueba);
  }

  comenzarMisionPreview() {
    this.cerrandoModalMision = true;
    
    if (this.activeCameraView === 'TPS') this.runtime.toggleCameraUser(false, 60); 
    else this.runtime.toggleCameraUser(true, 60);

    this.inputOrchestrator.lockPointer();

    setTimeout(() => {
      this.misionIniciada = true; 
      this.mostrarModalMisionPreview = false;
      this.cerrandoModalMision = false;
      this.cdr.detectChanges(); 
    }, 2000); 
  }

  handleMissionStart() {
    if (this.stateSvc.previewMissionModal() && !this.mostrarModalMisionPreview) {
       this.stateSvc.previewMissionModal.set(false);
    } else {
       this.comenzarMisionPreview();
    }
  }

  handleMissionExit() {
    if (this.stateSvc.previewMissionModal() && !this.mostrarModalMisionPreview) {
       this.stateSvc.previewMissionModal.set(false);
    } else {
       this.detenerModoPrueba();
    }
  }

  async detenerModoPrueba() {
    if (this.stateSvc.playState() === 'EDITOR') return;
    
    this.mostrarModalMisionPreview = false;
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Restaurando Editor...');
    this.cdr.detectChanges();

    await (this.playModeSvc as any).detenerPrueba();

    this.cargandoEscena.set(false);
    this.revisarSiEsJugable(); 
    this.cdr.detectChanges();

    setTimeout(() => this.editorSvc.onMapChanged.next(), 500);
  }

  cerrarInteraccion() {
    this.runtime.cerrarInteraccion();
  }

  salirDelEditor() {
    this.editando = false;
    this.cargandoEscena.set(false);
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    this.toolsSvc.limpiarEstado();
    this.cargarEpisodios();

    this.isInteracting.set(false);
    if (this.fpsInterval) {
        clearInterval(this.fpsInterval);
        this.fpsInterval = null;
    }
  }

  ngOnDestroy(): void {
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    this.toolsSvc.limpiarEstado();
    this.inputOrchestrator.disposeListeners();
    this.liveBuilderSvc.destroy(); 
    if (this.fpsInterval) clearInterval(this.fpsInterval);
    if (this.autoSaveSub) this.autoSaveSub.unsubscribe();
    if (this.eventBusSub) this.eventBusSub.unsubscribe();
    if (this.reqPlatformSub) this.reqPlatformSub.unsubscribe();
    if (this.mapChangeSub) this.mapChangeSub.unsubscribe();
  }
}
