

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

import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { Motor3dService } from '../../../services/motor-3d.service';
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
import { AbstractMesh } from '@babylonjs/core';

// 🔥 FIX: Inyección del WindowSyncService
import { WindowSyncService } from '../../../core/services/window-sync.service';

@Component({
  selector: 'app-editor-escena', 
  standalone: true,
  imports: [
    MotorBabylon, InspectorEscena, ToolbarEscena, CommonModule, FormsModule,
    MiniVisorEscena, GlobalTimeline, UiHud, UiInspect, UiLoading, UiMission
  ],
  templateUrl: './editor-escena.html',
  styleUrl: './editor-escena.css', 
})
export class EditorEscena implements OnInit, OnDestroy {
  public stateSvc = inject(EditorStateService);
  public editorSvc = inject(EditorMapaService);
  public motor3dSvc = inject(Motor3dService);
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
  public cdr = inject(ChangeDetectorRef);
  private router = inject(Router);

  // 🔥 FIX: Instancia de Window Sync
  private windowSync = inject(WindowSyncService);

  public playModeSvc = inject(EditorPlayModeService);

  public isInteracting = signal(false);
  public editando = false;

  public get esAdmin(): boolean {
    return this.authSvc.isAdmin();
  }

  public cargandoEscena = signal(false);
  public episodioPendienteCarga: any = null;
  public cargandoTexto = signal('Preparando entorno...');

  public episodioIdActivo = 0;
  public mapaActualNombre = '';
  public episodioCompletoData: any = null;

  public mostrarModalMisionPreview = false;
  public cerrandoModalMision = false; 
  public misionIniciada = false;

  public fps = signal('0');
  public estadoGuardado = signal('Guardado');

  public listaEpisodios: any[] = [];
  public hoveredEpisodio: number | null = null;
  
  public vistaPrueba: 'FPS' | 'TPS' = 'FPS';
  private activeCameraView = 'FPS';

  private fpsInterval: any;
  private autoSaveSub!: Subscription;
  private eventBusSub!: Subscription;

  // Acceso directo a variables de servicios para el HTML sin engordar este controlador
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
      this.editorSvc.playState();
    });
  }

  ngOnInit() {
    this.cargarEpisodios();
    this.addObjSvc.cargarAssets();

    this.eventBusSub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'InteractionStateChanged': 
          this.isInteracting.set(event.payload); 
          break;
        case 'CameraViewChanged':
          this.activeCameraView = event.payload;
          this.stateSvc.modoVistaPrueba = event.payload;
          break;
        case 'GamePaused': 
          if (this.editorSvc.playState() === 'PLAYING') {
              this.cerrandoModalMision = false;
          }
          break;
      }
      this.cdr.detectChanges();
    });

    this.autoSaveSub = this.editorSvc.onMapChanged.pipe(
      debounceTime(1500) 
    ).subscribe(() => {
      try {
        const state = this.editorSvc.playState();
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

  toggleNieblaTemporal() {
    this.stateSvc.fogDesactivadoTemporalmente.set(!this.stateSvc.fogDesactivadoTemporalmente());
    setTimeout(() => this.motor3dSvc.forzarRedimension(), 10);
    this.editorSvc.triggerUpdate();
  }

  togglePreviewMission() {
    const state = this.editorSvc.playState();
    if (state === 'EDITING_IN_GAME' || state === 'PLAYING') {
      this.mostrarModalMisionPreview = !this.mostrarModalMisionPreview;
    } else {
      this.stateSvc.previewMissionModal.set(!this.stateSvc.previewMissionModal());
    }
  }

  jugarModoFinal(episodio: any) {
    this.router.navigate(['/jugador/jugar', episodio.id]);
  }

  entrarAlEditor(episodio: any) {
    this.episodioPendienteCarga = episodio;
    this.layoutSvc.ocultarMenu();
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Cargando herramientas de creador...');
    this.procesarCarga(episodio);
  }

  private procesarCarga(episodio: any) {
    this.episodioIdActivo = episodio.id;
    this.mapaActualNombre = episodio.title;
    this.editando = true;

    this.epiApiSvc.obtenerEpisodio(episodio.id).subscribe({
      next: async (res) => {
        this.episodioCompletoData = res?.episode || res; 
        this.editorSvc.episodioActualData.set(this.episodioCompletoData);
        
        this.cargandoTexto.set('Preparando modelos, texturas y físicas 3D...');
        
        this.motor3dSvc.forzarRedimension(); 
        this.editorSvc.activarEventosEditor();
        this.editorSvc.crearSuelo();

        if(res) {
          await this.editorSvc.cargarEscenaDesdeDatos(res);
        }

        this.motor3dSvc.scene.executeWhenReady(() => {
          this.cargandoEscena.set(false);
          this.episodioPendienteCarga = null;
          this.cdr.detectChanges(); 
          
          this.fpsInterval = setInterval(() => {
            this.fps.set(this.motor3dSvc.currentFps.toFixed(0));
          }, 500);
        });
      },
      error: (err) => {
        this.cargandoEscena.set(false);
        alert('Error conectando con el servidor. No se pudo cargar la escena.');
      }
    });
  }

  onCanvasClick() {
    if (this.editorSvc.playState() === 'PLAYING' && !this.gameSession.pointerLocked() && !this.isInteracting() && !this.mostrarModalMisionPreview) {
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
        this.listaEpisodios.unshift(res);
        this.missionSvc.cerrarCrearMapa();
        this.entrarAlEditor(res);
      },
      error: (err) => alert('Error creando episodio')
    });
  }

  guardarMapaEnBD(silencioso = false) {
    if (!this.episodioIdActivo || !this.editando || !this.esAdmin) return;
    this.estadoGuardado.set('Guardando...');

    const mapData = this.editorSvc.obtenerDatosParaGuardar();
    const dataEpi = this.editorSvc.episodioActualData();
    
    const payload = {
       ...mapData,
       title: dataEpi?.title,
       description: dataEpi?.description
    };

    this.epiApiSvc.guardarMapa(this.episodioIdActivo, payload).subscribe({
      next: () => {
        this.entityManager.clearDirtyFlags();
        this.entityManager.clearDeletedRecords();

        this.estadoGuardado.set('Guardado automático ✓');
        
        // 🔥 FIX: Emitimos la actualización a la ventana esclava
        this.windowSync.broadcast({
          type: 'SYNC_MAP_DATA',
          payload: payload
        });

        if (!silencioso) alert('Mapa guardado exitosamente');
        setTimeout(() => { if (this.estadoGuardado() === 'Guardado automático ✓') this.estadoGuardado.set(''); }, 3000);
      },
      error: (err) => {
        this.estadoGuardado.set('Error al guardar ⚠️');
      }
    });
  }

  esObjetoJugable(): boolean {
    const obj = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!obj) return false;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (!entity) return false;
    return !!entity.characterConfig;
  }

  // 🔥 FIX: Función Dual-Window 
  abrirVentanaPreview() {
    if (!this.episodioIdActivo || !this.esObjetoJugable()) return;
    
    this.guardarMapaEnBD(true);
    
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/jugador/jugar', this.episodioIdActivo], { queryParams: { detached: 'true' } })
    );
    
    // Abre ventana a 1280x720 para testear
    window.open(url, '_blank', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
  }

  iniciarModoPrueba() {
    if (!this.esObjetoJugable()) return;
    this.guardarMapaEnBD(true);
    
    this.mostrarModalMisionPreview = false;
    this.misionIniciada = true;
    
    this.playModeSvc.testearEscena(this.vistaPrueba);
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
    if (this.editorSvc.state.previewMissionModal() && !this.mostrarModalMisionPreview) {
       this.editorSvc.state.previewMissionModal.set(false);
    } else {
       this.comenzarMisionPreview();
    }
  }

  handleMissionExit() {
    if (this.editorSvc.state.previewMissionModal() && !this.mostrarModalMisionPreview) {
       this.editorSvc.state.previewMissionModal.set(false);
    } else {
       this.detenerModoPrueba();
    }
  }

  async detenerModoPrueba() {
    if (this.editorSvc.playState() === 'EDITOR') return;
    
    this.mostrarModalMisionPreview = false;
    this.cargandoEscena.set(true);
    this.cargandoTexto.set('Restaurando Editor...');
    this.cdr.detectChanges();

    await this.playModeSvc.detenerPrueba();

    this.cargandoEscena.set(false);
    this.cdr.detectChanges();

    setTimeout(() => this.editorSvc.triggerUpdate(), 500);
  }

  cerrarInteraccion() {
    this.runtime.cerrarInteraccion();
  }

  salirDelEditor() {
    this.editando = false;
    this.cargandoEscena.set(false);
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    this.cargarEpisodios();

    this.isInteracting.set(false);
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }

  ngOnDestroy(): void {
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    this.inputOrchestrator.disposeListeners();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
    if (this.autoSaveSub) this.autoSaveSub.unsubscribe();
    if (this.eventBusSub) this.eventBusSub.unsubscribe();
  }
}