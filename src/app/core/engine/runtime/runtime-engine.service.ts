// src/app/core/engine/runtime/runtime-engine.service.ts

import { Injectable, inject } from '@angular/core';
import { StandardMaterial, VideoTexture, Color3, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../../services/motor-3d.service';
import { GameSession } from './game-session';
import { PlayerCameraManagerService } from './systems/player-camera.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity } from '../entities/game.entity';
import { PlayerInteractionService } from './systems/player-interaction.service';
import { CoreSceneLoaderService } from '../scene/utils/core-scene-loader.service';

@Injectable({ providedIn: 'root' })
export class RuntimeEngineService {
  private motor3d = inject(Motor3dService);
  private gameSession = inject(GameSession);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private entityManager = inject(EntityManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private loaderSvc = inject(CoreSceneLoaderService);

  // ==========================================
  // MODO PRODUCCIÓN (JUEGO PURO SIN EDITOR)
  // ==========================================
  public async bootProductionGame(episodeData: any, isDebugMode: boolean = false): Promise<GameEntity> {
    this.motor3d.forzarRedimension();
    this.loaderSvc.createInvisibleFloor(this.motor3d.scene);
    
    await this.loaderSvc.loadSceneFromData(episodeData);

    return new Promise((resolve, reject) => {
      this.motor3d.scene.executeWhenReady(() => {
        const spawnEntity = this.entityManager.getEntitiesByRol('spawn_point')[0] || 
                            this.entityManager.getEntitiesByRol('npc')[0];
        
        if (!spawnEntity) {
          reject(new Error('No hay punto de aparición (Spawn Point) en el mapa.'));
          return;
        }

        this.resetVideos();
        this.playerCamSvc.inicializarCamaras(spawnEntity, 'FPS');
        const targetCam = this.motor3d.playerCameraFPS;
        targetCam.getViewMatrix(true);
        this.motor3d.scene.activeCamera = targetCam;

        // 🔥 Se pasa el flag de Debug para heredar poderes de Administrador si corresponde
        this.gameSession.start(spawnEntity, 'FPS', isDebugMode);
        resolve(spawnEntity);
      });
    });
  }

  public shutdownProductionGame(): void {
    this.gameSession.stop();
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
    this.entityManager.clear();
  }

  // ==========================================
  // MODO TEST (PUENTE CON EL EDITOR)
  // ==========================================
  public startTestSession(playerEntity: GameEntity, view: 'FPS' | 'TPS', isDebugMode: boolean): void {
    this.resetVideos();
    this.playerCamSvc.inicializarCamaras(playerEntity, view);
    
    const targetCam = view === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    targetCam.getViewMatrix(true);
    this.motor3d.scene.activeCamera = targetCam;

    this.gameSession.start(playerEntity, view, isDebugMode);
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