import { Injectable, inject } from '@angular/core';
import { Mesh, Tags, Vector3, Observer, Scene, ArcRotateCamera } from '@babylonjs/core';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { CameraViewMode } from '../../core/engine/session/game-context.model';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { SpawnManagerService } from '../../core/engine/runtime/systems/spawn-manager.service';
import { DynamicLightingSystem } from '../../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { ShadowOrchestratorService } from '../../core/engine/runtime/shadows/shadow-orchestrator.service';
import { CinematicLogger } from '../../core/engine/runtime/cinematics/cinematic-logger';
import { ToolsHighlightService } from './toolsservice/tools-highlight.service';

export interface EditorCameraSnapshot {
  target: Vector3;
  radius: number;
  alpha: number;
  beta: number;
  position: Vector3;
}

@Injectable({ providedIn: 'root' })
export class EditorPlayModeService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private runtimeEngine = inject(RuntimeEngineService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private gameContext = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private transitionSvc = inject(EditorModeTransitionService);
  private spawnManager = inject(SpawnManagerService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private highlightSvc = inject(ToolsHighlightService);

  private editorSnapshot: EditorCameraSnapshot | null = null;

  public async prepararEscenaParaTest(vista: CameraViewMode, skipIntro: boolean = false): Promise<void> {
    const editorCam = this.motor3d.getEditorCamera();
    if (editorCam) {
      editorCam.computeWorldMatrix();
      this.editorSnapshot = {
        target: editorCam.getTarget().clone(),
        radius: editorCam.radius,
        alpha: editorCam.alpha,
        beta: editorCam.beta,
        position: editorCam.globalPosition.clone()
      };
    }
    this.cameraSvc.guardarEstadoCamaraLibre();
    CinematicLogger.logTestLiveLifecycle('ENTER', 'EDITOR', editorCam?.name);

    let objMesh = this.state.objetoSeleccionado() as Mesh;
    let preferredEntity = objMesh ? this.entityManager.getEntityByMesh(objMesh) : null;
    const playerEntity = await this.spawnManager.resolvePlayerForSession(preferredEntity, true);

    if (!playerEntity || !playerEntity.view) return;
    objMesh = playerEntity.view as Mesh;

    this.gameContext.setCameraView(vista);
    this.state.seleccionarObjeto(null);
    this.gameContext.setActivePlayer(playerEntity);

    this.motor3d.getScene().meshes.forEach(m => {
      if (Tags.MatchesQuery(m, 'editor_only')) {
        m.isVisible = false;
        m.setEnabled(false);
      }

      const entity = this.entityManager.getEntityByMesh(m);
      if (entity) {
        if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = false;
        if (entity.type === 'image_plane') m.isVisible = false; 
        if (entity.rol === 'spawn_point' && entity.uid !== playerEntity!.uid) { 
          m.isVisible = false; 
          m.setEnabled(false); 
        }
      }
    });

    objMesh.computeWorldMatrix(true);
    const playerForward = objMesh.forward.clone().normalize();
    if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);

    const scaleY = objMesh.scaling.y || 1;
    const tpsMaxRadius = (playerEntity.playerConfig?.camera?.tpsRadius ?? 5) * scaleY;
    const rawTpsPivotY = playerEntity.playerConfig?.camera?.tpsPivotY ?? 1.5;
    const rawFpsEyeLevel = playerEntity.playerConfig?.camera?.fpsEyeLevel ?? 1.6;
    const camMeta = playerEntity.camOffset || { x: 0, y: 1.6, z: 0 };

    let targetLookAt: Vector3;
    let targetPos: Vector3;
    const localSpiralCenter = new Vector3(camMeta.x || 0, rawFpsEyeLevel, camMeta.z || 0);
    const centroEpiral = Vector3.TransformCoordinates(localSpiralCenter, objMesh.getWorldMatrix());

    if (vista === 'FPS') {
      const localCamPos = new Vector3(camMeta.x || 0, rawFpsEyeLevel, camMeta.z || 0);
      targetPos = Vector3.TransformCoordinates(localCamPos, objMesh.getWorldMatrix());
      targetLookAt = targetPos.add(playerForward.scale(10));
    } else {
      const localPivotPos = new Vector3(camMeta.x || 0, rawTpsPivotY, camMeta.z || 0);
      targetLookAt = Vector3.TransformCoordinates(localPivotPos, objMesh.getWorldMatrix());
      targetPos = targetLookAt.subtract(playerForward.scale(tpsMaxRadius));
    }

    this.dynamicLighting.prepareAllLights();
    this.shadowOrchestrator.asignarObjetosASombrasDeLuces();

    await new Promise<void>((resolve) => {
      this.motor3d.getScene().executeWhenReady(() => {
        this.dynamicLighting.start();
        this.shadowOrchestrator.start();
        for (let i = 0; i < 5; i++) { this.motor3d.getScene().render(); }
        this.motor3d.getScene().executeWhenReady(() => resolve());
      });
    });

    let hideObserver: Observer<Scene> | null = null;
    if (vista === 'FPS' && !skipIntro) {
      hideObserver = this.motor3d.getScene().onBeforeRenderObservable.add(() => {
        const cam = this.ownership.getCamera();
        if (cam && this.ownership.getOwner() === 'TRANSITION_PROXY') {
          const dist = Vector3.Distance(cam.globalPosition, targetPos);
          if (dist < 3.5) {
            let alpha = Math.max(0.0001, (dist - 0.5) / 3.0);
            alpha = alpha * alpha; 
            objMesh.visibility = alpha;
            objMesh.getChildMeshes().forEach(m => m.visibility = alpha);
          }
        }
      });
    }

    const finishSetup = () => {
      if (hideObserver) this.motor3d.getScene().onBeforeRenderObservable.remove(hideObserver);
      if (!skipIntro) this.transitionSvc.finishTestLiveTransition();
      this.runtimeEngine.startTestSession(playerEntity!, vista);

      setTimeout(() => {
        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        if (canvas) {
          const activeCam = this.ownership.getCamera();
          if (activeCam) {
            this.motor3d.getEditorCamera()?.detachControl();
            this.motor3d.getPlayerCameraFPS()?.detachControl();
            this.motor3d.getPlayerCameraTPS()?.detachControl();
            activeCam.attachControl(canvas, true);
            if (vista === 'FPS') {
              objMesh.visibility = 1;
              objMesh.getChildMeshes().forEach(m => m.visibility = 1);
            }
          }
        }
      }, 100);
    };

    if (skipIntro) finishSetup();
    else this.cameraSvc.volarHaciaCamaraJuego(centroEpiral, targetPos, targetLookAt, playerForward, vista === 'FPS', () => finishSetup());
  }

  public restaurarEscenaPostTest(isDebugMode: boolean): void {
    const scene = this.motor3d.getScene();
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    const editorCam = this.motor3d.getEditorCamera();

    this.ownership.releaseGameplayOwnership();

    try { this.motor3d.getPlayerCameraFPS()?.detachControl(); } catch {}
    try { this.motor3d.getPlayerCameraTPS()?.detachControl(); } catch {}

    scene.meshes.forEach(m => {
      // 🔥 CORE FIX: Ignoramos los visuales de luces completamente. El HighlightSvc los maneja.
      if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
        return; 
      }

      if (Tags.MatchesQuery(m, 'editor_only')) {
        m.setEnabled(true);
        m.isVisible = true;
      }

      const entity = this.entityManager.getEntityByMesh(m);
      if (entity) {
        // Los marcadores lógicos invisibles
        if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = isDebugMode;
        if (entity.type === 'bubble') m.isVisible = true;
        if (entity.type === 'image_plane') m.isVisible = isDebugMode; 
        if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') m.isVisible = isDebugMode;
        if (entity.rol === 'spawn_point') { 
          m.setEnabled(true); 
          m.isVisible = true; 
        }
      }
    });

    if (editorCam) {
      scene.activeCameras = [];
      scene.activeCamera = editorCam;

      if (this.editorSnapshot) {
        editorCam.setTarget(this.editorSnapshot.target.clone());
        editorCam.radius = this.editorSnapshot.radius;
        editorCam.alpha = this.editorSnapshot.alpha;
        editorCam.beta = this.editorSnapshot.beta;
      } else {
        this.cameraSvc.restaurarCamaraLibre();
      }

      editorCam.inertialAlphaOffset = 0;
      editorCam.inertialBetaOffset = 0;
      editorCam.inertialRadiusOffset = 0;
      editorCam.inertialPanningX = 0;
      editorCam.inertialPanningY = 0;

      this.ownership.setCamera('EDITOR', editorCam, canvas, true);
    }

    CinematicLogger.logTestLiveLifecycle('EXIT', 'EDITOR', editorCam?.name);
    this.editorSnapshot = null;
    
    // 🔥 Aseguramos que la escena quede limpia reseteando el Highlight Service
    this.highlightSvc.forceResetLightVisuals();
  }
}