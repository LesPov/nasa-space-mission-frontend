
// file: src/app/core/engine/runtime/live/live-lifecycle-manager.service.ts
import { Injectable, inject } from '@angular/core';
import { Camera, AbstractMesh, Tags, Vector3, Node } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService, CameraOwner } from '../cameras/camera-ownership.service';
import { InputRouterService } from '../../session/input-router.service';
import { GameSession } from '../game-session';
import { PlayerCameraManagerService } from '../systems/player-camera.service';
import { GameEntity } from '../../entities/game.entity';
import { CinematicLogger } from '../cinematics/cinematic-logger';
import { DynamicLightingSystem } from '../systems/lighting/dynamic-lighting.system';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';
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
  private gameSession = inject(GameSession);
  private runtimeEngine = inject(RuntimeEngineService);
  private shadowQualitySvc = inject(ShadowQualityService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private dynLighting = inject(DynamicLightingSystem);
  private transformMutator = inject(TransformMutatorService);
  private gameState = inject(GameStateService);
  private sceneNodesSvc = inject(SceneNodesService);
  private playerTriggerSvc = inject(PlayerTriggerService);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private localRendering = inject(LocalRenderingSystem);
  private profiler = inject(EngineProfilerService);
  private spatialGroups = inject(SpatialStreamingGroupService);
  private sequenceSvc = inject(PlayerSequenceService);
  private fogRuntime = inject(FogRuntimeService);

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

    // 1. Limpiar estado de niebla en runtime
    this.fogRuntime.clear();

    // 2. Detener sesiones volátiles de gameplay y secuencias
    this.sequenceSvc.pauseExecution();
    this.sequenceSvc.resetearSecuencias();

    this.runtimeEngine.stopTestSession();
    this.localRendering.stop();
    this.spatialGroups.clear();

    this.playerCamSvc.updateFirstPersonVisibility(false);
    this.playerCamSvc.limpiarPivotTPS();

    // 3. Normalizar configuraciones globales de hardware conservando sombreadores en VRAM
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

    // 4. Restauración limpia de entidades: descartar las volátiles y restaurar backups autorales
    const entities = this.entityManager.getAllEntities();
    
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

      if (e.view && e.visual) {
        this.transformMutator.aplicarVisuales(e.view, e.visual);
      }
    }

    // 5. Reconciliación simétrica del pool de luces y sombras sin purgar materiales útiles
    this.dynLighting.reconcileSceneLights();
    this.shadowOrchestrator.reconcileShadows();

    // 6. Salir del sandbox de variables de juego y reactivar triggers de editor
    this.gameState.exitSandbox();
    this.playerTriggerSvc.start();
    this.sceneNodesSvc.actualizarListaNodos();

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