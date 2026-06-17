import { Injectable, inject } from '@angular/core';
import { Node, AbstractMesh, Vector3 } from '@babylonjs/core';

import { EditorToolsService } from './editor/editor-tools.service';
import { EditorSceneService } from './editor/editor-scene.service';
import { EditorPlayModeService } from './editor/editor-play-mode.service';
import { EditorInteractionService } from './editor/editor-interaction.service';
import { EditorStateService, ToolMode, PlayState } from './editor/editor-state.service';
import { EditorCameraService } from './editor/editor-camera.service';
import { SceneLoaderService } from './editor/sceneservice/scene-loader.service'; 

export type { ToolMode, PlayState };

@Injectable({
  providedIn: 'root'
})
export class EditorMapaService {
  
  public state = inject(EditorStateService); 
  private tools = inject(EditorToolsService);
  private scene = inject(EditorSceneService);
  private playMode = inject(EditorPlayModeService);
  private interaction = inject(EditorInteractionService);
  private camera = inject(EditorCameraService);
  private loader = inject(SceneLoaderService); 

  get playState() { return this.state.playState; }
  get rolSimulado() { return this.state.rolSimulado; }
  get currentTool() { return this.state.currentTool; }
  
  get objetoSeleccionado() { return this.state.objetoSeleccionado; }
  get subObjetoSeleccionado() { return this.state.subObjetoSeleccionado; } 
  
  get objetoInteractuado() { return this.state.objetoInteractuado; }
  get nodosEscena() { return this.state.nodosEscena; }
  get ratonBloqueado() { return this.state.ratonBloqueado; }
  get showAddObjectModal() { return this.state.showAddObjectModal; }

  get onMapChanged() { return this.state.onMapChanged; }
  get onGizmoDrag() { return this.state.onGizmoDrag; }
  triggerUpdate(): void { this.state.triggerUpdate(); }

  checkIsAdmin(): boolean { return this.state.checkIsAdmin(); }
  
  limpiarEstado(): void {
    this.scene.limpiarEstado();
    this.state.limpiarEstado();
    this.tools.limpiarEstado();
  }

  activarEventosEditor(): void { this.tools.activarEventosEditor(); }
  setToolMode(mode: ToolMode): void { this.tools.setToolMode(mode); }
  copiarObjeto(): void { this.tools.copiarObjeto(); }
  pegarObjeto(): void { this.tools.pegarObjeto(); }
  deshacerAccion(): void { this.tools.deshacerAccion(); }
  
  seleccionarObjeto(nodo: Node | null): void { 
    this.state.objetoSeleccionado.set(nodo); 
    this.state.subObjetoSeleccionado.set(null);
  }

  crearSuelo(): void { this.scene.crearSuelo(); }
  eliminarSeleccionado(): void { this.scene.eliminarSeleccionado(); }
  
  cargarEscenaDesdeDatos(dataBD: any): Promise<void> { 
    return this.scene.cargarEscenaDesdeDatos(dataBD); 
  }
  
  obtenerDatosParaGuardar(): { sceneObjects: any[], triggers: any[], worldSettings: any } { 
    return this.scene.obtenerDatosParaGuardar(); 
  }
  
  agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): void {
    this.scene.agregarObjetoCustom(tipo, nombre, rol, colorHex, sizeX, sizeY, sizeZ, asset, isSolid, isSelectable, mensaje, parentNode);
  }

  instanciarPrefabFull(prefabData: any, targetPos: Vector3): void {
    this.loader.instanciarObjetoDesdePrefab(prefabData, targetPos);
  }

  iniciarModoJuego(vista: 'FPS' | 'TPS'): void { this.playMode.iniciarModoJuego(vista); }
  detenerModoJuego(): void { this.playMode.detenerModoJuego(); }

  cerrarInteraccionJugador(): void { this.interaction.cerrarInteraccionJugador(); }

  toggleCameraUser(isCinematicInitial: boolean = false, customFrames?: number): void { 
    this.playMode.toggleCameraUser(isCinematicInitial, customFrames); 
  }
}