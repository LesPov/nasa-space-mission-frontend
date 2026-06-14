import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Color4, Scene, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsFogService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  public aplicarNieblaEnTiempoReal(): void {
    const scene = this.motor3d.scene;
    if (!scene) return;

    const modo = this.state.playState();
    let targetPlayer: AbstractMesh | null = null;
    let shadowLimit = 10000;

    const spawnOrNpc = scene.meshes.find(m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc');
    targetPlayer = spawnOrNpc || null;

    const globalClearHex = (scene.metadata && scene.metadata.globalClearColor) ? scene.metadata.globalClearColor : '#0d1729';
    const clearColor3 = Color3.FromHexString(globalClearHex);
    scene.clearColor = new Color4(clearColor3.r, clearColor3.g, clearColor3.b, 1);

    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';

    // 🔥 FIX: Añadimos 'TRANSITIONING' para que la niebla se active MIENTRAS la cámara vuela hacia el personaje
    if (modo === 'PLAYING' || modo === 'EDITING_IN_GAME' || modo === 'TRANSITIONING') {
      if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled) {
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
        
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
        }

        const clampedStart = Math.max(0, Math.min(99.5, activeDensityStart));
        const clampedEnd = Math.max(1, Math.min(100, activeDensityEnd)); 

        const gap = activeEnd - activeStart;
        const targetFogEnd = activeStart + (gap / (clampedEnd / 100));
        const finalAdjustedEnd = activeStart + ((targetFogEnd - activeStart) * (1 - (clampedStart / 100)));

        scene.fogMode = Scene.FOGMODE_LINEAR;
        scene.fogStart = activeStart + distCamToPlayer; 
        scene.fogEnd = finalAdjustedEnd + distCamToPlayer; 
        
        scene.clearColor = Color4.FromHexString(activeColor + 'ff');
        scene.fogColor = Color3.FromHexString(activeColor);

        const renderMaxZ = activeRenderDistance + distCamToPlayer;
        this.motor3d.editorCamera.maxZ = renderMaxZ;
        this.motor3d.playerCameraFPS.maxZ = renderMaxZ;
        this.motor3d.playerCameraTPS.maxZ = renderMaxZ;

        shadowLimit = renderMaxZ;
      } else {
        this.restaurarEntornoLibreDeNiebla(scene);
      }
    } else {
      this.restaurarEntornoLibreDeNiebla(scene);
    }

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ = modo === 'PLAYING' || modo === 'TRANSITIONING' ? shadowLimit : 10000;
      }
    });
  }

  private restaurarEntornoLibreDeNiebla(scene: Scene): void {
    scene.fogMode = Scene.FOGMODE_NONE;
    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
    scene.clearColor = Color4.FromHexString(globalClearHex + 'ff');

    this.motor3d.editorCamera.maxZ = 10000;
    this.motor3d.playerCameraFPS.maxZ = 10000;
    this.motor3d.playerCameraTPS.maxZ = 10000;
  }
}