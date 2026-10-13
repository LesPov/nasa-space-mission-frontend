
// file: src/app/services/editor/toolsservice/tools-debug.service.ts
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Matrix } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { ToolsSelectionService } from './tools-selection.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { ToolsDebugColliderService } from './tools-debug-collider.service';
import { ToolsDebugCameraService } from './tools-debug-camera.service';
import { ToolsDebugFogService } from './tools-debug-fog.service';
import { ToolsDebugVisualCenterService } from './tools-debug-visual-center.service';
import { ToolsDebugLightRangeService } from './tools-debug-light-range.service';
import { ToolsDebugPortalsService } from './tools-debug-portals.service';

@Injectable({ providedIn: 'root' })
export class ToolsDebugService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private selectionSvc = inject(ToolsSelectionService);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);

  private colliderSvc = inject(ToolsDebugColliderService);
  private cameraSvc = inject(ToolsDebugCameraService);
  private fogSvc = inject(ToolsDebugFogService);
  private visualCenterSvc = inject(ToolsDebugVisualCenterService);
  private lightRangeSvc = inject(ToolsDebugLightRangeService);
  public portalsSvc = inject(ToolsDebugPortalsService);

  get debugCollider() { return this.colliderSvc.debugCollider; }
  get debugCameraBox() { return this.cameraSvc.debugCameraBox; }
  get debugFogStartSphere() { return this.fogSvc.debugFogStartSphere; }
  get debugFogEndSphere() { return this.fogSvc.debugFogEndSphere; }

  public actualizarDebugMeshes(selected: Mesh | null): void {
    const playState = this.state.playState();
    if (!selected || (playState !== 'EDITOR' && playState !== 'EDITING_IN_GAME')) {
      this.colliderSvc.dispose();
      this.cameraSvc.dispose();
      this.fogSvc.dispose();
      this.visualCenterSvc.dispose();
      this.lightRangeSvc.dispose();
      this.portalsSvc.dispose();
      return;
    }

    const scene = this.motor3d.getScene();
    const entity = this.entityManager.getEntityByMesh(selected);
    if (!entity) return;

    const subSelected = this.state.subObjetoSeleccionado();

    this.colliderSvc.update(scene, selected, entity, subSelected);
    this.cameraSvc.update(scene, selected, entity, subSelected);
    this.visualCenterSvc.update(scene, selected, entity, subSelected);
    this.lightRangeSvc.update(scene, selected, entity, subSelected);
    this.portalsSvc.update(scene, entity);

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    const fogAnchor = this.getFogDebugAnchor(selected);

    this.fogSvc.update(scene, selected, entity, subSelected, fogAnchor, isBW, isFPS);
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

  public syncBreathAnimations(obj: Mesh): void {
    if (!obj) return;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (!entity) return;

    this.colliderSvc.sync(entity.collider?.offsetX || 0, entity.collider?.offsetY || 0, entity.collider?.offsetZ || 0, 0, 0, 0);
    this.lightRangeSvc.sync();
  }
}