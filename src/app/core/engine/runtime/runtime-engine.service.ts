import { Injectable, inject } from '@angular/core';
import { StandardMaterial, VideoTexture, Color3, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../../services/motor-3d.service';
import { GameSession } from './game-session';
import { PlayerCameraManagerService } from './systems/player-camera.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity } from '../entities/game.entity';
import { PlayerInteractionService } from './systems/player-interaction.service';
import { CoreSceneLoaderService } from '../scene/utils/core-scene-loader.service';
import { CameraViewMode } from '../session/game-context.model';
import { GameMode } from '../session/game-mode.model';
import { GameContextService } from '../session/game-context.service';
import { InputOrchestratorService } from './systems/input-orchestrator.service';
import { CameraOwnershipService } from './cameras/camera-ownership.service';
import { AdminFreeCameraService } from './cameras/admin-free-camera.service';
import { AuthService } from '../../services/auth';
  
@Injectable({ providedIn: 'root' })
export class RuntimeEngineService {
  private motor3d = inject(Motor3dService);
  private gameSession = inject(GameSession);
  private gameContext = inject(GameContextService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private entityManager = inject(EntityManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private loaderSvc = inject(CoreSceneLoaderService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private ownership = inject(CameraOwnershipService);
  private adminFreeCam = inject(AdminFreeCameraService);
  private authSvc = inject(AuthService);

  private _prodClickFn: (() => void) | null = null;

  private resetPhysicsState(entity: GameEntity): void {
    if (!entity || !entity.playerRuntime) return;
    const state = entity.playerRuntime.physicsState;
    state.velocidadY = -0.05;
    state.isMoving = false;
    state.isRunning = false;
    state.isJumping = false;
    state.isFalling = false;
    state.isHardLanding = false;
    state.isRecoveringFromFall = false;
    
    entity.playerRuntime.intentions = {
      moveForward: false, moveBackward: false, moveLeft: false, 
      moveRight: false, run: false, jump: false
    };
  }

  // ==========================================
  // MODO PRODUCCIÓN (JUEGO PURO SIN EDITOR)
  // ==========================================
  public async bootProductionGame(episodeData: any): Promise<GameEntity> {
    this.entityManager.clear(); 
    
    this.motor3d.forzarRedimension();
    this.loaderSvc.createInvisibleFloor(this.motor3d.scene);
    
    await this.loaderSvc.loadSceneFromData(episodeData);

    return new Promise((resolve, reject) => {
      this.motor3d.scene.executeWhenReady(() => {
        const characters = this.entityManager.getEntitiesWithComponent('characterConfig');
        const spawnEntity = characters.find(c => c.characterConfig?.isPlayable) || characters[0];
        
        if (!spawnEntity) {
          reject(new Error('No hay punto de aparición (Spawn Point) en el mapa.'));
          return;
        }

        this.resetVideos();
        this.resetPhysicsState(spawnEntity);

        const isAdmin = this.authSvc.isAdmin();
        const mode = isAdmin ? GameMode.PREVIEW_ADMIN : GameMode.FINAL_USER;
        this.gameContext.setMode(mode);

        this.playerCamSvc.inicializarCamaras(spawnEntity, 'TPS');
        const targetCam = this.motor3d.playerCameraTPS;
        targetCam.getViewMatrix(true);
        
        const canvas = this.motor3d.engine.getRenderingCanvas();
        this.ownership.setCamera('PLAYER_TPS', targetCam, canvas, true);

        this.gameSession.start(spawnEntity, 'TPS');
        this.playerCamSvc.iniciarCinematicaIntro(spawnEntity);

        if (canvas) {
          this._prodClickFn = () => {
             if (this.gameContext.isPlaying() && !document.pointerLockElement) {
                this.playerCamSvc.detenerCinematicaIntro();
                this.inputOrchestrator.lockPointer(); 
             }
          };
          canvas.addEventListener('click', this._prodClickFn);
        }

        resolve(spawnEntity);
      });
    });
  }

  public shutdownProductionGame(): void {
    this.gameSession.stop();
    this.playerCamSvc.detenerCinematicaIntro(); 
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
    this.adminFreeCam.dispose();
    
    this.inputOrchestrator.unlockPointer();
    this.entityManager.clear();

    const canvas = this.motor3d.engine?.getRenderingCanvas();
    if (canvas && this._prodClickFn) {
       canvas.removeEventListener('click', this._prodClickFn);
       this._prodClickFn = null;
    }
  }

  // ==========================================
  // MODO TEST (PUENTE CON EL EDITOR)
  // ==========================================
  public startTestSession(playerEntity: GameEntity, view: CameraViewMode): void {
    this.resetVideos();
    this.resetPhysicsState(playerEntity);
    this.playerCamSvc.inicializarCamaras(playerEntity, view);
    
    const targetCam = view === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    targetCam.getViewMatrix(true);
    
    const canvas = this.motor3d.engine.getRenderingCanvas();
    this.ownership.setCamera(view === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

    this.gameContext.setMode(GameMode.TEST_LIVE);
    this.gameSession.start(playerEntity, view);
  }

  public stopTestSession(): void {
    this.gameSession.stop();
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
  }

  // ==========================================
  // UTILIDADES GLOBALES DE JUGADOR
  // ==========================================
  public toggleCameraUser(isCinematicInitial: boolean = false, customFrames?: number): void {
    this.gameSession.toggleCameraUser(isCinematicInitial, customFrames);
  }

  public cerrarInteraccion(): void {
    this.interactSvc.cerrarMensajeInteractivo();
  }

  private resetVideos(): void {
    const entities = this.entityManager.getAllEntities();
    entities.forEach(entity => {
      if (entity.type === 'video_plane' && entity.view) {
        const mesh = entity.view as Mesh;
        if (mesh.material instanceof StandardMaterial) {
          const tex = mesh.material.diffuseTexture;
          if (tex instanceof VideoTexture) {
            tex.video.pause();
            tex.video.currentTime = 0;
            mesh.material.emissiveColor = new Color3(0, 0, 0); 
          }
        }
      }
    });
  }
}