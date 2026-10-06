// file: src/app/core/engine/runtime/live/live-lifecycle-manager.service.ts
import { Injectable, inject } from '@angular/core';
import { Camera, AbstractMesh, Tags, Vector3, Node } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService, CameraOwner } from '../cameras/camera-ownership.service';
import { InputRouterService } from '../../session/input-router.service';
import { PlayerCameraManagerService } from '../systems/player-camera.service';
import { GameEntity } from '../../entities/game.entity';
import { CinematicLogger } from '../cinematics/cinematic-logger';
import { DynamicLightingSystem } from '../systems/lighting/dynamic-lighting.system';
import { GameStateService } from '../state/game-state.service';
import { SceneNodesService } from '../../../../services/editor/sceneservice/scene-nodes.service';
import { PlayerTriggerService } from '../systems/player-trigger.service';
import { ShadowOrchestratorService } from '../shadows/shadow-orchestrator.service';
import { LocalRenderingSystem } from '../systems/local-rendering.system';
import { RuntimeEngineService } from '../runtime-engine.service';
import { ShadowQualityService } from '../shadows/shadow-quality.service';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
import { SpatialStreamingGroupService } from '../../spatial/spatial-streaming-group.service';
import { PlayerSequenceService } from '../systems/player-sequence.service';
import { FogRuntimeService } from '../systems/fog/fog-runtime.service';
import { CoreSceneMaterialService } from '../../scene/utils/core-scene-material.service';

export interface EditorSnapshotState {
  cameraTarget: Vector3;
  cameraRadius: number;
  cameraAlpha: number;
  cameraBeta: number;
  cameraPosition: Vector3;
}

@Injectable({ providedIn: 'root' })
export class LiveLifecycleManagerService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private gameContext = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private inputRouter = inject(InputRouterService);
  private runtimeEngine = inject(RuntimeEngineService);
  private shadowQualitySvc = inject(ShadowQualityService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private dynLighting = inject(DynamicLightingSystem);
  private gameState = inject(GameStateService);
  private sceneNodesSvc = inject(SceneNodesService);
  private playerTriggerSvc = inject(PlayerTriggerService);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private localRendering = inject(LocalRenderingSystem);
  private profiler = inject(EngineProfilerService);
  private spatialGroups = inject(SpatialStreamingGroupService);
  private sequenceSvc = inject(PlayerSequenceService);
  private fogRuntime = inject(FogRuntimeService);
  private materialSvc = inject(CoreSceneMaterialService);

  private isLiveActive = false;
  private savedEditorCameraState: EditorSnapshotState | null = null;
  private preLiveOwner: CameraOwner = 'NONE';
  private preLiveCamera: Camera | null = null;
  private savedSelection: Node | null = null;

  private entryCounter = 0;

  public get isRunning(): boolean {
    return this.isLiveActive;
  }

  public captureEditorState(): void {
    this.entryCounter++;
    const sessionId = `tl_${Date.now()}_${this.entryCounter}`;
    this.profiler.notifySessionEntry(sessionId, this.entryCounter);

    const editorCam = this.motor3d.getEditorCamera();
    if (editorCam) {
      editorCam.computeWorldMatrix();
      this.savedEditorCameraState = {
        cameraTarget: editorCam.getTarget().clone(),
        cameraRadius: editorCam.radius,
        cameraAlpha: editorCam.alpha,
        cameraBeta: editorCam.beta,
        cameraPosition: editorCam.globalPosition.clone()
      };
    }

    this.preLiveOwner = this.ownership.getOwner();
    this.preLiveCamera = this.ownership.getCamera();
    this.savedSelection = this.gameContext.selectedNode();

    CinematicLogger.logTestLiveLifecycle('ENTER', this.preLiveOwner, this.preLiveCamera?.name);

    this.gameState.enterSandbox();
    this.entityManager.getAllEntities().forEach(e => {
      e.createAuthoringBackup();
      if (e.view && e.view.material) {
        this.materialSvc.capturarEstadoAutoral(e.view.material);
        e.view.getChildMeshes(false).forEach(m => {
          if (m.material) this.materialSvc.capturarEstadoAutoral(m.material);
        });
      }
      if (e.characterConfig || e.rol === 'player') {
        e.movementAuthority = 'GAMEPLAY';
        if (e.playerRuntime) {
          e.playerRuntime.cinematicAnimation = null;
          e.playerRuntime.cinematicClipOverride = null;
          e.playerRuntime.seqRuntime = null;
        }
      }
    });

    const playerEntity = this.gameContext.activePlayerEntity();
    this.fogRuntime.initForTestLive(playerEntity);
    
    this.isLiveActive = true;
  }

  public endLiveSession(): void {
    if (!this.isLiveActive) return;

    this.profiler.recordTimelineEvent('LIFECYCLE', 'END_LIVE_SESSION_START', {
      entryNumber: this.entryCounter
    });

    this.inputRouter.unlockPointer();

    // 1. Limpieza de runtime efímero
    this.fogRuntime.clear();
    this.sequenceSvc.pauseExecution();
    this.sequenceSvc.resetearSecuencias();

    this.runtimeEngine.stopTestSession();
    this.localRendering.stop();
    this.spatialGroups.clear();

    this.playerCamSvc.updateFirstPersonVisibility(false);
    this.playerCamSvc.limpiarPivotTPS();

    // 2. Normalización de hardware de motor
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

    // 3. Restauración limpia e idempotente de entidades y materiales autorales
    const entities = this.entityManager.getAllEntities();
    const scene = this.motor3d.getScene();
    
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      
      if (e.isRuntimeOnly) {
        this.entityManager.removeEntity(e.uid);
        continue;
      }

      e.restoreAuthoringBackup();
      e.movementAuthority = 'GAMEPLAY';
      if (e.playerRuntime) {
        e.playerRuntime.cinematicAnimation = null;
        e.playerRuntime.cinematicClipOverride = null;
        e.playerRuntime.seqRuntime = null;
      }
      e.syncToView();

      // Restauración física estricta de materiales para que NUNCA queden sin textura en Editor
      if (e.view && !e.view.isDisposed()) {
        if (e.view.material) {
          this.materialSvc.restaurarEstadoAutoral(e.view.material);
        }
        e.view.getChildMeshes(false).forEach(m => {
          if (m.material) {
            this.materialSvc.restaurarEstadoAutoral(m.material);
          }
        });

        const isModelBased = e.type === 'model' || (e.type.startsWith('light_') && (!!e.visual?.assetId || !!e.visual?.path));
        if (isModelBased && e.partOverrides?.overrides) {
          const overrides = e.partOverrides.overrides;
          e.view.getChildMeshes(false).forEach(m => {
            const ov = overrides[m.name];
            if (ov && m.material) {
              this.materialSvc.ajustarMaterialGLB(
                m.material, false, scene,
                ov.color, ov.color, ov.esEmisivo ?? false,
                ov.brilloIntensidad ?? 1.0, ov.texturePath,
                ov.textureSource || (ov.texturePath ? 'asset' : 'original'),
                true
              );
            }
          });
        }
      }
    }

    // 4. Limpieza del pool de luces y sombras sin purgar materiales de VRAM
    this.dynLighting.stop();
    this.shadowOrchestrator.reconcileShadows();

    // 5. Salir del sandbox y restaurar visibilidad completa de mallas del editor
    this.gameState.exitSandbox();
    this.playerTriggerSvc.start();
    this.sceneNodesSvc.actualizarListaNodos();

    this.localRendering.ensureAllEntitiesVisibleForEditor();

    this.gameContext.setEditorSubmode('EDITING');
    
    if (this.savedSelection && !this.savedSelection.isDisposed()) {
      this.gameContext.setSelectedNode(this.savedSelection);
    } else {
      this.gameContext.setSelectedNode(null);
    }
    
    this.gameContext.setHoveredObject(null);
    this.isLiveActive = false;

    this.profiler.recordTimelineEvent('LIFECYCLE', 'RESTORE_EDITOR_COMPLETE', {
      entryNumber: this.entryCounter
    });

    CinematicLogger.logTestLiveLifecycle('EXIT', 'EDITOR', this.motor3d.getEditorCamera()?.name);
  }
}