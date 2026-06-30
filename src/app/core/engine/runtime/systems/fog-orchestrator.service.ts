
import { Injectable, inject } from '@angular/core';
import { Scene, Color3, AbstractMesh } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { FogRendererService } from './fog-renderer.service';
import { FogLevel } from '../../models/player-config.model';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { GameContextService } from '../../session/game-context.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameMode } from '../../session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class FogOrchestratorService implements IUpdatable {
  public id = 'FogOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private worldSettingsSvc = inject(WorldSettingsService);
  private fogRenderer = inject(FogRendererService);
  private ownership = inject(CameraOwnershipService);
  private context = inject(GameContextService);
  private entityManager = inject(EntityManagerService);

  private firstFrame = true;

  private curR = 0; private curG = 0; private curB = 0;
  private curStart = 500000; private curEnd = 500000;

  // 🔥 OPTIMIZACIÓN: Prevención masiva del Garbage Collector.
  private targetColorObj = new Color3(0, 0, 0);

  private hexToColor3(hex: string, result: Color3): void {
    const cleanHex = hex.replace('#', '');
    if (cleanHex.length !== 6 && cleanHex.length !== 3) return;
    if (cleanHex.length === 6) {
      result.r = parseInt(cleanHex.substring(0, 2), 16) / 255.0;
      result.g = parseInt(cleanHex.substring(2, 4), 16) / 255.0;
      result.b = parseInt(cleanHex.substring(4, 6), 16) / 255.0;
    }
  }

  public start(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    
    this.curStart = scene.fogStart || 500000;
    this.curEnd = scene.fogEnd || 500000;
    this.firstFrame = true;
  }

  public stop(): void {
    this.firstFrame = true;
    this.fogRenderer.dispose();
  }

  public postUpdate(dtMs: number): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    const isTransitioning = this.context.isTransitioning();
    const mode = this.context.mode();
    const isPlaying = this.context.isPlaying();
    const isFogDisabledTemp = this.context.isFogDisabled();

    const wSettings = this.worldSettingsSvc.settings();
    const isBW = wSettings.visualMode === 'bw';
    const globalClearHex = isBW ? wSettings.clearColorBW : wSettings.clearColor;

    this.hexToColor3(globalClearHex, this.targetColorObj);

    if (isTransitioning) {
        this.fogRenderer.renderFogWalls(scene, null, false, [], this.targetColorObj, globalClearHex, false, false, 0, 500000, true);
        return;
    }

    let targetEntity = this.context.activePlayerEntity();

    // Si estamos en Editor, buscamos a quién pegarle la niebla de previsualización
    if (!isPlaying && !targetEntity) {
        const entities = this.entityManager.getAllEntities();
        for (let i = 0; i < entities.length; i++) {
            if (entities[i].rol === 'spawn_point' || entities[i].rol === 'npc') {
                targetEntity = entities[i];
                break;
            }
        }
    }

    const targetPlayer = targetEntity?.view as AbstractMesh || null;
    let shadowLimit = 500000;

    const isFPS = this.context.cameraView() === 'FPS';
    const lerpSpeed = isPlaying ? 0.35 : 0.035;

    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;
    let activeLevels: FogLevel[] = [];

    // Lógica condicional de activación según el estado del Editor/Juego
    if (targetEntity?.playerConfig?.fog?.enabled) {
        if (isPlaying || (mode === GameMode.EDITING_IN_GAME && !isFogDisabledTemp)) {
            useFog = true;
        }
    }

    if (useFog && targetEntity?.playerConfig?.fog) {
        const fog = targetEntity.playerConfig.fog;
        const activeColorHex = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');

        this.hexToColor3(activeColorHex, this.targetColorObj);
        targetR = this.targetColorObj.r;
        targetG = this.targetColorObj.g;
        targetB = this.targetColorObj.b;

        const renderDistance = isBW ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW) : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);
        activeLevels = isBW ? (isFPS ? fog.levelsFpsBW : fog.levelsTpsBW) : (isFPS ? fog.levelsFPS : fog.levelsTPS);

        const activeCam = this.ownership.getCamera();
        let distCamToPlayer = 0;
        
        if (activeCam && targetPlayer) {
            const dx = activeCam.globalPosition.x - targetPlayer.getAbsolutePosition().x;
            const dy = activeCam.globalPosition.y - targetPlayer.getAbsolutePosition().y;
            const dz = activeCam.globalPosition.z - targetPlayer.getAbsolutePosition().z;
            distCamToPlayer = Math.sqrt(dx*dx + dy*dy + dz*dz);
        }

        if (isPlaying) {
            distCamToPlayer = Math.min(distCamToPlayer, 8);
        }

        const renderMaxZ = (Number(renderDistance) || 150) + distCamToPlayer;

        if (this.firstFrame) {
            if (isPlaying) {
                this.motor3d.getPlayerCameraFPS().maxZ = renderMaxZ;
                this.motor3d.getPlayerCameraTPS().maxZ = renderMaxZ;
                this.motor3d.getEditorCamera().maxZ = renderMaxZ;
            } else {
                this.motor3d.getEditorCamera().maxZ = 500000;
            }
        } else {
            if (isPlaying) {
                this.motor3d.getEditorCamera().maxZ += (renderMaxZ - this.motor3d.getEditorCamera().maxZ) * 0.05;
                this.motor3d.getPlayerCameraFPS().maxZ += (renderMaxZ - this.motor3d.getPlayerCameraFPS().maxZ) * 0.05;
                this.motor3d.getPlayerCameraTPS().maxZ += (renderMaxZ - this.motor3d.getPlayerCameraTPS().maxZ) * 0.05;
            } else {
                this.motor3d.getEditorCamera().maxZ = 500000; // En editor, no queremos que la cámara principal se recorte
            }
        }

        shadowLimit = renderMaxZ;
        this.curStart = isPlaying ? (renderMaxZ * 0.3) : (renderMaxZ * 0.8);
        this.curEnd = renderMaxZ;
    } else {
        targetR = this.targetColorObj.r;
        targetG = this.targetColorObj.g;
        targetB = this.targetColorObj.b;

        if (this.firstFrame) {
            this.motor3d.getPlayerCameraFPS().maxZ = 500000;
            this.motor3d.getPlayerCameraTPS().maxZ = 500000;
            this.motor3d.getEditorCamera().maxZ = 500000;
        } else {
            this.motor3d.getEditorCamera().maxZ += (500000 - this.motor3d.getEditorCamera().maxZ) * 0.05;
            this.motor3d.getPlayerCameraFPS().maxZ += (500000 - this.motor3d.getPlayerCameraFPS().maxZ) * 0.05;
            this.motor3d.getPlayerCameraTPS().maxZ += (500000 - this.motor3d.getPlayerCameraTPS().maxZ) * 0.05;
        }
        this.curStart = 500000;
        this.curEnd = 500000;
    }

    if (this.firstFrame) {
        this.curR = targetR; this.curG = targetG; this.curB = targetB;
    } else {
        this.curR += (targetR - this.curR) * lerpSpeed;
        this.curG += (targetG - this.curG) * lerpSpeed;
        this.curB += (targetB - this.curB) * lerpSpeed;
    }

    scene.fogColor = new Color3(this.curR, this.curG, this.curB);
    scene.fogMode = useFog ? Scene.FOGMODE_LINEAR : Scene.FOGMODE_NONE;
    if (useFog) {
        scene.fogStart = this.curStart;
        scene.fogEnd = this.curEnd;
    }

    this.fogRenderer.renderFogWalls(
        scene, targetPlayer, useFog, activeLevels, 
        this.targetColorObj, globalClearHex, isFogDisabledTemp, 
        this.firstFrame, lerpSpeed, shadowLimit, false
    );

    this.firstFrame = false;
  }
}