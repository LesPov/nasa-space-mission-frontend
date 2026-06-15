
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Color4, Scene, Vector3, Observer } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsFogService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private fogObserver: Observer<Scene> | null = null;

  // Variables actuales para interpolación cinematográfica
  private curStart = 500000;
  private curEnd = 500000;
  private curR = 0;
  private curG = 0;
  private curB = 0;
  private curDensity = 0.01;
  private firstFrame = true; // Bandera para evitar el LERP inicial desde lejos

  public aplicarNieblaEnTiempoReal(): void {
    const scene = this.motor3d.scene;
    if (!scene) return;

    if (!this.fogObserver) {
      const globalClearHex = (scene.metadata && scene.metadata.globalClearColor) ? scene.metadata.globalClearColor : '#0d1729';
      const clearColor3 = Color3.FromHexString(globalClearHex);
      this.curR = clearColor3.r;
      this.curG = clearColor3.g;
      this.curB = clearColor3.b;
      
      this.curStart = scene.fogStart || 500000;
      this.curEnd = scene.fogEnd || 500000;
      this.curDensity = scene.fogDensity || 0.01;
      this.firstFrame = true;

      this.fogObserver = scene.onBeforeRenderObservable.add(() => this.updateFogFrame(scene));
    }
  }

  private updateFogFrame(scene: Scene): void {
    const modo = this.state.playState();
    let targetPlayer: AbstractMesh | null = null;
    let shadowLimit = 500000;

    // Tomamos el jugador activo oficial primero, si no, buscamos un spawn
    if (this.state.jugadorActivo) {
       targetPlayer = this.state.jugadorActivo;
    } else {
       const spawnOrNpc = scene.meshes.find(m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc');
       targetPlayer = spawnOrNpc || null;
    }

    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';

    let targetStart = 500000;
    let targetEnd = 500000;
    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;
    let targetMode = 'linear';
    let targetDensity = 0.01;

    if (modo === 'PLAYING' || modo === 'EDITING_IN_GAME' || modo === 'TRANSITIONING') {
      if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled) {
        useFog = true;
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        targetMode = fog.fogMode || 'linear';
        if (targetMode !== 'linear') {
           targetDensity = Number.isFinite(Number(fog.density)) ? Number(fog.density) : 0.01;
        }

        const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
        const targetColorObj = Color3.FromHexString(activeColor);
        targetR = targetColorObj.r;
        targetG = targetColorObj.g;
        targetB = targetColorObj.b;
        
        let rawStart: any = 0;
        let rawEnd: any = 50000;
        let rawRender: any = 100000;
        let rawDensStart: any = 0;
        let rawDensEnd: any = 100;

        if (isBW) {
          rawStart = isFPS ? fog.startFpsBW : fog.startTpsBW;
          rawEnd = isFPS ? fog.endFpsBW : fog.endTpsBW;
          rawRender = isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW;
          rawDensStart = isFPS ? fog.densityStartFpsBW : fog.densityStartTpsBW;
          rawDensEnd = isFPS ? fog.densityEndFpsBW : fog.densityEndTpsBW;
        } else {
          rawStart = isFPS ? fog.startFPS : fog.startTPS;
          rawEnd = isFPS ? fog.endFPS : fog.endTPS;
          rawRender = isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS;
          rawDensStart = isFPS ? fog.densityStartFPS : fog.densityStartTPS;
          rawDensEnd = isFPS ? fog.densityEndFPS : fog.densityEndTPS;
        }

        const activeStart = Number.isFinite(Number(rawStart)) ? Math.max(0, Number(rawStart)) : 0;
        const activeEnd = (Number.isFinite(Number(rawEnd)) && Number(rawEnd) > activeStart) ? Number(rawEnd) : activeStart + 50;
        const activeRenderDistance = (Number.isFinite(Number(rawRender)) && Number(rawRender) > activeEnd) ? Number(rawRender) : activeEnd + 500;
        
        const activeDensityStart = Number.isFinite(Number(rawDensStart)) ? Math.max(0, Math.min(99, Number(rawDensStart))) : 0;
        const activeDensityEnd = Number.isFinite(Number(rawDensEnd)) ? Math.max(1, Math.min(100, Number(rawDensEnd))) : 100;

        let distCamToPlayer = 0;
        if (scene.activeCamera) {
          distCamToPlayer = Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition());
          if (modo === 'TRANSITIONING') distCamToPlayer = Math.min(distCamToPlayer, 8); 
        }

        const gap = activeEnd - activeStart;
        const adjustedFogEnd = activeStart + (gap / (activeDensityEnd / 100));
        const finalAdjustedEnd = activeStart + ((adjustedFogEnd - activeStart) * (1 - (activeDensityStart / 100)));

        targetStart = activeStart + distCamToPlayer; 
        targetEnd = finalAdjustedEnd + distCamToPlayer; 

        const renderMaxZ = Math.max(targetEnd * 1.5, activeRenderDistance + distCamToPlayer);
        
        if (this.firstFrame || modo === 'TRANSITIONING') {
            this.motor3d.playerCameraFPS.maxZ = renderMaxZ;
            this.motor3d.playerCameraTPS.maxZ = renderMaxZ;
            this.motor3d.editorCamera.maxZ = renderMaxZ;
        } else {
            this.motor3d.editorCamera.maxZ += (renderMaxZ - this.motor3d.editorCamera.maxZ) * 0.05;
            this.motor3d.playerCameraFPS.maxZ += (renderMaxZ - this.motor3d.playerCameraFPS.maxZ) * 0.05;
            this.motor3d.playerCameraTPS.maxZ += (renderMaxZ - this.motor3d.playerCameraTPS.maxZ) * 0.05;
        }

        shadowLimit = renderMaxZ;
      }
    }

    if (!useFog) {
      const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
      const targetColorObj = Color3.FromHexString(globalClearHex);
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;
      targetStart = 500000;
      targetEnd = 500000;

      if (this.firstFrame || modo === 'TRANSITIONING') {
          this.motor3d.playerCameraFPS.maxZ = 500000;
          this.motor3d.playerCameraTPS.maxZ = 500000;
          this.motor3d.editorCamera.maxZ = 500000;
      } else {
          this.motor3d.editorCamera.maxZ += (500000 - this.motor3d.editorCamera.maxZ) * 0.05;
          this.motor3d.playerCameraFPS.maxZ += (500000 - this.motor3d.playerCameraFPS.maxZ) * 0.05;
          this.motor3d.playerCameraTPS.maxZ += (500000 - this.motor3d.playerCameraTPS.maxZ) * 0.05;
      }
    }

    const lerpSpeed = (modo === 'TRANSITIONING' || modo === 'PLAYING') ? 0.35 : 0.035; 
    
    if (this.firstFrame) {
      this.curStart = targetStart;
      this.curEnd = targetEnd;
      this.curR = targetR;
      this.curG = targetG;
      this.curB = targetB;
      this.curDensity = targetDensity;
      this.firstFrame = false;
    } else {
      this.curStart += (targetStart - this.curStart) * lerpSpeed;
      this.curEnd += (targetEnd - this.curEnd) * lerpSpeed;
      this.curR += (targetR - this.curR) * lerpSpeed;
      this.curG += (targetG - this.curG) * lerpSpeed;
      this.curB += (targetB - this.curB) * lerpSpeed;
      this.curDensity += (targetDensity - this.curDensity) * lerpSpeed;
    }

    if (useFog) {
      if (targetMode === 'exp2') scene.fogMode = Scene.FOGMODE_EXP2;
      else if (targetMode === 'exp') scene.fogMode = Scene.FOGMODE_EXP;
      else scene.fogMode = Scene.FOGMODE_LINEAR;
      
      scene.fogStart = this.curStart;
      scene.fogEnd = this.curEnd;
      if (targetMode !== 'linear') scene.fogDensity = this.curDensity;
    } else {
      if (this.curStart > 400000) {
          scene.fogMode = Scene.FOGMODE_NONE; 
      } else {
          scene.fogMode = Scene.FOGMODE_LINEAR;
          scene.fogStart = this.curStart;
          scene.fogEnd = this.curEnd;
      }
    }

    scene.clearColor = new Color4(this.curR, this.curG, this.curB, 1);
    scene.fogColor = new Color3(this.curR, this.curG, this.curB);

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ += (shadowLimit - sg.shadowMaxZ) * lerpSpeed;
      }
    });
  }
}