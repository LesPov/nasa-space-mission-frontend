
import { Injectable, inject } from '@angular/core';
import { Camera, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService, CameraOwner } from '../cameras/camera-ownership.service';
import { InputRouterService } from '../../session/input-router.service';
import { GameSession } from '../game-session';
import { PlayerCameraManagerService } from '../systems/player-camera.service';
import { GameEntity } from '../../entities/game.entity';
import { CameraViewMode } from '../../session/game-context.model';
import { CinematicLogger } from '../cinematics/cinematic-logger';
import { DynamicLightingSystem } from '../systems/lighting/dynamic-lighting.system';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';
import { GameStateService } from '../state/game-state.service';
import { SceneNodesService } from '../../../../services/editor/sceneservice/scene-nodes.service';
import { PlayerTriggerService } from '../systems/player-trigger.service';

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
  private playerCamSvc = inject(PlayerCameraManagerService);
  private dynLighting = inject(DynamicLightingSystem);
  private transformMutator = inject(TransformMutatorService);
  private gameState = inject(GameStateService);
  private sceneNodesSvc = inject(SceneNodesService);
  private playerTriggerSvc = inject(PlayerTriggerService);

  private isLiveActive = false;
  private savedEditorCameraState: EditorSnapshotState | null = null;
  private preLiveOwner: CameraOwner = 'NONE';
  private preLiveCamera: Camera | null = null;
  private testPlayerEntity: GameEntity | null = null;

  public get isRunning(): boolean {
    return this.isLiveActive;
  }

  /**
   * Captura el estado exacto del Editor (Cámara y Entidades) antes de entrar a Test Live.
   * 🔥 FASE 2: Memento Pattern para Autoría. No serializa a JSON.
   */
  public captureEditorState(): void {
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
    CinematicLogger.logTestLiveLifecycle('ENTER', this.preLiveOwner, this.preLiveCamera?.name);

    // 🔥 BACKUP EN MEMORIA DE LA AUTORÍA
    this.gameState.enterSandbox();
    this.entityManager.getAllEntities().forEach(e => {
        e.createAuthoringBackup();
    });
  }

  /**
   * Inicializa la sesión Live de forma aislada y controlada.
   */
  public startLiveSession(playerEntity: GameEntity, vista: CameraViewMode): void {
    this.isLiveActive = true;
    this.testPlayerEntity = playerEntity;

    this.gameContext.setEditorSubmode(vista === 'TPS' ? 'PLAYTEST_TPS' : 'PLAYTEST_FPS');

    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
    const editorCam = this.motor3d.getEditorCamera();
    if (editorCam && canvas) {
      try { editorCam.detachControl(); } catch {}
    }

    this.setEditorElementsVisibility(false);

    // Arrancar la sesión de juego
    this.gameSession.start(playerEntity, vista);

    // Asignar cámara según la perspectiva elegida
    const targetCam = vista === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS();
    this.ownership.setCamera(vista === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

    this.playerCamSvc.updateFirstPersonVisibility(vista === 'FPS');

    if (canvas && vista === 'FPS') {
      setTimeout(() => {
        if (this.isLiveActive) {
          this.inputRouter.lockPointer();
        }
      }, 100);
    }
  }

  /**
   * Finaliza la sesión Live, limpiando ÚNICAMENTE los artefactos temporales
   * sin tocar la escena 3D ni reconstruir los materiales.
   */
  public endLiveSession(): void {
    if (!this.isLiveActive) return;

    this.inputRouter.unlockPointer();
    this.gameSession.stop();

    this.playerCamSvc.updateFirstPersonVisibility(false);
    this.playerCamSvc.limpiarPivotTPS();

    // 🔥 RESTAURACIÓN DE LA AUTORÍA EN MEMORIA (FASE 2)
    const entities = this.entityManager.getAllEntities();
    
    // Lo recorremos en reversa para poder eliminar del array con seguridad
    for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        
        // 1. Basura del Runtime: Jugadores clonados, NPCs spawneados, Proyectiles, etc.
        if (e.isRuntimeOnly) {
            this.entityManager.removeEntity(e.uid);
            continue;
        }

        // 2. Objetos de Autoría: Revertimos sus mutaciones (Transforms, Luces, Colores)
        e.restoreAuthoringBackup();
        e.syncToView();

        if (e.type.startsWith('light_')) {
            this.dynLighting.syncLightImmediate(e);
        }

        if (e.view && e.visual) {
            this.transformMutator.aplicarVisuales(e.view, e.visual);
        }
    }

    this.gameState.exitSandbox();
    
    // Reseteamos el estado interno de los Triggers
    this.playerTriggerSvc.start();

    // Actualizamos el Outliner del Editor
    this.sceneNodesSvc.actualizarListaNodos();

    this.setEditorElementsVisibility(true);
    this.restoreEditorCamera();

    this.gameContext.setEditorSubmode('EDITING');
    this.gameContext.setSelectedNode(null);
    this.gameContext.setHoveredObject(null);

    this.testPlayerEntity = null;
    this.isLiveActive = false;

    CinematicLogger.logTestLiveLifecycle('EXIT', 'EDITOR', this.motor3d.getEditorCamera()?.name);
  }

  private setEditorElementsVisibility(visible: boolean): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    scene.meshes.forEach(m => {
      if (Tags.MatchesQuery(m, 'editor_only')) {
        m.setEnabled(visible);
        m.isVisible = visible;
      }

      const entity = this.entityManager.getEntityByMesh(m);
      if (entity) {
        if (entity.type.startsWith('light_') && !entity.visual.assetId) {
          m.isVisible = visible;
        }
        if (entity.type === 'image_plane') {
          m.isVisible = visible;
        }
        if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') {
          m.isVisible = visible;
        }
        if (entity.rol === 'spawn_point') {
          m.setEnabled(visible);
          m.isVisible = visible;
        }
      }
    });
  }

  private restoreEditorCamera(): void {
    const editorCam = this.motor3d.getEditorCamera();
    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();

    if (!editorCam) return;

    if (this.savedEditorCameraState) {
      editorCam.setTarget(this.savedEditorCameraState.cameraTarget.clone());
      editorCam.radius = this.savedEditorCameraState.cameraRadius;
      editorCam.alpha = this.savedEditorCameraState.cameraAlpha;
      editorCam.beta = this.savedEditorCameraState.cameraBeta;

      editorCam.inertialAlphaOffset = 0;
      editorCam.inertialBetaOffset = 0;
      editorCam.inertialRadiusOffset = 0;
      editorCam.inertialPanningX = 0;
      editorCam.inertialPanningY = 0;
    }

    this.ownership.setCamera('EDITOR', editorCam, canvas, true);

    if (canvas) {
      setTimeout(() => {
        try { editorCam.attachControl(canvas, true); } catch {}
      }, 50);
    }
  }
}