import { Injectable, inject } from '@angular/core';
import { Scene, Vector3, Color3, AbstractMesh } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { FogLevel } from '../../../core/engine/models/player-config.model';
import { LoopManagerService, GamePhase } from '../../../core/engine/behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { FogRendererService } from '../../../core/engine/runtime/systems/fog-renderer.service';

@Injectable({ providedIn: 'root' }) 
export class ToolsFogService { 
  private motor3d = inject(Motor3dService); 
  private state = inject(EditorStateService);
  private loopManager = inject(LoopManagerService);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private fogRenderer = inject(FogRendererService);

  private isRegistered = false; 
  private firstFrame = true;

  private curR = 0; private curG = 0; private curB = 0; 
  private curStart = 500000; private curEnd = 500000;

  public limpiarEstado(): void {
    if (this.isRegistered) {
      this.loopManager.unregister('ToolsFogUpdate');
      this.isRegistered = false;
      this.firstFrame = true;
    }
    this.fogRenderer.dispose();
  }

  public aplicarNieblaEnTiempoReal(): void { 
    const scene = this.motor3d.scene; 
    if (!scene) return;

    if (!this.isRegistered) {
      const w = this.worldSettingsSvc.settings();
      const globalClearHex = w.visualMode === 'bw' ? w.clearColorBW : w.clearColor;
      const clearColor3 = Color3.FromHexString(globalClearHex);
      this.curR = clearColor3.r; this.curG = clearColor3.g; this.curB = clearColor3.b;
      
      this.curStart = scene.fogStart || 500000;
      this.curEnd = scene.fogEnd || 500000;
      this.firstFrame = true;

      this.loopManager.register('ToolsFogUpdate', GamePhase.POST_UPDATE, () => this.updateFogFrame(scene));
      this.isRegistered = true;
    }
  }

  private updateFogFrame(scene: Scene): void { 
    const modo = this.state.playState();
    const isFogDisabledTemp = this.state.fogDesactivadoTemporalmente(); 
    
    if (modo === 'PLAYING' || modo === 'TRANSITIONING') {
       this.fogRenderer.renderFogWalls(scene, null, false, [], Color3.Black(), '#000000', false, false, 0, 500000, true);
       return;
    }
    
    let targetPlayer: AbstractMesh | null = null; 
    let shadowLimit = 500000;

    if (this.state.jugadorActivo) {
       targetPlayer = this.state.jugadorActivo;
    } else {
       targetPlayer = scene.meshes.find(m => {
           const entity = this.entityManager.getEntityByMesh(m);
           return entity?.rol === 'spawn_point' || entity?.rol === 'npc';
       }) || null;
    }

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const globalClearHex = isBW ? this.worldSettingsSvc.settings().clearColorBW : this.worldSettingsSvc.settings().clearColor;
    
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    const lerpSpeed = 0.035; 

    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;
    let activeLevels: FogLevel[] = [];
    
    const targetEntity = this.entityManager.getEntityByMesh(targetPlayer);
    let targetColorObj = Color3.FromHexString(globalClearHex);

    if (modo === 'EDITING_IN_GAME' && targetEntity?.playerConfig?.fog?.enabled && !isFogDisabledTemp) {
      useFog = true;
      const fog = targetEntity.playerConfig.fog;
      
      const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
      targetColorObj = Color3.FromHexString(activeColor);
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;

      const renderDistance = isBW ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW) : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);
      activeLevels = isBW ? (isFPS ? fog.levelsFpsBW : fog.levelsTpsBW) : (isFPS ? fog.levelsFPS : fog.levelsTPS);

      let distCamToPlayer = scene.activeCamera && targetPlayer ? Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition()) : 0;
      const renderMaxZ = (Number(renderDistance) || 100000) + distCamToPlayer;

      this.motor3d.editorCamera.maxZ = 500000;
      shadowLimit = renderMaxZ;
      this.curStart = renderMaxZ * 0.8;
      this.curEnd = renderMaxZ;
    } else {
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;
      this.motor3d.editorCamera.maxZ = 500000;
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

    this.fogRenderer.renderFogWalls(scene, targetPlayer, useFog, activeLevels, targetColorObj, globalClearHex, isFogDisabledTemp, this.firstFrame, lerpSpeed, shadowLimit, false);

    this.firstFrame = false;
  } 
}