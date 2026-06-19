
// src/app/pages/admin/editor-escena/editor-escena.ts

import { Component, OnDestroy, OnInit, inject, signal, ChangeDetectorRef, HostListener, effect } from '@angular/core';
import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { InspectorEscena } from '../../../components/inspector-escena/inspector-escena';
import { ToolbarEscena } from '../../../components/toolbar-escena/toolbar-escena';
import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { Motor3dService } from '../../../services/motor-3d.service';
import { LayoutService } from '../../../services/layout.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MiniVisorEscena } from '../../../components/mini-visor-escena/mini-visor-escena';
import { debounceTime, Subscription } from 'rxjs';
import { AbstractMesh } from '@babylonjs/core';
import { GlobalTimeline } from '../../../components/global-timeline/global-timeline';
import { GameSession } from '../../../core/engine/runtime/game-session';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { EditorPlayModeService } from '../../../services/editor/editor-play-mode.service';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { EditorLayoutService } from '../../../services/editor/editor-layout.service';
import { EditorKeyboardService } from '../../../services/editor/editor-keyboard.service';
import { InputOrchestratorService } from '../../../core/engine/runtime/systems/input-orchestrator.service';

import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiLoading } from '../../../components/ui-loading/ui-loading';

@Component({
  selector: 'app-editor-escena', 
  standalone: true,
  imports: [
    MotorBabylon, InspectorEscena, ToolbarEscena, CommonModule, FormsModule,
    MiniVisorEscena, GlobalTimeline, UiHud, UiInspect, UiLoading
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
  public cdr = inject(ChangeDetectorRef);

  public playModeSvc = inject(EditorPlayModeService);

  public isInteracting = signal(false);

  public editando = false;
  public esAdmin: boolean = false;

  public cargandoEscena = false;
  public episodioPendienteCarga: any = null;
  public cargandoTexto = 'Preparando entorno...';

  public episodioIdActivo = 0;
  public mapaActualNombre = '';
  public fps = signal('0');
  public estadoGuardado = signal('Guardado');

  public listaEpisodios: any[] = [];
  public hoveredEpisodio: number | null = null;
  public showModalMap = false;
  public nuevoTitulo = '';
  public nuevaDesc = '';

  public listaAssets: any[] = [];
  public archivoSubida: File | null = null;
  public subiendoAsset = false;

  public objNombre: string = 'Objeto_01';
  public objTipo: string = 'cube';
  public objRol: string = 'prop';
  public objColor: string = '#ffffff';
  public objSizeX: number = 1;
  public objSizeY: number = 1;
  public objSizeZ: number = 1;
  public objAssetSeleccionado: any = null;
  public objEsSolido: boolean = true;
  public objEsSeleccionable: boolean = true;
  public objMensaje: string = '';
  public objHacerHijo: boolean = true;

  public vistaPrueba: 'FPS' | 'TPS' = 'FPS';
  private activeCameraView = 'FPS';

  private fpsInterval: any;
  private autoSaveSub!: Subscription;
  private eventBusSub!: Subscription;

  constructor() {
    effect(() => {
      this.editorSvc.playState();
    });
  }

  ngOnInit() {
    this.esAdmin = this.editorSvc.checkIsAdmin();
    this.cargarEpisodios();
    this.cargarAssets();

    this.eventBusSub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'InteractionStateChanged': 
          this.isInteracting.set(event.payload); 
          break;
        case 'CameraViewChanged':
          this.activeCameraView = event.payload;
          this.stateSvc.modoVistaPrueba = event.payload;
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
  onMouseMove(event: MouseEvent) {
    this.layoutUI.onMouseMove(event);
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    this.layoutUI.onMouseUp();
  }

  @HostListener('window:keydown', ['$event'])
  manejarAtajos(event: KeyboardEvent) {
    this.keyboard.handleKeydown(event, this.editando);
  }

  toggleNieblaTemporal() {
    this.stateSvc.fogDesactivadoTemporalmente.set(!this.stateSvc.fogDesactivadoTemporalmente());
    setTimeout(() => this.motor3dSvc.forzarRedimension(), 10);
    this.editorSvc.triggerUpdate();
  }

  jugarModoFinal(episodio: any) {
    // 🔥 SOLUCIÓN: Cambiado de /jugador/juego/ a /jugador/jugar/ para que coincida con app.routes.ts
    window.open(`/jugador/jugar/${episodio.id}`, '_blank');
  }

  entrarAlEditor(episodio: any) {
    this.episodioPendienteCarga = episodio;
    this.layoutSvc.ocultarMenu();
    this.cargandoEscena = true;
    this.cargandoTexto = 'Cargando herramientas de creador...';
    this.procesarCarga(episodio);
  }

  private procesarCarga(episodio: any) {
    this.episodioIdActivo = episodio.id;
    this.mapaActualNombre = episodio.title;
    this.editando = true;

    this.epiApiSvc.obtenerEpisodio(episodio.id).subscribe({
      next: async (res) => {
        setTimeout(() => {
            this.cargandoTexto = 'Preparando modelos, texturas y físicas 3D...';
            this.cdr.detectChanges();
        }, 0);
        
        this.motor3dSvc.forzarRedimension(); 
        this.editorSvc.activarEventosEditor();
        this.editorSvc.crearSuelo();

        if(res) {
          await this.editorSvc.cargarEscenaDesdeDatos(res);
        }

        this.motor3dSvc.scene.executeWhenReady(() => {
          this.cargandoEscena = false;
          this.episodioPendienteCarga = null;
          this.cdr.detectChanges(); 
          
          this.fpsInterval = setInterval(() => {
            this.fps.set(this.motor3dSvc.currentFps.toFixed(0));
          }, 500);
        });
      },
      error: (err) => {
        this.cargandoEscena = false;
        alert('Error conectando con el servidor. No se pudo cargar la escena.');
      }
    });
  }

  onCanvasClick() {
    if (this.editorSvc.playState() === 'PLAYING' && !this.gameSession.pointerLocked() && !this.isInteracting()) {
      this.inputOrchestrator.lockPointer();
    }
  }

  cargarEpisodios() {
    this.epiApiSvc.obtenerEpisodios().subscribe({
      next: (res) => { this.listaEpisodios = res; this.cdr.detectChanges(); },
      error: (err) => console.error('Error al cargar episodios', err)
    });
  }

  cargarAssets() {
    this.epiApiSvc.obtenerAssets().subscribe({
      next: (res) => {
        this.listaAssets = res.filter((a:any) => 
          a.type === 'model_glb' || a.type === 'video_mp4' || 
          a.path.endsWith('.mp4') || a.path.endsWith('.webm') || 
          a.type === 'texture_png' || a.type === 'texture_jpg' || 
          a.path.endsWith('.png') || a.path.endsWith('.jpg') || a.path.endsWith('.jpeg')
        );
      },
      error: (err) => console.error('Error al cargar assets', err)
    });
  }

  seleccionarArchivoSubida(event: any) {
    if (event.target.files && event.target.files.length > 0) this.archivoSubida = event.target.files[0];
  }

  subirNuevoAsset() {
    if (!this.archivoSubida) return;
    this.subiendoAsset = true;
    this.epiApiSvc.subirAsset(this.archivoSubida).subscribe({
      next: (res) => {
        this.subiendoAsset = false;
        this.archivoSubida = null;
        alert('Archivo subido correctamente');
        this.cargarAssets();
      },
      error: (err) => {
        this.subiendoAsset = false;
        alert('Error al subir el archivo. Revisa la consola.');
      }
    });
  }

  crearNuevoEpisodio() {
    if (!this.nuevoTitulo) return;
    this.epiApiSvc.crearEpisodio(this.nuevoTitulo, this.nuevaDesc).subscribe({
      next: (res) => {
        this.listaEpisodios.unshift(res);
        this.showModalMap = false;
        this.nuevoTitulo = '';
        this.nuevaDesc = '';
        this.entrarAlEditor(res);
      },
      error: (err) => alert('Error creando episodio')
    });
  }

  guardarMapaEnBD(silencioso = false) {
    if (!this.episodioIdActivo || !this.editando || !this.esAdmin) return;
    this.estadoGuardado.set('Guardando...');

    const mapData = this.editorSvc.obtenerDatosParaGuardar();
    this.epiApiSvc.guardarMapa(this.episodioIdActivo, mapData).subscribe({
      next: () => {
        this.entityManager.clearDirtyFlags();
        this.entityManager.clearDeletedRecords();

        this.estadoGuardado.set('Guardado automático ✓');
        if (!silencioso) alert('Mapa guardado exitosamente');
        setTimeout(() => { if (this.estadoGuardado() === 'Guardado automático ✓') this.estadoGuardado.set(''); }, 3000);
      },
      error: (err) => {
        this.estadoGuardado.set('Error al guardar ⚠️');
      }
    });
  }

  onRolChange() {
    if (this.objRol === 'npc' || this.objRol === 'spawn_point') this.objTipo = 'model';
  }

  onTipoChange() {
    if (this.objTipo === 'trigger' || this.objTipo === 'trigger_compuesto') {
      this.objRol = 'prop'; this.objEsSolido = false; this.objEsSeleccionable = true;
    } else if (this.objTipo.startsWith('light_')) {
      this.objRol = 'prop'; this.objColor = '#ffffff'; this.objEsSolido = false; this.objEsSeleccionable = true;
    } else if (this.objTipo === 'bubble' || this.objTipo === 'video_plane' || this.objTipo === 'image_plane') {
      this.objRol = 'prop'; this.objEsSolido = false; this.objEsSeleccionable = true;
    } else if (this.objTipo !== 'model') {
      this.objRol = 'prop';
    }
    if (this.objTipo !== 'model' && !this.objTipo.startsWith('light_') && this.objTipo !== 'video_plane' && this.objTipo !== 'image_plane') {
      this.objAssetSeleccionado = null;
    }
  }

  crearObjeto3D() {
    if(!this.objNombre) return;
    const parent = this.objHacerHijo ? (this.editorSvc.objetoSeleccionado() as AbstractMesh | null) : null;
    this.editorSvc.agregarObjetoCustom(
      this.objTipo, this.objNombre, this.objRol, this.objColor, this.objSizeX, this.objSizeY, this.objSizeZ,
      this.objAssetSeleccionado, this.objEsSolido, this.objEsSeleccionable, this.objMensaje, parent
    );
    this.cerrarModalObjeto();
  }

  cerrarModalObjeto() {
    this.editorSvc.showAddObjectModal.set(false);
    this.objNombre = 'Objeto_' + Math.floor(Math.random() * 100);
    this.objTipo = 'cube'; this.objRol = 'prop'; this.objColor = '#ffffff';
    this.objSizeX = 1; this.objSizeY = 1; this.objSizeZ = 1;
    this.objAssetSeleccionado = null; this.archivoSubida = null;
    this.objEsSolido = true; this.objEsSeleccionable = true; this.objMensaje = ''; this.objHacerHijo = true;
  }

  esObjetoJugable(): boolean {
    const obj = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!obj) return false;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (!entity) return false;
    return entity.rol === 'spawn_point' || entity.rol === 'npc';
  }

  iniciarModoPrueba() {
    if (!this.esObjetoJugable()) return;
    this.guardarMapaEnBD(true);
    this.inputOrchestrator.lockPointer();
    this.playModeSvc.testearEscena(this.vistaPrueba);
  }

  async detenerModoPrueba() {
    if (this.editorSvc.playState() === 'EDITOR') return;
    
    this.cargandoEscena = true;
    this.cargandoTexto = 'Restaurando Editor...';
    this.cdr.detectChanges();

    await this.playModeSvc.detenerPrueba();

    this.cargandoEscena = false;
    this.cdr.detectChanges();

    setTimeout(() => this.editorSvc.triggerUpdate(), 500);
  }

  cerrarInteraccion() {
    this.runtime.cerrarInteraccion();
  }

  salirDelEditor() {
    this.editando = false;
    this.cargandoEscena = false;
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
