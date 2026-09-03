
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Matrix } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { ToolsSelectionService } from './tools-selection.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { ToolsDebugColliderService } from './tools-debug-collider.service';
import { ToolsDebugCameraService } from './tools-debug-camera.service';
import { ToolsDebugLightService } from './tools-debug-light.service';
import { ToolsDebugFogService } from './tools-debug-fog.service';

@Injectable({ providedIn: 'root' })
export class ToolsDebugService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private selectionSvc = inject(ToolsSelectionService);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);

  private colliderSvc = inject(ToolsDebugColliderService);
  private cameraSvc = inject(ToolsDebugCameraService);
  private lightSvc = inject(ToolsDebugLightService);
  private fogSvc = inject(ToolsDebugFogService);

  get debugCollider() { return this.colliderSvc.debugCollider; }
  get debugCameraBox() { return this.cameraSvc.debugCameraBox; }
  get debugLightBox() { return this.lightSvc.debugLightBox; }
  get debugFogStartSphere() { return this.fogSvc.debugFogStartSphere; }
  get debugFogEndSphere() { return this.fogSvc.debugFogEndSphere; }

  public getFogBaseLocalPos(selected: AbstractMesh): Vector3 {
    const entity = this.entityManager.getEntityByMesh(selected);
    const camOffset = entity?.camOffset;
    if (entity?.characterConfig && camOffset) {
      return new Vector3(
        this.selectionSvc.normalizarNumero(camOffset.x, 0),
        this.selectionSvc.normalizarNumero(camOffset.y, 1.6),
        this.selectionSvc.normalizarNumero(camOffset.z, 0)
      );
    }
    if (entity?.initialHeadLocal) {
      return new Vector3(
        this.selectionSvc.normalizarNumero(entity.initialHeadLocal.x, 0),
        this.selectionSvc.normalizarNumero(entity.initialHeadLocal.y, 1.6),
        this.selectionSvc.normalizarNumero(entity.initialHeadLocal.z, 0)
      );
    }
    const collider = entity?.collider;
    if (collider) {
      const offsetY = this.selectionSvc.normalizarNumero(collider.offsetY, 0);
      const sizeY = this.selectionSvc.normalizarNumero(collider.sizeY, 1);
      return new Vector3(
        this.selectionSvc.normalizarNumero(collider.offsetX, 0),
        offsetY + Math.max(sizeY, 0.8),
        this.selectionSvc.normalizarNumero(collider.offsetZ, 0)
      );
    }
    return new Vector3(0, 1.6, 0);
  }

  public getFogDebugAnchor(selected: AbstractMesh): Vector3 {
    const pPos = selected.getAbsolutePosition().clone();
    const entity = this.entityManager.getEntityByMesh(selected);
    const fogConfig = entity?.playerConfig?.fog;
    if (fogConfig) {
       const isFPS = this.state.modoVistaPrueba === 'FPS';
       pPos.x += this.selectionSvc.normalizarNumero(isFPS ? fogConfig.offsetXFPS : fogConfig.offsetXTPS, 0);
       pPos.y += this.selectionSvc.normalizarNumero(isFPS ? fogConfig.offsetYFPS : fogConfig.offsetYTPS, 0);
       pPos.z += this.selectionSvc.normalizarNumero(isFPS ? fogConfig.offsetZFPS : fogConfig.offsetZTPS, 0);
    }
    return pPos;
  }

  public actualizarDebugMeshes(selected: Mesh | null): void {
    const playState = this.state.playState();
    if (!selected || (playState !== 'EDITOR' && playState !== 'EDITING_IN_GAME')) {
      this.colliderSvc.dispose();
      this.cameraSvc.dispose();
      this.lightSvc.dispose();
      this.fogSvc.dispose();
      return;
    }

    const scene = this.motor3d.getScene();
    const entity = this.entityManager.getEntityByMesh(selected);
    if (!entity) return;

    const subSelected = this.state.subObjetoSeleccionado();

    this.colliderSvc.update(scene, selected, entity, subSelected);
    this.cameraSvc.update(scene, selected, entity, subSelected);
    this.lightSvc.update(scene, selected, entity, subSelected);

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    const fogAnchor = this.getFogDebugAnchor(selected);

    this.fogSvc.update(scene, selected, entity, subSelected, fogAnchor, isBW, isFPS);
  }

  public syncBreathAnimations(obj: Mesh): void {
    if (!obj) return;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (!entity) return;

    let breathX = 0, breathY = 0, breathZ = 0;

    if (entity.initialHeadLocal) {
      const headNode = obj.getChildTransformNodes(false).find((n: any) =>
        n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')
      );
      if (headNode) {
        const currentGlobal = headNode.getAbsolutePosition();
        const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(obj.getWorldMatrix()));
        breathX = currentLocal.x - entity.initialHeadLocal.x;
        breathY = currentLocal.y - entity.initialHeadLocal.y;
        breathZ = currentLocal.z - entity.initialHeadLocal.z;
      }
    }

    const colMeta = entity.collider;
    if (colMeta) {
      // 🔥 CORRECCIÓN DEFINITIVA: El collider físico NUNCA debe seguir la respiración ni la cabeza.
      // Es un elemento rígido. Pasar los offsets de la cabeza causaba que el debug collider
      // mostrara una falsa desincronización con el jugador real en el Editor.
      this.colliderSvc.sync(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ, 0, 0, 0);
    }

    let cX = entity.camOffset.x || 0;
    let cY = entity.camOffset.y || 1.6;
    let cZ = entity.camOffset.z || 0;

    if (entity.characterConfig && entity.playerConfig) {
       cY = entity.playerConfig.camera.fpsEyeLevel;
    }

    this.cameraSvc.sync(cX, cY, cZ, breathX, breathY, breathZ);
    
    if (entity.type?.startsWith('light_') && entity.light) {
       this.lightSvc.sync(entity.light.lightPosX ?? 0, entity.light.lightPosY ?? 0, entity.light.lightPosZ ?? 0, breathX, breathY, breathZ);
    }

    const fogConfig = entity.playerConfig?.fog;
    if (fogConfig) {
      const fogShape = fogConfig.fogShape || 'cylinder';
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const isFPS = this.state.modoVistaPrueba === 'FPS';
      
      const hStartFpsBW = fogConfig.fogHeightYStartFpsBW ?? 4.0;
      const hStartTpsBW = fogConfig.fogHeightYStartTpsBW ?? 4.0;
      const hStartFPS = fogConfig.fogHeightYStartFPS ?? 4.0;
      const hStartTPS = fogConfig.fogHeightYStartTPS ?? 4.0;
      const fogHeightStart = Math.max(0.1, isBW ? (isFPS ? hStartFpsBW : hStartTpsBW) : (isFPS ? hStartFPS : hStartTPS));

      const hEndFpsBW = fogConfig.fogHeightYEndFpsBW ?? 10.0;
      const hEndTpsBW = fogConfig.fogHeightYEndTpsBW ?? 10.0;
      const hEndFPS = fogConfig.fogHeightYEndFPS ?? 10.0;
      const hEndTPS = fogConfig.fogHeightYEndTPS ?? 10.0;
      const fogHeightEnd = Math.max(0.1, isBW ? (isFPS ? hEndFpsBW : hEndTpsBW) : (isFPS ? hEndFPS : hEndTPS));

      const fogAnchor = this.getFogDebugAnchor(obj);
      this.fogSvc.sync(fogShape, fogHeightStart, fogHeightEnd, fogAnchor);
    }
  }
}