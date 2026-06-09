import { Injectable, inject } from '@angular/core';
import { Node } from '@babylonjs/core';

// Inyectamos los submódulos
import { EditorToolsService } from './editor/editor-tools.service';
import { EditorSceneService } from './editor/editor-scene.service';
import { EditorPlayerService } from './editor/editor-player.service';
import { EditorInteractionService } from './editor/editor-interaction.service';

// Importamos el state y los tipos
import { EditorStateService, ToolMode, PlayState } from './editor/editor-state.service';

// 🔥 FIX TS1205: Se usa "export type" al reexportar con isolatedModules: true
export type { ToolMode, PlayState };

@Injectable({
  providedIn: 'root'
})
export class EditorMapaService {
  
  // Instancias inyectadas
  private state = inject(EditorStateService);
  private tools = inject(EditorToolsService);
  private scene = inject(EditorSceneService);
  private player = inject(EditorPlayerService);
  private interaction = inject(EditorInteractionService);

  // ==========================================
  // MAPEO DE SIGNALS Y ESTADO (Vienen del State)
  // ==========================================
  get playState() { return this.state.playState; }
  get rolSimulado() { return this.state.rolSimulado; }
  get currentTool() { return this.state.currentTool; }
  get objetoSeleccionado() { return this.state.objetoSeleccionado; }
  get objetoInteractuado() { return this.state.objetoInteractuado; }
  get nodosEscena() { return this.state.nodosEscena; }
  get mirandoObjetoInteractuable() { return this.state.mirandoObjetoInteractuable; }
  get ratonBloqueado() { return this.state.ratonBloqueado; }
  get showAddObjectModal() { return this.state.showAddObjectModal; }

  // ==========================================
  // MAPEO DE SUBJECTS Y EVENTOS
  // ==========================================
  get onMapChanged() { return this.state.onMapChanged; }
  get onGizmoDrag() { return this.state.onGizmoDrag; }
  triggerUpdate(): void { this.state.triggerUpdate(); }

  // ==========================================
  // MAPEO DE FUNCIONES GENERALES
  // ==========================================
  checkIsAdmin(): boolean { return this.state.checkIsAdmin(); }
  
  limpiarEstado(): void {
    this.scene.limpiarEstado();
    this.state.limpiarEstado();
  }

  // ==========================================
  // MAPEO HACIA LAS HERRAMIENTAS (TOOLS)
  // ==========================================
  activarEventosEditor(): void { this.tools.activarEventosEditor(); }
  setToolMode(mode: ToolMode): void { this.tools.setToolMode(mode); }
  copiarObjeto(): void { this.tools.copiarObjeto(); }
  pegarObjeto(): void { this.tools.pegarObjeto(); }
  deshacerAccion(): void { this.tools.deshacerAccion(); }
  
  // Intercepción centralizada de selección
  seleccionarObjeto(nodo: Node | null): void { 
    this.state.objetoSeleccionado.set(nodo); 
  }

  // ==========================================
  // MAPEO HACIA LA ESCENA (SCENE)
  // ==========================================
  crearSuelo(): void { this.scene.crearSuelo(); }
  eliminarSeleccionado(): void { this.scene.eliminarSeleccionado(); }
  cargarEscenaDesdeDatos(objetosBD: any[]): void { this.scene.cargarEscenaDesdeDatos(objetosBD); }
  obtenerDatosParaGuardar(): any[] { return this.scene.obtenerDatosParaGuardar(); }
  
  agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = ''
  ): void {
    this.scene.agregarObjetoCustom(tipo, nombre, rol, colorHex, sizeX, sizeY, sizeZ, asset, isSolid, isSelectable, mensaje);
  }

  // ==========================================
  // MAPEO HACIA EL JUGADOR (PLAYER)
  // ==========================================
  iniciarModoJuego(vista: 'FPS' | 'TPS'): void { this.player.iniciarModoJuego(vista); }
  detenerModoJuego(): void { this.player.detenerModoJuego(); }

  // ==========================================
  // MAPEO HACIA LA INTERACCIÓN (RPG MODAL)
  // ==========================================
  cerrarInteraccionJugador(): void { this.interaction.cerrarInteraccionJugador(); }
}