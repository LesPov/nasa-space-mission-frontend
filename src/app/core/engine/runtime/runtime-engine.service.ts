
import { Injectable, inject } from '@angular/core';
import { StandardMaterial, VideoTexture, Color3, Mesh, Tags } from '@babylonjs/core';
import { GameSession } from './game-session';
import { PlayerCameraManagerService } from './systems/player-camera.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity } from '../entities/game.entity';
import { PlayerInteractionService } from './systems/player-interaction.service';
import { CoreSceneLoaderService } from '../scene/utils/core-scene-loader.service';
import { CameraViewMode } from '../session/game-context.model';
import { GameContextService } from '../session/game-context.service';
import { InputOrchestratorService } from './systems/input-orchestrator.service';
import { CameraOwnershipService } from './cameras/camera-ownership.service';
import { AdminFreeCameraService } from './cameras/admin-free-camera.service';
import { SpawnManagerService } from './systems/spawn-manager.service';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
  
@Injectable({ providedIn: 'root' })
export class RuntimeEngineService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private gameSession = inject(GameSession);
  private gameContext = inject(GameContextService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private entityManager = inject(EntityManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private loaderSvc = inject(CoreSceneLoaderService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private ownership = inject(CameraOwnershipService);
  private adminFreeCam = inject(AdminFreeCameraService);
  private spawnManager = inject(SpawnManagerService); 

  private _prodClickFn: (() => void) | null = null;

  public async bootProductionGame(episodeData: any, skipIntro: boolean = false): Promise<GameEntity> {
    this.entityManager.clear(); 
    
    this.motor3d.forceResize();
    this.loaderSvc.createInvisibleFloor(this.motor3d.getScene());
    
    await this.loaderSvc.loadSceneFromData(episodeData);

    return new Promise((resolve, reject) => {
      this.motor3d.getScene().executeWhenReady(() => {
        
        this.inputOrchestrator.attachToScene(this.motor3d.getScene());
        
        const spawnEntity = this.spawnManager.resolvePlayerForSession(null, false);

        if (!spawnEntity) {
          reject(new Error('No hay punto de aparición (Spawn Point) en el mapa.'));
          return;
        }

        this.resetVideos();

        this.motor3d.getScene().meshes.forEach(m => {
            if (Tags.MatchesQuery(m, "editor_only")) {
                m.isVisible = false;
                m.setEnabled(false);
            }
        });

        const activeView = skipIntro ? this.gameContext.cameraView() : 'TPS'; 

        this.playerCamSvc.inicializarCamaras(spawnEntity, activeView);
        const targetCam = activeView === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS();
        targetCam.getViewMatrix(true);
        
        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        this.ownership.setCamera(activeView === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

        this.gameSession.start(spawnEntity, activeView);
        
        if (!skipIntro) {
           this.playerCamSvc.iniciarCinematicaIntro(spawnEntity);
        }

        if (canvas) {
          this._prodClickFn = () => {
             if (this.gameContext.isPlaying() && !this.gameContext.isPointerLocked()) {
                if (!skipIntro) this.playerCamSvc.detenerCinematicaIntro();
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
    // 🔥 FIX: Restaurar la cabeza del jugador al Editor en caso de apagar la sesión en caliente
    this.playerCamSvc.updateFirstPersonVisibility(false);
    
    this.gameSession.stop();
    this.playerCamSvc.detenerCinematicaIntro(); 
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
    this.adminFreeCam.dispose();
    
    this.inputOrchestrator.unlockPointer();
    this.entityManager.clear();

    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
    if (canvas && this._prodClickFn) {
       canvas.removeEventListener('click', this._prodClickFn);
       this._prodClickFn = null;
    }
  }

  public startTestSession(playerEntity: GameEntity, view: CameraViewMode): void {
    this.resetVideos();
    this.spawnManager.resetPhysicsInertia(playerEntity);
    this.playerCamSvc.inicializarCamaras(playerEntity, view);
    
    const targetCam = view === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS();
    targetCam.getViewMatrix(true);
    
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    this.ownership.setCamera(view === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

    this.gameSession.start(playerEntity, view);
  }

  public stopTestSession(): void {
    // 🔥 FIX: Restaurar la cabeza del jugador al volver al Editor.
    this.playerCamSvc.updateFirstPersonVisibility(false);
    this.gameSession.stop();
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
  }

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