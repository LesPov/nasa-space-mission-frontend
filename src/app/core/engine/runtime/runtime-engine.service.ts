// file: src/app/core/engine/runtime/runtime-engine.service.ts
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
import { PlatformLifecycleService } from './systems/platform-lifecycle.service';
import { LoopManagerService } from '../behaviors/services/loop-manager.service';
import { EngineProfilerService } from '../telemetry/engine-profiler.service';
import { AdaptiveQualitySystem } from './systems/adaptive-quality.system';
 
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
  private platformLifecycle = inject(PlatformLifecycleService);
  private loopManager = inject(LoopManagerService);
  private adaptiveQuality = inject(AdaptiveQualitySystem);
  private profiler = inject(EngineProfilerService);

  private _prodClickFn: (() => void) | null = null;
  private adaptiveRegistered = false;

  public async bootProductionGame(episodeData: any, skipIntro: boolean = false): Promise<GameEntity> {
    this.motor3d.forceResize();
    this.loaderSvc.createInvisibleFloor(this.motor3d.getScene());
    
    if (!this.adaptiveRegistered) {
      this.loopManager.registerSystem(this.adaptiveQuality);
      this.profiler.setAdaptiveSystem(this.adaptiveQuality);
      this.adaptiveRegistered = true;
    }

    await this.loaderSvc.loadSceneFromData(episodeData);

    return new Promise((resolve, reject) => {
      this.motor3d.getScene().executeWhenReady(async () => {
        try {
            this.inputOrchestrator.attachToScene(this.motor3d.getScene());
            
            const spawnEntity = await this.spawnManager.resolvePlayerForSession(null, false);
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

            const activeView = this.gameContext.cameraView();

            this.playerCamSvc.inicializarCamaras(spawnEntity, activeView);
            const targetCam = activeView === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS();
            targetCam.getViewMatrix(true);
            
            const canvas = this.motor3d.getEngine().getRenderingCanvas();
            this.ownership.setCamera(activeView === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

            this.gameSession.start(spawnEntity, activeView);
            
            if (!skipIntro && activeView === 'TPS') {
               this.playerCamSvc.iniciarCinematicaIntro(spawnEntity);
            }

            if (canvas && !this._prodClickFn) {
              this._prodClickFn = () => {
                 if (this.gameContext.isPlaying() && !this.gameContext.isPointerLocked()) {
                    if (!skipIntro) this.playerCamSvc.detenerCinematicaIntro();
                    this.inputOrchestrator.lockPointer(); 
                 }
              };
              canvas.addEventListener('click', this._prodClickFn);
            }

            resolve(spawnEntity);
        } catch (e) {
            reject(e);
        }
      });
    });
  }

  public shutdownProductionGame(): void {
    this.playerCamSvc.updateFirstPersonVisibility(false);
    this.gameSession.stop();
    this.playerCamSvc.detenerCinematicaIntro(); 
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
    this.adminFreeCam.dispose();
    this.inputOrchestrator.unlockPointer();
    this.platformLifecycle.cleanCurrentPlatform();

    if (this.adaptiveRegistered) {
      this.loopManager.unregisterSystem(this.adaptiveQuality.id);
      this.adaptiveQuality.forceTier('HIGH');
      this.adaptiveRegistered = false;
    }

    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
    if (canvas && this._prodClickFn) {
       canvas.removeEventListener('click', this._prodClickFn);
       this._prodClickFn = null;
    }
  }

  public prepareTestSession(playerEntity: GameEntity, view: CameraViewMode): void {
    if (!this.adaptiveRegistered) {
      this.loopManager.registerSystem(this.adaptiveQuality);
      this.profiler.setAdaptiveSystem(this.adaptiveQuality);
      this.adaptiveRegistered = true;
    }

    this.resetVideos();
    this.spawnManager.resetPhysicsInertia(playerEntity);
    this.playerCamSvc.inicializarCamaras(playerEntity, view);
    
    const targetCam = view === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS();
    targetCam.getViewMatrix(true);
    
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    // Se activa la cámara de juego en Babylon, pero attachControl se mantiene en false durante la carga
    this.ownership.setCamera(view === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, false);
  }

  public activateTestSession(playerEntity: GameEntity, view: CameraViewMode): void {
    const targetCam = view === 'FPS' ? this.motor3d.getPlayerCameraFPS() : this.motor3d.getPlayerCameraTPS();
    targetCam.getViewMatrix(true);
    
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    this.ownership.setCamera(view === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', targetCam, canvas, true);

    this.gameSession.start(playerEntity, view);
  }

  public startTestSession(playerEntity: GameEntity, view: CameraViewMode): void {
    this.prepareTestSession(playerEntity, view);
    this.activateTestSession(playerEntity, view);
  }

  public stopTestSession(): void {
    if (this.adaptiveRegistered) {
      this.loopManager.unregisterSystem(this.adaptiveQuality.id);
      this.adaptiveQuality.forceTier('HIGH');
      this.adaptiveRegistered = false;
    }

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