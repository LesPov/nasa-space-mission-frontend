import { Component, OnDestroy, OnInit, inject, signal, ChangeDetectorRef, HostListener } from '@angular/core';
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

@Component({
  selector: 'app-editor-escena',
  standalone: true,
  imports: [MotorBabylon, InspectorEscena, ToolbarEscena, CommonModule, FormsModule, MiniVisorEscena],
  templateUrl: './editor-escena.html',
  styleUrl: './editor-escena.css',
}) 
export class EditorEscena implements OnInit, OnDestroy {
  public stateSvc = inject(EditorStateService); 
  public editorSvc = inject(EditorMapaService);
  public motor3dSvc = inject(Motor3dService);
  public layoutSvc = inject(LayoutService);
  public epiApiSvc = inject(EpisodiosService);
  public cdr = inject(ChangeDetectorRef);

  public editando = false;
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
  public objColor: string = '#4b73b5'; 
  public objSizeX: number = 1;
  public objSizeY: number = 1;
  public objSizeZ: number = 1;
  public objAssetSeleccionado: any = null;
  
  public objEsSolido: boolean = true;
  public objEsSeleccionable: boolean = true;
  public objMensaje: string = '';

  public vistaPrueba: 'FPS' | 'TPS' = 'FPS';
  public inspectorWidth = 350; 
  public isResizing = false;

  private fpsInterval: any;
  private autoSaveSub!: Subscription;

  public esAdmin: boolean = false;

  ngOnInit() {
    this.esAdmin = this.editorSvc.checkIsAdmin();
    this.cargarEpisodios();
    this.cargarAssets();

    this.autoSaveSub = this.editorSvc.onMapChanged.pipe(
      debounceTime(1000) 
    ).subscribe(() => {
      const state = this.editorSvc.playState();
      if (this.editando && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
        this.guardarMapaEnBD(true); 
      }
    });
  }

  iniciarRedimension(event: MouseEvent) {
    if (this.editorSvc.playState() === 'EDITOR' || this.editorSvc.playState() === 'EDITING_IN_GAME') {
      this.isResizing = true;
      event.preventDefault(); 
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isResizing) return;
    const newWidth = window.innerWidth - event.clientX;
    if (newWidth > 250 && newWidth < window.innerWidth * 0.6) {
      this.inspectorWidth = newWidth;
      this.motor3dSvc.forzarRedimension(); 
    }
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isResizing) {
      this.isResizing = false;
      this.motor3dSvc.forzarRedimension(); 
    }
  }

  @HostListener('window:keydown', ['$event'])
  manejarAtajos(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return; 
    }

    const state = this.editorSvc.playState();
    if (this.editando && !this.editorSvc.showAddObjectModal() && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
      if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) {
        this.editorSvc.deshacerAccion();
        event.preventDefault();
      }
      if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) {
        this.editorSvc.copiarObjeto();
        event.preventDefault();
      }
      if (event.ctrlKey && (event.key === 'v' || event.key === 'V')) {
        this.editorSvc.pegarObjeto();
        event.preventDefault();
      }
    }
  }

  toggleRolPrueba() {
    if (this.editorSvc.rolSimulado() === 'admin') {
      this.editorSvc.rolSimulado.set('user');
      this.editorSvc.seleccionarObjeto(null);
    } else {
      this.editorSvc.rolSimulado.set('admin');
    }
    
    const isAdmin = this.editorSvc.rolSimulado() === 'admin';
    this.motor3dSvc.scene.meshes.forEach(m => {
        if (m.metadata?.type === 'trigger' || m.metadata?.type?.startsWith('light_')) {
            m.isVisible = isAdmin;
        }
    });
  }

  onRolChange() {
    if (this.objRol === 'npc' || this.objRol === 'spawn_point') {
      this.objTipo = 'model';
    }
  }

  onTipoChange() {
    if (this.objTipo === 'trigger' || this.objTipo === 'trigger_compuesto') {
      this.objRol = 'prop';
      this.objEsSolido = false;
      this.objEsSeleccionable = true;
    } else if (this.objTipo.startsWith('light_')) {
      // Si elige una luz, bloqueamos sólidas y roles
      this.objRol = 'prop';
      this.objColor = '#ffffff';
      this.objEsSolido = false;
      this.objEsSeleccionable = true;
    } else if (this.objTipo !== 'model') {
      this.objRol = 'prop';
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
      next: (res) => { this.listaAssets = res.filter((a:any) => a.type === 'model_glb'); },
      error: (err) => console.error('Error al cargar assets', err)
    });
  }

  seleccionarArchivoSubida(event: any) {
    if (event.target.files && event.target.files.length > 0) {
      this.archivoSubida = event.target.files[0];
    }
  }

  subirNuevoAsset() {
    if (!this.archivoSubida) return;
    this.subiendoAsset = true;
    this.epiApiSvc.subirAsset(this.archivoSubida).subscribe({
      next: (res) => {
        this.subiendoAsset = false;
        this.archivoSubida = null;
        alert('Modelo subido correctamente');
        this.cargarAssets(); 
      },
      error: (err) => {
        this.subiendoAsset = false;
        console.error("Error subiendo asset:", err);
        alert('Error al subir el modelo. Revisa la consola.');
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

  entrarAlEditor(episodio: any) {
    this.episodioIdActivo = episodio.id;
    this.mapaActualNombre = episodio.title;
    this.editando = true;
    this.layoutSvc.ocultarMenu(); 
    
    this.epiApiSvc.obtenerEpisodio(episodio.id).subscribe({
      next: (res) => {
        setTimeout(() => {
          this.motor3dSvc.forzarRedimension(); 
          this.editorSvc.activarEventosEditor();
          this.editorSvc.crearSuelo();

          if(res) {
            this.editorSvc.cargarEscenaDesdeDatos(res);
          }
          
          this.fpsInterval = setInterval(() => {
            this.fps.set(this.motor3dSvc.currentFps.toFixed(0));
          }, 500);
        }, 150); 
      },
      error: (err) => alert('Error cargando los objetos del mapa')
    });
  }

  guardarMapaEnBD(silencioso = false) {
    if (!this.episodioIdActivo || !this.editando) return;
    this.estadoGuardado.set('Guardando...');
    
    const mapData = this.editorSvc.obtenerDatosParaGuardar();
    
    this.epiApiSvc.guardarMapa(this.episodioIdActivo, mapData).subscribe({
      next: () => {
        this.estadoGuardado.set('Guardado automático ✓');
        if (!silencioso) alert('Mapa guardado exitosamente');
        
        setTimeout(() => {
          if (this.estadoGuardado() === 'Guardado automático ✓') {
            this.estadoGuardado.set('');
          }
        }, 3000);
      },
      error: (err) => {
        console.error("Error crítico guardando en BD:", err); 
        this.estadoGuardado.set('Error al guardar ⚠️');
      }
    });
  }

  crearObjeto3D() {
    if(!this.objNombre) return;
    this.editorSvc.agregarObjetoCustom(
      this.objTipo, this.objNombre, this.objRol, this.objColor, 
      this.objSizeX, this.objSizeY, this.objSizeZ, this.objAssetSeleccionado,
      this.objEsSolido, this.objEsSeleccionable, this.objMensaje 
    );
    this.cerrarModalObjeto();
  }

  cerrarModalObjeto() {
    this.editorSvc.showAddObjectModal.set(false);
    this.objNombre = 'Objeto_' + Math.floor(Math.random() * 100);
    this.objTipo = 'cube';
    this.objRol = 'prop';
    this.objColor = '#4b73b5';
    this.objSizeX = 1; this.objSizeY = 1; this.objSizeZ = 1;
    this.objAssetSeleccionado = null;
    this.archivoSubida = null;
    this.objEsSolido = true;
    this.objEsSeleccionable = true;
    this.objMensaje = '';
  }

  esObjetoJugable(): boolean {
    const obj = this.editorSvc.objetoSeleccionado() as any;
    if (!obj) return false;
    return obj.metadata?.rol === 'spawn_point' || obj.metadata?.rol === 'npc';
  }

  iniciarModoPrueba() {
    if (!this.esObjetoJugable()) return;
    this.guardarMapaEnBD(true); 
    this.editorSvc.iniciarModoJuego(this.vistaPrueba);
  }

  detenerModoPrueba() {
    if (this.editorSvc.playState() === 'EDITOR') return;
    this.editorSvc.detenerModoJuego(); 
    setTimeout(() => this.guardarMapaEnBD(true), 500);
  }

  cerrarInteraccion() {
    this.editorSvc.cerrarInteraccionJugador();
  }

  salirDelEditor() {
    this.editando = false; 
    this.layoutSvc.mostrarMenu(); 
    this.editorSvc.limpiarEstado();
    this.cargarEpisodios(); 
    if (this.fpsInterval) clearInterval(this.fpsInterval);
  }

  ngOnDestroy(): void {
    this.layoutSvc.mostrarMenu();
    this.editorSvc.limpiarEstado();
    if (this.fpsInterval) clearInterval(this.fpsInterval);
    if (this.autoSaveSub) this.autoSaveSub.unsubscribe();
  }
}