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

import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiLoading } from '../../../components/ui-loading/ui-loading';

@Component({
  selector: 'app-editor-escena',
  standalone: true,
  imports: [
    MotorBabylon, InspectorEscena, ToolbarEscena, CommonModule, FormsModule, 
    MiniVisorEscena, GlobalTimeline, UiHud, UiInspect, UiMission, UiLoading
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
  public cdr = inject(ChangeDetectorRef);
  
  public playModeSvc = inject(EditorPlayModeService);

  public isInteracting = signal<boolean>(false);

  public editando = false;
  public esAdmin: boolean = false;
  
  public modalSeleccionModo = false;
  public cargandoEscena = false;
  public modalMisionUsuario = false; 
  public misionIniciada = false; 
  public cerrandoModalUsuario = false; 
  public episodioPendienteCarga: any = null;
  public cargandoTexto = 'Preparando entorno...';
  
  public episodioIdActivo = 0;
  public mapaActualNombre = '';
  public fps = signal<string>('0');
  public estadoGuardado = signal<string>('Guardado');
  
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
  
  public showInspector = true;
  public showTimeline = true;
  public inspectorWidth = 350; 
  public isResizing = false;
  public timelineHeight = 30; 
  public isResizingTimeline = false;

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
        case 'GameStarted':
          if (this.editorSvc.rolSimulado() === 'user') {
            this.modalMisionUsuario = true;
            this.misionIniciada = false;
            this.cerrandoModalUsuario = false;
          }
          break;
        case 'GamePaused':
          if (this.misionIniciada && !this.isInteracting() && this.editorSvc.rolSimulado() === 'user') {
             this.modalMisionUsuario = true;
             this.cerrandoModalUsuario = false;
             if (this.activeCameraView === 'FPS') {
                this.runtime.toggleCameraUser(false, 45);
             }
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
        if (this.esAdmin && this.editorSvc.rolSimulado() === 'admin' && this.editando && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
          this.guardarMapaEnBD(true); 
        }
      } catch (e) {
        console.error('Error durante autoguardado:', e);
      }
    });
  }

  // 🔥 NUEVA FUNCIÓN PARA EL BOTÓN DE NIEBLA (Fuerza limpiar Highlight)
  toggleNieblaTemporal() {
    this.stateSvc.fogDesactivadoTemporalmente.set(!this.stateSvc.fogDesactivadoTemporalmente());
    this.recalcularMotor(); 
    this.editorSvc.triggerUpdate(); // Obliga al highlight a refrescarse
  }

  entrarAlEditor(episodio: any) {
    this.episodioPendienteCarga = episodio;
    this.layoutSvc.ocultarMenu();
    
    if (this.esAdmin) {
      this.modalSeleccionModo = true;
      this.cargandoEscena = false;
    } else {
      this.confirmarModoYContinuar('user');
    }
  }

  confirmarModoYContinuar(modo: 'admin' | 'user') {
    this.modalSeleccionModo = false;
    this.cargandoEscena = true;
    this.layoutSvc.ocultarMenu(); 
    this.cargandoTexto = modo === 'admin' ? 'Cargando herramientas de creador...' : 'Conectando con el mundo...';
    
    this.editorSvc.rolSimulado.set(modo);
    this.procesarCarga(this.episodioPendienteCarga);
  }

  private procesarCarga(episodio: any) {
    this.episodioIdActivo = episodio.id;
    this.mapaActualNombre = episodio.title;
    this.editando = true; 
    this.misionIniciada = false; 
    this.cerrandoModalUsuario = false;
    
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
          if (this.editorSvc.rolSimulado() === 'user') {
            const spawnEntity = this.entityManager.getEntitiesByRol('spawn_point')[0] || 
                                this.entityManager.getEntitiesByRol('npc')[0];
            
            if (spawnEntity && spawnEntity.view) {
              this.editorSvc.seleccionarObjeto(spawnEntity.view);
              this.vistaPrueba = 'FPS';
              this.iniciarModoPrueba();
              
              this.cargandoEscena = false;
              this.episodioPendienteCarga = null;
              this.cdr.detectChanges();
            } else {
              alert('Este episodio aún no tiene un punto de aparición (Spawn Point). Vuelve más tarde.');
              this.salirDelEditor();
            }
          } else {
            this.cargandoEscena = false;
            this.episodioPendienteCarga = null;
            this.cdr.detectChanges(); 
          }
          
          this.fpsInterval = setInterval(() => {
            this.fps.set(this.motor3dSvc.currentFps.toFixed(0));
          }, 500);
        });
      },
      error: (err) => {
        this.cargandoEscena = false;
        this.modalSeleccionModo = false;
        alert('Error conectando con el servidor. No se pudo cargar la escena.');
      }
    });
  }

  manejarSalidaDeMision() {
     if (this.editorSvc.rolSimulado() === 'admin') {
         this.detenerModoPrueba();
         this.modalMisionUsuario = false;
     } else {
         this.salirDelEditor();
     }
  }

  comenzarMisionUsuario() {
    this.cerrandoModalUsuario = true; 
    
    if (this.activeCameraView === 'TPS') {
       this.runtime.toggleCameraUser(false, 60); 
    } else {
       this.runtime.toggleCameraUser(true, 60); 
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

  toggleInspector() { this.showInspector = !this.showInspector; this.recalcularMotor(); }
  toggleTimeline() { this.showTimeline = !this.showTimeline; this.recalcularMotor(); }
  
  recalcularMotor() {
    setTimeout(() => this.motor3dSvc.forzarRedimension(), 10);
    setTimeout(() => this.motor3dSvc.forzarRedimension(), 150);
  }

  iniciarRedimension(event: MouseEvent) {
    if (this.editorSvc.playState() === 'EDITOR' || this.editorSvc.playState() === 'EDITING_IN_GAME') {
      this.isResizing = true;
      event.preventDefault(); 
    }
  }

  iniciarRedimensionTimeline(event: MouseEvent) {
    if (this.editorSvc.playState() === 'EDITOR' || this.editorSvc.playState() === 'EDITING_IN_GAME') {
      this.isResizingTimeline = true;
      event.preventDefault();
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.isResizing) {
      const newWidth = window.innerWidth - event.clientX;
      if (newWidth > 250 && newWidth < window.innerWidth * 0.6) {
        this.inspectorWidth = newWidth;
        this.motor3dSvc.forzarRedimension(); 
      }
    }
    if (this.isResizingTimeline) {
      const containerHeight = window.innerHeight;
      const bottomY = window.innerHeight - event.clientY;
      let newHeight = (bottomY / containerHeight) * 100;
      if (newHeight < 5) newHeight = 5; 
      if (newHeight > 70) newHeight = 70;
      this.timelineHeight = newHeight;
      this.motor3dSvc.forzarRedimension();
    }
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isResizing) { this.isResizing = false; this.recalcularMotor(); }
    if (this.isResizingTimeline) { this.isResizingTimeline = false; this.recalcularMotor(); }
  }

  @HostListener('window:keydown', ['$event'])
  manejarAtajos(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return; 

    const state = this.editorSvc.playState();
    if (this.editando && !this.editorSvc.showAddObjectModal() && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
      if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) { this.editorSvc.deshacerAccion(); event.preventDefault(); }
      if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) { this.editorSvc.copiarObjeto(); event.preventDefault(); }
      if (event.ctrlKey && (event.key === 'v' || event.key === 'V')) { this.editorSvc.pegarObjeto(); event.preventDefault(); }
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
          a.type === 'model_glb' || a.type === 'video_mp4' || a.path.endsWith('.mp4') || 
          a.path.endsWith('.webm') || a.type === 'texture_png' || a.type === 'texture_jpg' ||
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
    if (!this.episodioIdActivo || !this.editando || this.editorSvc.rolSimulado() !== 'admin') return;
    this.estadoGuardado.set('Guardando...');
    
    const mapData = this.editorSvc.obtenerDatosParaGuardar();
    this.epiApiSvc.guardarMapa(this.episodioIdActivo, mapData).subscribe({
      next: () => {
        this.estadoGuardado.set('Guardado automático ✓');
        if (!silencioso) alert('Mapa guardado exitosamente');
        setTimeout(() => { if (this.estadoGuardado() === 'Guardado automático ✓') this.estadoGuardado.set(''); }, 3000);
      },
      error: (err) => {
        this.estadoGuardado.set('Error al guardar ⚠️');
      }
    });
  }

  onRolChange() { if (this.objRol === 'npc' || this.objRol === 'spawn_point') this.objTipo = 'model'; }
  onTipoChange() {
    if (this.objTipo === 'trigger' || this.objTipo === 'trigger_compuesto') { this.objRol = 'prop'; this.objEsSolido = false; this.objEsSeleccionable = true; } 
    else if (this.objTipo.startsWith('light_')) { this.objRol = 'prop'; this.objColor = '#ffffff'; this.objEsSolido = false; this.objEsSeleccionable = true; } 
    else if (this.objTipo === 'bubble' || this.objTipo === 'video_plane' || this.objTipo === 'image_plane') { this.objRol = 'prop'; this.objEsSolido = false; this.objEsSeleccionable = true; } 
    else if (this.objTipo !== 'model') { this.objRol = 'prop'; }
    if (this.objTipo !== 'model' && !this.objTipo.startsWith('light_') && this.objTipo !== 'video_plane' && this.objTipo !== 'image_plane') this.objAssetSeleccionado = null;
  }

  crearObjeto3D() {
    if(!this.objNombre) return;
    const parent = this.objHacerHijo ? (this.editorSvc.objetoSeleccionado() as AbstractMesh | null) : null;
    this.editorSvc.agregarObjetoCustom(this.objTipo, this.objNombre, this.objRol, this.objColor, this.objSizeX, this.objSizeY, this.objSizeZ, this.objAssetSeleccionado, this.objEsSolido, this.objEsSeleccionable, this.objMensaje, parent);
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
    if (this.editorSvc.rolSimulado() === 'admin') {
       this.guardarMapaEnBD(true); 
       
       // Force focus and lock para atrapar la interacción del botón en el mismo milisegundo
       const canvas = this.motor3dSvc.engine.getRenderingCanvas();
       if (canvas) {
           canvas.focus();
           try { canvas.requestPointerLock(); } catch {}
       }
    }
    this.playModeSvc.testearEscena(this.vistaPrueba);
  }

  detenerModoPrueba() {
    if (this.editorSvc.playState() === 'EDITOR') return;
    this.playModeSvc.detenerPrueba(); 
    if (this.editorSvc.rolSimulado() === 'admin') setTimeout(() => this.guardarMapaEnBD(true), 500);
  }

  cerrarInteraccion() { this.runtime.cerrarInteraccion(); }

  salirDelEditor() {
    this.editando = false; 
    this.cargandoEscena = false;
    this.modalSeleccionModo = false;
    this.modalMisionUsuario = false;
    this.misionIniciada = false;
    this.cerrandoModalUsuario = false;
    this.layoutSvc.mostrarMenu(); 
    this.editorSvc.limpiarEstado();
    this.cargarEpisodios(); 
    
    this.isInteracting.set(false);
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }

  ngOnDestroy(): void {
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
    if (this.autoSaveSub) this.autoSaveSub.unsubscribe();
    if (this.eventBusSub) this.eventBusSub.unsubscribe();
  }
}