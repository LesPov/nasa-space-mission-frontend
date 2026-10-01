import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, MeshBuilder, Color4, Tags, Quaternion } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { CoreSceneLoaderService } from '../../core/engine/scene/utils/core-scene-loader.service';
import { SceneObjectBuilderService } from './sceneservice/scene-object-builder.service';
import { SceneSaverService } from './sceneservice/scene-saver.service';
import { SceneNodesService } from './sceneservice/scene-nodes.service';
import { EditorStateService } from './editor-state.service';
import { EditorMapaService } from '../editor-mapa.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { ShadowOrchestratorService } from '../../core/engine/runtime/shadows/shadow-orchestrator.service';
 
@Injectable({ providedIn: 'root' })
export class EditorSceneService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private loaderSvc = inject(CoreSceneLoaderService);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private builderSvc = inject(SceneObjectBuilderService);
  private saverSvc = inject(SceneSaverService);
  private nodesSvc = inject(SceneNodesService);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private gameContext = inject(GameContextService);

  public crearEntornoVisual(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    
    ['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].forEach(name => {
      const old = scene.getMeshByName(name);
      if (old) old.dispose();
    });

    const size = 50;
    
    const ex = MeshBuilder.CreateLines('ejeX', { points: [new Vector3(-size, 0, 0), new Vector3(size, 0, 0)], colors: [new Color4(1, 0.2, 0.2, 1), new Color4(1, 0.2, 0.2, 1)] }, scene);
    const ey = MeshBuilder.CreateLines('ejeY', { points: [new Vector3(0, -size, 0), new Vector3(0, size, 0)], colors: [new Color4(0.2, 1, 0.2, 1), new Color4(0.2, 1, 0.2, 1)] }, scene);
    const ez = MeshBuilder.CreateLines('ejeZ', { points: [new Vector3(0, 0, -size), new Vector3(0, 0, size)], colors: [new Color4(0.2, 0.5, 1, 1), new Color4(0.2, 0.5, 1, 1)] }, scene);
    
    ex.isPickable = false; ey.isPickable = false; ez.isPickable = false;
    Tags.AddTagsTo(ex, "system_element editor_only axis ignore_raycast");
    Tags.AddTagsTo(ey, "system_element editor_only axis ignore_raycast");
    Tags.AddTagsTo(ez, "system_element editor_only axis ignore_raycast");

    const ptsGrid: Vector3[][] = [];
    const colorsGrid: Color4[][] = [];
    const colorGris = new Color4(0.3, 0.3, 0.3, 0.5);

    for (let i = -60; i <= 60; i += 2) {
      if (i === 0) continue;
      ptsGrid.push([new Vector3(i, 0, -60), new Vector3(i, 0, 60)]); colorsGrid.push([colorGris, colorGris]);
      ptsGrid.push([new Vector3(-60, 0, i), new Vector3(60, 0, i)]); colorsGrid.push([colorGris, colorGris]);
    }
    
    const grid = MeshBuilder.CreateLineSystem('gridHelper', { lines: ptsGrid, colors: colorsGrid }, scene);
    grid.isPickable = false;
    Tags.AddTagsTo(grid, "system_element editor_only grid ignore_raycast");
  }

  public crearSuelo(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return; 
    
    const old = scene.getMeshByName('sueloInvisible');
    if (old) old.dispose();
    
    this.loaderSvc.createInvisibleFloor(scene);
    this.nodesSvc.actualizarListaNodos();
  }

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.builderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  public agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null, actionType: string = 'show_message'): void {
    this.builderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode, actionType);
  }

  public agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string, sizeX: number, sizeY: number, sizeZ: number, 
    asset?: any, isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '', 
    parentNode: AbstractMesh | null = null, position?: Vector3, localRotation?: Vector3
  ): void {
    this.builderSvc.agregarObjetoCustom(tipo, nombre, rol, colorHex, sizeX, sizeY, sizeZ, asset, isSolid, isSelectable, mensaje, parentNode, position, localRotation);
  }

  public asignarObjetosASombrasDeLuces(): void {
    this.shadowOrchestrator.asignarObjetosASombrasDeLuces();
  }

  public actualizarListaNodos(): void {
    this.nodesSvc.actualizarListaNodos();
  }

  public cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
    const isAdmin = this.gameContext.authorityProfile().canSelectHidden;
    const mode = this.gameContext.mode();
    
    if (mode === 'EDITOR' || mode === 'EDITING_IN_GAME') {
      this.entityManager.getAllEntities().forEach(e => e.isPersistent = false);
    }
    
    this.entityManager.clear();

    return this.loaderSvc.loadSceneFromData(dataBD).then(() => {
      // 🔥 FIX: Ya no llamamos a 'revelarEntidadesOcultasParaAdmin' aquí.
      // El HighlightService gestiona las luces y Babylon el culling normal de otros helpers.
      this.nodesSvc.actualizarListaNodos();
    });
  }

  public instanciarPrefabFull(prefabData: any, targetPos: Vector3, rotationEuler?: Vector3, scale?: Vector3, parentNode?: AbstractMesh): void {
    this.loaderSvc.instantiatePrefab(prefabData, targetPos, rotationEuler, scale, parentNode).then((mallas) => {
      this.nodesSvc.actualizarListaNodos();
      const iter = mallas.values().next();
      if (!iter.done) {
        this.state.seleccionarObjeto(iter.value);
        this.mapaSvc.onMapChanged.next(); 
      }
    });
  }

  public instanciarPrefabEnCentro(prefabData: any): void {
    let camTarget = new Vector3(0, 1, 0);
    const editorCam = this.motor3d.getEditorCamera();
    if (editorCam && typeof editorCam.getTarget === 'function') {
      camTarget = editorCam.getTarget().clone();
    }
    this.instanciarPrefabFull(prefabData, camTarget);
  }

  public obtenerDatosParaGuardar(escenaActualData: any, forceFull: boolean = false): any { 
    return this.saverSvc.obtenerDatosParaGuardar(escenaActualData, forceFull);
  }
}