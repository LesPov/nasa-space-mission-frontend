
// file: src/app/services/editor/editor-play-mode.service.ts
import { Injectable, inject } from '@angular/core';
import { Mesh, Tags, Vector3, AbstractMesh } from '@babylonjs/core';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { CameraViewMode } from '../../core/engine/session/game-context.model';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { SpawnManagerService } from '../../core/engine/runtime/systems/spawn-manager.service';
import { DynamicLightingSystem } from '../../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { ShadowOrchestratorService } from '../../core/engine/runtime/shadows/shadow-orchestrator.service';
import { CinematicLogger } from '../../core/engine/runtime/cinematics/cinematic-logger';
import { ToolsHighlightService } from './toolsservice/tools-highlight.service';
import { LocalRenderingSystem } from '../../core/engine/runtime/systems/local-rendering.system';
import { FogOrchestratorService } from '../../core/engine/runtime/systems/fog-orchestrator.service';
import { PlayerInputService } from '../../core/engine/runtime/systems/player-input.service';
import { EngineProfilerService } from '../../core/engine/telemetry/engine-profiler.service';
import { SpatialStreamingGroupService } from '../../core/engine/spatial/spatial-streaming-group.service';
import { ShadowQualityService } from '../../core/engine/runtime/shadows/shadow-quality.service';
import { PlayerSequenceService } from '../../core/engine/runtime/systems/player-sequence.service';
import { PerformanceIncidentService } from '../../core/engine/telemetry/performance-incident.service';
import { RuntimeReadinessBarrierService } from '../../core/engine/runtime/live/runtime-readiness-barrier.service';

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
  private gameContext = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private transitionSvc = inject(EditorModeTransitionService);
  private spawnManager = inject(SpawnManagerService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private shadowQualitySvc = inject(ShadowQualityService);
  private highlightSvc = inject(ToolsHighlightService);
  private localRendering = inject(LocalRenderingSystem);
  private fogOrchestrator = inject(FogOrchestratorService);
  private inputSvc = inject(PlayerInputService);
  private profiler = inject(EngineProfilerService);
  private spatialGroups = inject(SpatialStreamingGroupService);
  private readinessBarrier = inject(RuntimeReadinessBarrierService);
  private sequenceSvc = inject(PlayerSequenceService);
  private incidentSvc = inject(PerformanceIncidentService);

  private editorSnapshot: EditorCameraSnapshot | null = null;
  private pendingFlightParams: any = null;
  private flightObserver: any = null;

  public async prepararEscenaParaTest(vista: CameraViewMode, onProgress?: (msg: string, pct?: number) => void): Promise<void> {
    const scene = this.motor3d.getScene();
    const editorCam = this.motor3d.getEditorCamera();

    this.sequenceSvc.pauseExecution();
    this.sequenceSvc.resetearSecuencias();

    this.profiler.beginTransitionTracking('CAPTURE_EDITOR_STATE');
    this.readinessBarrier.startReadiness(8);

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

    this.readinessBarrier.setStage('RESOLVING_PLAYER', 'Resolviendo jugador y punto de aparición...');
    if (onProgress) onProgress('Resolviendo jugador y punto de aparición...', 15);

    let objMesh = this.state.objetoSeleccionado() as Mesh;
    let preferredEntity = objMesh ? this.entityManager.getEntityByMesh(objMesh) : null;
    const playerEntity = await this.spawnManager.resolvePlayerForSession(preferredEntity, true);

    if (!playerEntity || !playerEntity.view) throw new Error("Player not resolved");
    objMesh = playerEntity.view as Mesh;

    this.spawnManager.resetPhysicsInertia(playerEntity);
    playerEntity.movementAuthority = 'GAMEPLAY';

    if (playerEntity.playerRuntime) {
      playerEntity.playerRuntime.cinematicAnimation = null;
      playerEntity.playerRuntime.cinematicClipOverride = null;
      playerEntity.playerRuntime.seqRuntime = {
        step: null,
        lockInput: false,
        allowMovement: true,
        forceForwardWalk: false,
        forceForwardRun: false,
        forceJump: false,
        blend: 0.1,
        loop: true,
        running: false,
        freezeOrientation: false,
        rootMotion: Vector3.Zero()
      };
    }

    this.gameContext.setCameraView(vista);
    this.state.seleccionarObjeto(null);
    this.gameContext.setActivePlayer(playerEntity);

    this.readinessBarrier.setStage('BUILDING_SPATIAL_GROUPS', 'Estructurando grupos espaciales...');
    if (onProgress) onProgress('Estructurando grupos espaciales...', 30);
    this.spatialGroups.buildGroups();

    this.readinessBarrier.setStage('PREPARING_RESOURCES', 'Inicializando burbuja crítica visual...');
    if (onProgress) onProgress('Inicializando burbuja crítica visual...', 45);

    objMesh.computeWorldMatrix(true);
    const spawnPos = objMesh.getAbsolutePosition().clone();
    this.localRendering.reconcileAllEntitiesImmediate(spawnPos);

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

    this.readinessBarrier.setStage('PREPARING_LIGHTS', 'Preparando iluminación local en spawn...');
    if (onProgress) onProgress('Preparando iluminación local en spawn...', 60);
    this.dynamicLighting.reconcileSceneLights();
    this.shadowOrchestrator.reconcileShadows();

    this.readinessBarrier.setStage('COMPILING_SHADERS', 'Precalentando sombreadores en VRAM...');
    if (onProgress) onProgress('Precalentando sombreadores en VRAM...', 75);
    await this.dynamicLighting.forceWarmup(spawnPos);

    this.pendingFlightParams = {
      centroEpiral, targetPos, targetLookAt, playerForward, vista, playerEntity, objMesh, spawnPos
    };
  }

  public async iniciarVueloCamara(vista: CameraViewMode): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.pendingFlightParams) {
        resolve();
        return;
      }
      
      this.readinessBarrier.setStage('WARMING_RENDER', 'Desplazando cámara a posición inicial...');
      const { centroEpiral, targetPos, targetLookAt, playerForward, objMesh } = this.pendingFlightParams;

      if (vista === 'FPS') {
        this.flightObserver = this.motor3d.getScene().onBeforeRenderObservable.add(() => {
          const cam = this.ownership.getCamera();
          if (cam && this.ownership.getOwner() === 'TRANSITION_PROXY') {
            const dist = Vector3.Distance(cam.globalPosition, targetPos);
            if (dist < 3.5) {
              let alpha = Math.max(0.0001, (dist - 0.5) / 3.0);
              alpha = alpha * alpha; 
              objMesh.visibility = alpha;
              objMesh.getChildMeshes().forEach((m: any) => m.visibility = alpha);
            }
          }
        });
      }

      this.cameraSvc.volarHaciaCamaraJuego(centroEpiral, targetPos, targetLookAt, playerForward, vista === 'FPS', () => {
        if (this.flightObserver) {
          this.motor3d.getScene().onBeforeRenderObservable.remove(this.flightObserver);
          this.flightObserver = null;
        }
        resolve();
      });
    });
  }

  public async estabilizarEntornoVisual(vista: CameraViewMode, onProgress?: (msg: string, pct?: number) => void): Promise<void> {
    const scene = this.motor3d.getScene();
    if (!this.pendingFlightParams) return;
    const { spawnPos } = this.pendingFlightParams;

    this.fogOrchestrator.forceSnapNextFrame();
    this.localRendering.reconcileAllEntitiesImmediate(spawnPos);
    await this.dynamicLighting.forceWarmup(spawnPos);
    this.shadowOrchestrator.reconcileShadows();

    await this.readinessBarrier.waitForTrueStability(scene, spawnPos, 60.0, 6, 12.0, (msg, pct) => {
      if (onProgress) onProgress(msg, 75 + Math.round(pct * 0.25));
    });
  }

  public async finalizarEntradaTestLive(vista: CameraViewMode, skippedIntro: boolean): Promise<void> {
    if (!this.pendingFlightParams) return;
    const { playerEntity, objMesh } = this.pendingFlightParams;

    if (this.flightObserver) {
      this.motor3d.getScene().onBeforeRenderObservable.remove(this.flightObserver);
      this.flightObserver = null;
    }

    if (!skippedIntro) {
      this.transitionSvc.finishTestLiveTransition();
    }

    this.spawnManager.resetPhysicsInertia(playerEntity);
    playerEntity.movementAuthority = 'GAMEPLAY';
    this.runtimeEngine.startTestSession(playerEntity, vista);

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
          objMesh.getChildMeshes().forEach((m: any) => m.visibility = 1);
        }
      }
      canvas.focus();
    }

    this.inputSvc.start();
    this.inputSvc.enable();
    this.inputSvc.resetearInputs();

    this.incidentSvc.notifyTransitionEnded();

    this.sequenceSvc.resumeExecution();
    this.sequenceSvc.queueAutoPlaySequencesStaggered();

    this.pendingFlightParams = null;
    this.readinessBarrier.reset();
    this.profiler.endTransitionTracking();
  }

  public restaurarEscenaPostTest(canSelectHidden: boolean): void {
    const scene = this.motor3d.getScene();
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    const editorCam = this.motor3d.getEditorCamera();

    this.incidentSvc.notifyTransitionEnded();

    this.sequenceSvc.pauseExecution();
    this.sequenceSvc.resetearSecuencias();

    this.readinessBarrier.reset();
    this.spatialGroups.clear();
    this.ownership.releaseGameplayOwnership();

    try { this.motor3d.getPlayerCameraFPS()?.detachControl(); } catch {}
    try { this.motor3d.getPlayerCameraTPS()?.detachControl(); } catch {}

    const engine = this.motor3d.getEngine();
    if (engine) {
      engine.setHardwareScalingLevel(1.0);
    }
    const pipeline = this.motor3d.getRenderingPipeline();
    if (pipeline) {
      pipeline.fxaaEnabled = true;
    }
    const glow = (this.motor3d as any).glowLayer;
    if (glow) {
      glow.intensity = 0.6;
    }
    this.shadowQualitySvc.setQualityTier('HIGH');

    scene.meshes.forEach(m => {
      if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
        return; 
      }

      const entity = this.entityManager.getEntityByMesh(m);
      if (entity && entity.isManuallyHidden) {
        m.isVisible = false;
        m.setEnabled(false);
        return;
      }

      if (Tags.MatchesQuery(m, 'editor_only')) {
        m.setEnabled(true);
        m.isVisible = true;
      }

      if (entity) {
        m.setEnabled(true);
        m.isVisible = true;
        m.visibility = 1.0;
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
    this.pendingFlightParams = null;
    
    this.highlightSvc.forceResetLightVisuals();
  }
}