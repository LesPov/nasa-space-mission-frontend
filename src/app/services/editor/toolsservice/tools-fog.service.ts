
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
  private curStart = 10000;
  private curEnd = 10000;
  private curR = 0;
  private curG = 0;
  private curB = 0;

  public aplicarNieblaEnTiempoReal(): void {
    const scene = this.motor3d.scene;
    if (!scene) return;

    if (!this.fogObserver) {
      const globalClearHex = (scene.metadata && scene.metadata.globalClearColor) ? scene.metadata.globalClearColor : '#0d1729';
      const clearColor3 = Color3.FromHexString(globalClearHex);
      this.curR = clearColor3.r;
      this.curG = clearColor3.g;
      this.curB = clearColor3.b;
      
      this.curStart = scene.fogStart || 10000;
      this.curEnd = scene.fogEnd || 10000;

      this.fogObserver = scene.onBeforeRenderObservable.add(() => this.updateFogFrame(scene));
    }
  }

  private updateFogFrame(scene: Scene): void {
    const modo = this.state.playState();
    let targetPlayer: AbstractMesh | null = null;
    let shadowLimit = 10000;

    const spawnOrNpc = scene.meshes.find(m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc');
    targetPlayer = spawnOrNpc || null;

    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';

    let targetStart = 10000;
    let targetEnd = 10000;
    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;

    if (modo === 'PLAYING' || modo === 'EDITING_IN_GAME' || modo === 'TRANSITIONING') {
      if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled) {
        useFog = true;
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
        const targetColorObj = Color3.FromHexString(activeColor);
        targetR = targetColorObj.r;
        targetG = targetColorObj.g;
        targetB = targetColorObj.b;
        
        let activeStart = 0;
        let activeEnd = 50;
        let activeRenderDistance = 150;
        let activeDensityStart = 0;
        let activeDensityEnd = 100;

        if (isBW) {
          activeStart = isFPS ? (fog.startFpsBW ?? 0) : (fog.startTpsBW ?? 5);
          activeEnd = isFPS ? (fog.endFpsBW ?? 60) : (fog.endTpsBW ?? 90);
          activeRenderDistance = isFPS ? (fog.renderDistanceFpsBW ?? 100) : (fog.renderDistanceTpsBW ?? 150);
          activeDensityStart = isFPS ? (fog.densityStartFpsBW ?? 0) : (fog.densityStartTpsBW ?? 0);
          activeDensityEnd = isFPS ? (fog.densityEndFpsBW ?? 100) : (fog.densityEndTpsBW ?? 100);
        } else {
          activeStart = isFPS ? (fog.startFPS ?? 0) : (fog.startTPS ?? 5);
          activeEnd = isFPS ? (fog.endFPS ?? 80) : (fog.endTPS ?? 120);
          activeRenderDistance = isFPS ? (fog.renderDistanceFPS ?? 150) : (fog.renderDistanceTPS ?? 200);
          activeDensityStart = isFPS ? (fog.densityStartFPS ?? 0) : (fog.densityStartTPS ?? 0);
          activeDensityEnd = isFPS ? (fog.densityEndFPS ?? 100) : (fog.densityEndTPS ?? 100);
        }

        let distCamToPlayer = 0;
        if (targetPlayer && scene.activeCamera) {
          distCamToPlayer = Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition());
          
          // 🔥 FIX CINEMÁTICO: Durante la transición limitamos la distancia para que
          // la niebla se forme antes y el personaje emerja de entre la bruma en el vuelo inicial.
          if (modo === 'TRANSITIONING') {
              distCamToPlayer = Math.min(distCamToPlayer, 8); 
          }
        }

        const clampedStart = Math.max(0, Math.min(99.5, activeDensityStart));
        const clampedEnd = Math.max(1, Math.min(100, activeDensityEnd)); 

        const gap = activeEnd - activeStart;
        const adjustedFogEnd = activeStart + (gap / (clampedEnd / 100));
        const finalAdjustedEnd = activeStart + ((adjustedFogEnd - activeStart) * (1 - (clampedStart / 100)));

        targetStart = activeStart + distCamToPlayer; 
        targetEnd = finalAdjustedEnd + distCamToPlayer; 

        const renderMaxZ = activeRenderDistance + distCamToPlayer;
        
        this.motor3d.editorCamera.maxZ += (renderMaxZ - this.motor3d.editorCamera.maxZ) * 0.05;
        this.motor3d.playerCameraFPS.maxZ += (renderMaxZ - this.motor3d.playerCameraFPS.maxZ) * 0.05;
        this.motor3d.playerCameraTPS.maxZ += (renderMaxZ - this.motor3d.playerCameraTPS.maxZ) * 0.05;

        shadowLimit = renderMaxZ;
      }
    }

    if (!useFog) {
      const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
      const targetColorObj = Color3.FromHexString(globalClearHex);
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;
      targetStart = 10000;
      targetEnd = 10000;

      this.motor3d.editorCamera.maxZ += (10000 - this.motor3d.editorCamera.maxZ) * 0.05;
      this.motor3d.playerCameraFPS.maxZ += (10000 - this.motor3d.playerCameraFPS.maxZ) * 0.05;
      this.motor3d.playerCameraTPS.maxZ += (10000 - this.motor3d.playerCameraTPS.maxZ) * 0.05;
    }

    // 🔥 ACELERAMOS EL LERP DURANTE LA TRANSICIÓN PARA QUE SE SINCRONICE CON LA ESPIRAL
    const lerpSpeed = modo === 'TRANSITIONING' ? 0.15 : 0.035; 
    
    this.curStart += (targetStart - this.curStart) * lerpSpeed;
    this.curEnd += (targetEnd - this.curEnd) * lerpSpeed;
    this.curR += (targetR - this.curR) * lerpSpeed;
    this.curG += (targetG - this.curG) * lerpSpeed;
    this.curB += (targetB - this.curB) * lerpSpeed;

    if (useFog) {
      scene.fogMode = Scene.FOGMODE_LINEAR;
      scene.fogStart = this.curStart;
      scene.fogEnd = this.curEnd;
    } else {
      if (this.curStart > 9000) scene.fogMode = Scene.FOGMODE_NONE;
      else {
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