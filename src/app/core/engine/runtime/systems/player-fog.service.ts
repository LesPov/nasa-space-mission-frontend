import { Injectable, inject } from '@angular/core';
import { Scene, Vector3, Color3, AbstractMesh } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { FogRendererService } from './fog-renderer.service';
import { FogLevel } from '../../models/player-config.model';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { GameContextService } from '../../session/game-context.service';

@Injectable({ providedIn: 'root' }) 
export class PlayerFogService implements IUpdatable { 
  public id = 'PlayerFogSystem';
  private motor3d = inject(Motor3dService); 
  private worldSettingsSvc = inject(WorldSettingsService);
  private fogRenderer = inject(FogRendererService);
  private ownership = inject(CameraOwnershipService);
  private context = inject(GameContextService);

  private firstFrame = true;

  private curR = 0; private curG = 0; private curB = 0; 
  private curStart = 500000; private curEnd = 500000;

  public start(): void {
    const scene = this.motor3d.scene; 
    if (!scene) return;

    const w = this.worldSettingsSvc.settings();
    const globalClearHex = w.visualMode === 'bw' ? w.clearColorBW : w.clearColor;
    const clearColor3 = Color3.FromHexString(globalClearHex);
    this.curR = clearColor3.r; this.curG = clearColor3.g; this.curB = clearColor3.b;
    
    this.curStart = scene.fogStart || 500000;
    this.curEnd = scene.fogEnd || 500000;
    this.firstFrame = true;
  }

  public stop(): void {
    this.firstFrame = true;
    this.fogRenderer.dispose();
  }

  public postUpdate(dtMs: number): void { 
    const scene = this.motor3d.scene;
    if (!scene) return;

    const playerEntity = this.context.activePlayerEntity();
    const currentView = this.context.cameraView();
    const targetPlayer = playerEntity?.view as AbstractMesh || null; 
    
    let shadowLimit = 500000;

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const globalClearHex = isBW ? this.worldSettingsSvc.settings().clearColorBW : this.worldSettingsSvc.settings().clearColor;

    const isFPS = currentView === 'FPS';
    const lerpSpeed = 0.35; 

    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;
    let activeLevels: FogLevel[] = [];
    let targetColorObj = Color3.FromHexString(globalClearHex);
    
    if (playerEntity?.playerConfig?.fog?.enabled) {
      useFog = true;
      const fog = playerEntity.playerConfig.fog;
      const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
      targetColorObj = Color3.FromHexString(activeColor);
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;

      const renderDistance = isBW ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW) : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);
      activeLevels = isBW ? (isFPS ? fog.levelsFpsBW : fog.levelsTpsBW) : (isFPS ? fog.levelsFPS : fog.levelsTPS);

      const activeCam = this.ownership.getCamera();
      let distCamToPlayer = activeCam && targetPlayer ? Vector3.Distance(activeCam.globalPosition, targetPlayer.getAbsolutePosition()) : 0;
      distCamToPlayer = Math.min(distCamToPlayer, 8); 
      
      const renderMaxZ = (Number(renderDistance) || 100000) + distCamToPlayer;

      if (this.firstFrame) {
          this.motor3d.playerCameraFPS.maxZ = renderMaxZ;
          this.motor3d.playerCameraTPS.maxZ = renderMaxZ;
          this.motor3d.editorCamera.maxZ = renderMaxZ;
      } else {
          this.motor3d.editorCamera.maxZ += (renderMaxZ - this.motor3d.editorCamera.maxZ) * 0.05;
          this.motor3d.playerCameraFPS.maxZ += (renderMaxZ - this.motor3d.playerCameraFPS.maxZ) * 0.05;
          this.motor3d.playerCameraTPS.maxZ += (renderMaxZ - this.motor3d.playerCameraTPS.maxZ) * 0.05;
      }
      
      shadowLimit = renderMaxZ;
      this.curStart = renderMaxZ * 0.8;
      this.curEnd = renderMaxZ;
    } else {
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;
      if (this.firstFrame) {
          this.motor3d.playerCameraFPS.maxZ = 500000;
          this.motor3d.playerCameraTPS.maxZ = 500000;
          this.motor3d.editorCamera.maxZ = 500000;
      } else {
          this.motor3d.editorCamera.maxZ += (500000 - this.motor3d.editorCamera.maxZ) * 0.05;
          this.motor3d.playerCameraFPS.maxZ += (500000 - this.motor3d.playerCameraFPS.maxZ) * 0.05;
          this.motor3d.playerCameraTPS.maxZ += (500000 - this.motor3d.playerCameraTPS.maxZ) * 0.05;
      }
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
    if (useFog) { scene.fogStart = this.curStart; scene.fogEnd = this.curEnd; }

    this.fogRenderer.renderFogWalls(scene, targetPlayer, useFog, activeLevels, targetColorObj, globalClearHex, false, this.firstFrame, lerpSpeed, shadowLimit, false);
    
    this.firstFrame = false;
  } 
}