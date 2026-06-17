import { Injectable, inject } from '@angular/core';
import { StandardMaterial, VideoTexture, Color3, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../services/motor-3d.service';
import { GameSession } from './game-session';
import { PlayerCameraManagerService } from '../../services/editor/playerservice/player-camera.service';
import { EntityManagerService } from './entities/entity-manager.service';
import { GameEntity } from './entities/game.entity';
import { EpisodiosService } from '../../services/api/episodios';
import { SceneLoaderService } from '../../services/editor/sceneservice/scene-loader.service';
import { SceneEnvironmentService } from '../../services/editor/sceneservice/scene-environment.service';

@Injectable({ providedIn: 'root' })
export class RuntimeEngineService {
  private motor3d = inject(Motor3dService);
  private gameSession = inject(GameSession);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private entityManager = inject(EntityManagerService);
  private epiApiSvc = inject(EpisodiosService);
  private loaderSvc = inject(SceneLoaderService);
  private envSvc = inject(SceneEnvironmentService);

  public startSession(playerEntity: GameEntity, view: 'FPS' | 'TPS', isAdmin: boolean): void {
    this.resetVideos();
    this.playerCamSvc.inicializarCamaras(playerEntity, view);
    
    const targetCam = view === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    targetCam.getViewMatrix(true);
    this.motor3d.scene.activeCamera = targetCam;

    this.gameSession.start(playerEntity, view, isAdmin);
  }

  public stopSession(): void {
    this.gameSession.stop();
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
  }

  public toggleCameraUser(isCinematicInitial: boolean = false, customFrames?: number): void {
    this.gameSession.toggleCameraUser(isCinematicInitial, customFrames);
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

  /**
   * Entry point exclusivo para el Reproductor en Producción (Standalone Player).
   * Carga el episodio, lo parsea y arranca la sesión automáticamente.
   */
  public async loadAndPlayEpisode(episodeId: number, view: 'FPS' | 'TPS' = 'FPS'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.epiApiSvc.obtenerEpisodio(episodeId).subscribe({
        next: async (res) => {
          this.motor3d.forzarRedimension();
          this.envSvc.crearSuelo();
          
          if(res) {
            await this.loaderSvc.cargarEscenaDesdeDatos(res);
          }

          this.motor3d.scene.executeWhenReady(() => {
            const spawnEntity = this.entityManager.getEntitiesByRol('spawn_point')[0] || 
                                this.entityManager.getEntitiesByRol('npc')[0];
            if (spawnEntity) {
              this.startSession(spawnEntity, view, false);
              resolve();
            } else {
              reject('No spawn point found in episode');
            }
          });
        },
        error: (err) => reject(err)
      });
    });
  }
}