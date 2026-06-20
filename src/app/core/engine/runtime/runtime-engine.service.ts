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
import { GameMode, CameraViewMode } from '../session/game-context.model';
import { GameContextService } from '../session/game-context.service';
import { InputOrchestratorService } from './systems/input-orchestrator.service';
  
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

  private _prodClickFn: (() => void) | null = null;

  // ==========================================
  // MODO PRODUCCIÓN (JUEGO PURO SIN EDITOR)
  // ==========================================
  public async bootProductionGame(episodeData: any, isAdmin: boolean = false): Promise<GameEntity> {
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

        // 🔥 FIX: Establecer contexto primero para que la fábrica de cámaras actúe correctamente
        const mode = isAdmin ? GameMode.PREVIEW_ADMIN : GameMode.FINAL_USER;
        this.gameContext.setMode(mode);

        // 🔥 CINEMÁTICA: Iniciamos en 3ra Persona (TPS) para la intro, no en FPS.
        this.playerCamSvc.inicializarCamaras(spawnEntity, 'TPS');
        const targetCam = this.motor3d.playerCameraTPS;
        targetCam.getViewMatrix(true);
        this.motor3d.scene.activeCamera = targetCam;

        // La sesión arranca en TPS
        this.gameSession.start(spawnEntity, 'TPS');

        // 🔥 Lanzar la animación lenta de alejamiento (Cinemática Intro)
        this.playerCamSvc.iniciarCinematicaIntro(spawnEntity);

        const canvas = this.motor3d.engine.getRenderingCanvas();
        if (canvas) {
          try { this.motor3d.editorCamera?.detachControl(); } catch {}
          try { this.motor3d.playerCameraFPS?.detachControl(); } catch {}

          targetCam.attachControl(canvas, true);

          this._prodClickFn = () => {
             // El clic cierra el modal en UI y detiene la cinemática aquí, pasando al juego.
             if (this.gameContext.isPlaying() && !document.pointerLockElement) {
                this.playerCamSvc.detenerCinematicaIntro();
                this.inputOrchestrator.lockPointer(); // Lock detona GameResumed -> Viaje a FPS
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
    this.gameContext.setMode(GameMode.EDITOR);
    this.playerCamSvc.detenerCinematicaIntro(); // Limpieza segura
    this.playerCamSvc.limpiarPivotTPS();
    this.resetVideos();
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
    this.playerCamSvc.inicializarCamaras(playerEntity, view);
    
    const targetCam = view === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    targetCam.getViewMatrix(true);
    this.motor3d.scene.activeCamera = targetCam;

    this.gameContext.setMode(GameMode.TEST_LIVE);
    this.gameSession.start(playerEntity, view);
  }

  public stopTestSession(): void {
    this.gameSession.stop();
    this.gameContext.setMode(GameMode.EDITOR);
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