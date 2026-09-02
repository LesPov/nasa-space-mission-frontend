
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Tags, Vector3, Observer, Scene } from '@babylonjs/core';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { CameraViewMode } from '../../core/engine/session/game-context.model';
import { GameMode } from '../../core/engine/session/game-mode.model';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CAMERA_BEHAVIOR_PROFILES } from '../../core/engine/runtime/cameras/camera-behavior-profile.model';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { SpawnManagerService } from '../../core/engine/runtime/systems/spawn-manager.service';

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

  public prepararEscenaParaTest(vista: CameraViewMode, skipIntro: boolean = false): void {
    // 🔥 FIX: Guardar el estado de la cámara del editor antes de empezar para poder volver
    this.cameraSvc.guardarEstadoCamaraLibre();

    if (this.motor3d.getEditorCamera()) {
        this.motor3d.getEditorCamera().computeWorldMatrix();
    }

    let objMesh = this.state.objetoSeleccionado() as Mesh;
    let preferredEntity = objMesh ? this.entityManager.getEntityByMesh(objMesh) : null;
    
    const playerEntity = this.spawnManager.resolvePlayerForSession(preferredEntity, true);

    if (!playerEntity || !playerEntity.view) {
        console.warn("No hay personaje jugable ni spawn point para iniciar el Test Live.");
        return;
    }

    objMesh = playerEntity.view as Mesh;

    this.gameContext.setCameraView(vista);
    this.state.seleccionarObjeto(null);
    
    this.motor3d.getScene().meshes.forEach(m => {
        if (Tags.MatchesQuery(m, "editor_only")) {
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

    let hideObserver: Observer<Scene> | null = null;
    
    if (vista === 'FPS' && !skipIntro) {
      hideObserver = this.motor3d.getScene().onBeforeRenderObservable.add(() => {
        const cam = this.ownership.getCamera();
        if (cam && this.ownership.getOwner() === 'TRANSITION_PROXY') {
          const dist = Vector3.Distance(cam.globalPosition, targetPos);
          if (dist < 3.5) {
            let alpha = Math.max(0, (dist - 0.5) / 3.0);
            alpha = alpha * alpha; 
            objMesh.visibility = alpha;
            objMesh.getChildMeshes().forEach(m => m.visibility = alpha);
          }
        }
      });
    }

    const finishSetup = () => {
        if (hideObserver) {
          this.motor3d.getScene().onBeforeRenderObservable.remove(hideObserver);
        }

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
                      objMesh.visibility = 0;
                      objMesh.getChildMeshes().forEach(m => m.visibility = 0);
                    }
                }
            }
        }, 100);
    };

    if (skipIntro) {
      finishSetup();
    } else {
      this.cameraSvc.volarHaciaCamaraJuego(
          centroEpiral, targetPos, targetLookAt, playerForward, vista === 'FPS', () => finishSetup()
      );
    }
  }

  public restaurarEscenaPostTest(isDebugMode: boolean): void {
    this.motor3d.getScene().meshes.forEach(m => {
        if (Tags.MatchesQuery(m, "editor_only")) {
            m.setEnabled(true);
            m.isVisible = true;
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
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

    // 🔥 FIX: Restaurar la cámara que guardamos antes de iniciar el Test Live
    this.cameraSvc.restaurarCamaraLibre();
    const editorCam = this.motor3d.getEditorCamera();
    
    this.inputOrchestrator.unlockPointer();
    
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    this.ownership.setCamera('EDITOR', editorCam, canvas, true);
  }
}