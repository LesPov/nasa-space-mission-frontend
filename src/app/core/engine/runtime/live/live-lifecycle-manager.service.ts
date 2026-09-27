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

  private isLiveActive = false;
  private savedEditorCameraState: EditorSnapshotState | null = null;
  private preLiveOwner: CameraOwner = 'NONE';
  private preLiveCamera: Camera | null = null;
  private testPlayerEntity: GameEntity | null = null;

  public get isRunning(): boolean {
    return this.isLiveActive;
  }

  /**
   * Captura el estado exacto de la cámara y herramientas de edición antes de entrar a Test Live.
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
  }

  /**
   * Inicializa la sesión Live de forma aislada y controlada.
   */
  public startLiveSession(playerEntity: GameEntity, vista: CameraViewMode): void {
    this.isLiveActive = true;
    this.testPlayerEntity = playerEntity;

    // Aseguramos que el contexto se sincronice a TEST_LIVE
    this.gameContext.setEditorSubmode(vista === 'TPS' ? 'PLAYTEST_TPS' : 'PLAYTEST_FPS');

    // Desvincular controles de la cámara de editor
    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
    const editorCam = this.motor3d.getEditorCamera();
    if (editorCam && canvas) {
      try { editorCam.detachControl(); } catch {}
    }

    // Configuración de visibilidad de herramientas de editor
    this.setEditorElementsVisibility(false);

    // Arrancar la sesión de juego
    this.gameSession.start(playerEntity, vista);

    // Asignar cámara según la perspectiva elegida
    const targetCam = vista === 'FPS' 
      ? this.motor3d.getPlayerCameraFPS() 
      : this.motor3d.getPlayerCameraTPS();

    this.ownership.setCamera(vista === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

    // Aplicar visibilidad correcta para no hacer clipping en FPS
    this.playerCamSvc.updateFirstPersonVisibility(vista === 'FPS');

    // Bloquear puntero si es primera persona
    if (canvas && vista === 'FPS') {
      setTimeout(() => {
        if (this.isLiveActive) {
          this.inputRouter.lockPointer();
        }
      }, 100);
    }
  }

  /**
   * Finaliza la sesión Live, limpiando ÚNICAMENTE los artefactos temporales sin tocar la escena 3D ni los modelos.
   */
  public endLiveSession(): void {
    if (!this.isLiveActive) return;

    // 1. Liberar inmediatamente Pointer Lock en el navegador
    this.inputRouter.unlockPointer();

    // 2. Detener la sesión de juego (detiene inputs, cinemáticas y controladores)
    this.gameSession.stop();

    // 3. Restaurar la visibilidad del personaje si estaba en primera persona
    this.playerCamSvc.updateFirstPersonVisibility(false);
    this.playerCamSvc.limpiarPivotTPS();

    // 4. Resetear inercias físicas del player de prueba
    if (this.testPlayerEntity && this.testPlayerEntity.playerRuntime) {
      const state = this.testPlayerEntity.playerRuntime.physicsState;
      state.isMoving = false;
      state.isRunning = false;
      state.isJumping = false;
      state.isFalling = false;
      state.isHardLanding = false;
      state.isRecoveringFromFall = false;
      state.velocidadY = 0;

      this.testPlayerEntity.playerRuntime.intentions = {
        moveForward: false, moveBackward: false, moveLeft: false,
        moveRight: false, run: false, jump: false
      };

      // Si fue una cápsula temporal generada automáticamente, eliminarla
      if (this.testPlayerEntity.name === 'Jugador_Fallback_Auto' || this.testPlayerEntity.name === 'TempPlayer_Fallback') {
        this.entityManager.removeEntity(this.testPlayerEntity.uid);
      } else {
        // Objeto real del mapa: quitar el flag de persistencia para que pertenezca al editor
        this.testPlayerEntity.isPersistent = false;
        if (this.testPlayerEntity.view) {
          this.testPlayerEntity.view.visibility = 1;
          this.testPlayerEntity.view.getChildMeshes().forEach(m => m.visibility = 1);
        }
      }
    }

    // 5. Reactivar visibilidad de elementos del editor
    this.setEditorElementsVisibility(true);

    // 6. Restaurar la cámara del editor original
    this.restoreEditorCamera();

    // 7. Retornar contexto a EDITING
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
        try {
          editorCam.attachControl(canvas, true);
        } catch {}
      }, 50);
    }
  }
}