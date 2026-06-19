// src/app/services/editor/editor-scene.service.ts

import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, MeshBuilder, Color4 } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { CoreSceneLoaderService } from '../../core/engine/scene/utils/core-scene-loader.service';
import { CoreSceneShadowsService } from '../../core/engine/scene/utils/core-scene-shadows.service';
import { SceneObjectBuilderService } from './sceneservice/scene-object-builder.service';
import { SceneSaverService } from './sceneservice/scene-saver.service';
import { SceneNodesService } from './sceneservice/scene-nodes.service';
import { EditorStateService } from './editor-state.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class EditorSceneService {
  private motor3d = inject(Motor3dService);
  private loaderSvc = inject(CoreSceneLoaderService);
  private shadowsSvc = inject(CoreSceneShadowsService);
  private builderSvc = inject(SceneObjectBuilderService);
  private saverSvc = inject(SceneSaverService);
  private nodesSvc = inject(SceneNodesService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);

  public crearEntornoVisual(): void {
    const scene = this.motor3d.scene;
    const size = 50;
    MeshBuilder.CreateLines('ejeX', { points: [new Vector3(-size, 0, 0), new Vector3(size, 0, 0)], colors: [new Color4(1, 0.2, 0.2, 1), new Color4(1, 0.2, 0.2, 1)] }, scene).isPickable = false;
    MeshBuilder.CreateLines('ejeY', { points: [new Vector3(0, -size, 0), new Vector3(0, size, 0)], colors: [new Color4(0.2, 1, 0.2, 1), new Color4(0.2, 1, 0.2, 1)] }, scene).isPickable = false;
    MeshBuilder.CreateLines('ejeZ', { points: [new Vector3(0, 0, -size), new Vector3(0, 0, size)], colors: [new Color4(0.2, 0.5, 1, 1), new Color4(0.2, 0.5, 1, 1)] }, scene).isPickable = false;

    const ptsGrid: Vector3[][] = [];
    const colorsGrid: Color4[][] = [];
    const colorGris = new Color4(0.3, 0.3, 0.3, 0.5);

    for (let i = -60; i <= 60; i += 2) {
      if (i === 0) continue;
      ptsGrid.push([new Vector3(i, 0, -60), new Vector3(i, 0, 60)]); colorsGrid.push([colorGris, colorGris]);
      ptsGrid.push([new Vector3(-60, 0, i), new Vector3(60, 0, i)]); colorsGrid.push([colorGris, colorGris]);
    }
    MeshBuilder.CreateLineSystem('gridHelper', { lines: ptsGrid, colors: colorsGrid }, scene).isPickable = false;
  }

  public crearSuelo(): void {
    this.loaderSvc.createInvisibleFloor(this.motor3d.scene);
    this.nodesSvc.actualizarListaNodos();
  }

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.builderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  public agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null): void {
    this.builderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode);
  }

  public agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): void {
    this.builderSvc.agregarObjetoCustom(tipo, nombre, rol, colorHex, sizeX, sizeY, sizeZ, asset, isSolid, isSelectable, mensaje, parentNode);
  }

  public asignarObjetosASombrasDeLuces(): void {
    this.shadowsSvc.asignarObjetosASombrasDeLuces();
  }

  public actualizarListaNodos(): void {
    this.nodesSvc.actualizarListaNodos();
  }

  public eliminarSeleccionado(): void {
    this.nodesSvc.eliminarSeleccionado();
  }

  public limpiarEstado(): void {
    this.nodesSvc.limpiarEstado();
  }

  public revelarEntidadesOcultasParaAdmin(): void {
    const allEntities = this.entityManager.getAllEntities();
    allEntities.forEach(e => {
      if (e.type === 'trigger' || e.type === 'trigger_compuesto' || e.type === 'image_plane' || e.type?.startsWith('light_')) {
        if (e.view) e.view.isVisible = true;
      }
    });
  }

  public cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
    const isAdmin = this.state.checkIsAdmin();
    return this.loaderSvc.loadSceneFromData(dataBD).then(() => {
      if (isAdmin) {
        this.revelarEntidadesOcultasParaAdmin();
      }
      this.nodesSvc.actualizarListaNodos();
    });
  }

  public instanciarPrefabFull(prefabData: any, targetPos: Vector3): void {
    const isAdmin = this.state.checkIsAdmin();
    this.loaderSvc.instantiatePrefab(prefabData, targetPos).then((mallas) => {
      if (isAdmin) {
        this.revelarEntidadesOcultasParaAdmin();
      }
      this.nodesSvc.actualizarListaNodos();
      const iter = mallas.values().next();
      if (!iter.done) {
        this.state.objetoSeleccionado.set(iter.value);
        this.state.triggerUpdate();
      }
    });
  }

  public obtenerDatosParaGuardar(forceFull: boolean = false): { sceneObjectsDelta: any[], triggersDelta: any[], deletedObjects: string[], deletedTriggers: string[], worldSettings: any } {
    return this.saverSvc.obtenerDatosParaGuardar(forceFull);
  }
}