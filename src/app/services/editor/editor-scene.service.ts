
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';

// Inyección de Sub-servicios orquestados
import { SceneEnvironmentService } from './sceneservice/scene-environment.service';
import { SceneShadowsService } from './sceneservice/scene-shadows.service';
import { SceneObjectBuilderService } from './sceneservice/scene-object-builder.service';
import { SceneLoaderService } from './sceneservice/scene-loader.service';
import { SceneSaverService } from './sceneservice/scene-saver.service';
import { SceneNodesService } from './sceneservice/scene-nodes.service';
import { EditorStateService } from './editor-state.service';

@Injectable({ providedIn: 'root' })
export class EditorSceneService {
  
  private envSvc = inject(SceneEnvironmentService);
  private shadowsSvc = inject(SceneShadowsService);
  private builderSvc = inject(SceneObjectBuilderService);
  private loaderSvc = inject(SceneLoaderService);
  private saverSvc = inject(SceneSaverService);
  private nodesSvc = inject(SceneNodesService);
  private state = inject(EditorStateService);

  // --- MÉTODOS DE ENTORNO ---
  crearEntornoVisual(): void {
    this.envSvc.crearEntornoVisual();
  }

  crearSuelo(): void {
    this.envSvc.crearSuelo();
    this.nodesSvc.actualizarListaNodos();
  }

  // --- MÉTODOS DE CONSTRUCCIÓN ---
  reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.builderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null): void {
    this.builderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode);
  }

  agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): void {
    this.builderSvc.agregarObjetoCustom(tipo, nombre, rol, colorHex, sizeX, sizeY, sizeZ, asset, isSolid, isSelectable, mensaje, parentNode);
  }

  // --- SOMBRAS Y RENDER ---
  asignarObjetosASombrasDeLuces(): void {
    this.shadowsSvc.asignarObjetosASombrasDeLuces();
  }

  // --- GESTIÓN DE NODOS Y MEMORIA ---
  actualizarListaNodos(): void {
    this.nodesSvc.actualizarListaNodos();
  }

  eliminarSeleccionado(): void {
    this.nodesSvc.eliminarSeleccionado();
  }

  limpiarEstado(): void {
    this.nodesSvc.limpiarEstado();
  }

  // --- CARGA Y GUARDADO CON LA BD ---
  cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
    const isAdmin = this.state.rolSimulado() === 'admin';
    return this.loaderSvc.cargarEscenaDesdeDatos(dataBD, isAdmin).then(() => {
      this.nodesSvc.actualizarListaNodos();
    });
  }

  obtenerDatosParaGuardar(): { sceneObjects: any[], triggers: any[], worldSettings: any } {
    return this.saverSvc.obtenerDatosParaGuardar();
  }
}