
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DynamicTexture, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Tags } from '@babylonjs/core';
import { FogLevel } from '../../models/player-config.model';
import { AdaptiveQualitySystem } from './adaptive-quality.system';
 
class FogWallState { 
  dist = 500; height = 10; alpha = 0; thickness = 10; offsetY = 0; r = 0; g = 0; b = 0;
}

@Injectable({ providedIn: 'root' })
export class FogRendererService {
  private adaptiveQuality = inject(AdaptiveQualitySystem);

  private fogWalls: TransformNode[] = []; 
  private fogMats: StandardMaterial[][] = []; 
  private wallStates: FogWallState[] = []; 
  private gradTex: DynamicTexture | null = null;
  private currentScene: Scene | null = null;

  private tColorCache = new Color3(0, 0, 0);

  constructor() { 
    for(let i = 0; i < 3; i++) {
      this.wallStates.push(new FogWallState()); 
    }
  }

  private hexToColor3(hex: string, result: Color3): void {
    const cleanHex = hex.replace('#', '');
    if (cleanHex.length !== 6 && cleanHex.length !== 3) return;
    if (cleanHex.length === 6) {
      result.r = parseInt(cleanHex.substring(0, 2), 16) / 255.0;
      result.g = parseInt(cleanHex.substring(2, 4), 16) / 255.0;
      result.b = parseInt(cleanHex.substring(4, 6), 16) / 255.0;
    }
  }

  private getGradientTexture(scene: Scene): DynamicTexture { 
    if (this.gradTex && this.currentScene === scene) return this.gradTex;
    if (this.gradTex) { try { this.gradTex.dispose(); } catch(e){} }
    this.currentScene = scene;

    const tex = new DynamicTexture("sharedFogGradTex", { width: 2, height: 256 }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();

    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, "rgba(255,255,255,0.0)"); 
    grad.addColorStop(0.30, "rgba(255,255,255,0.1)"); 
    grad.addColorStop(0.60, "rgba(255,255,255,0.6)"); 
    grad.addColorStop(0.85, "rgba(255,255,255,1.0)"); 
    grad.addColorStop(0.96, "rgba(255,255,255,1.0)"); 
    grad.addColorStop(1.00, "rgba(255,255,255,0.0)"); 

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    tex.update();

    this.gradTex = tex;
    return tex;
  }

  public dispose(): void {
    this.fogWalls.forEach(w => { if (w && !w.isDisposed()) w.dispose(); });
    this.fogWalls = [];
    this.fogMats = [];
    if (this.gradTex) { try { this.gradTex.dispose(); } catch(e){} }
    this.gradTex = null;
    this.currentScene = null;
  }

  public renderFogWalls(
    scene: Scene,
    targetPlayer: AbstractMesh | null,
    useFog: boolean,
    activeLevels: FogLevel[],
    targetColor: Color3,
    globalClearHex: string,
    isFogDisabledTemp: boolean,
    firstFrame: boolean,
    lerpSpeed: number,
    shadowLimit: number,
    hideCompletely: boolean = false
  ): void {
    if (hideCompletely) {
      this.fogWalls.forEach(w => w?.getChildMeshes().forEach(m => m.isVisible = false));
      return;
    }

    if (this.fogWalls[0] && (this.fogWalls[0].getScene() !== scene || this.fogWalls[0].isDisposed() || this.fogWalls[0].getChildMeshes().length === 0)) {
        this.fogWalls.forEach(w => { if(!w.isDisposed()) w.dispose(); });
        this.fogWalls = [];
        this.fogMats = [];
    }

    // 🔥 FASE 4: Determinar el número de capas a dibujar según el Quality Tier
    const tier = this.adaptiveQuality.currentQualityTier;
    const maxDrawLayers = tier === 'HIGH' ? 12 : (tier === 'MEDIUM' ? 6 : 3);

    const anchorX = targetPlayer ? targetPlayer.position.x : 0;
    const anchorY = targetPlayer ? targetPlayer.position.y : 0;
    const anchorZ = targetPlayer ? targetPlayer.position.z : 0;

    for (let i = 0; i < 3; i++) {
      if (!this.fogWalls[i]) {
        this.fogWalls[i] = new TransformNode("sharedFogWallGroup_" + i, scene);
        this.fogMats[i] = []; 
        
        const capasDeGrosor = 12; 
        for (let j = capasDeGrosor - 1; j >= 0; j--) {
            const mat = new StandardMaterial(`sharedFogMat_${i}_${j}`, scene);
            mat.disableLighting = true; 
            mat.alphaMode = Engine.ALPHA_COMBINE;
            mat.disableDepthWrite = true; 
            mat.opacityTexture = this.getGradientTexture(scene); 
            mat.fogEnabled = false; 
            this.fogMats[i][j] = mat; 

            const shell = MeshBuilder.CreateCylinder(`sharedFogShell_${i}_${j}`, { 
                // En calidades bajas podríamos bajar la teselación también, pero la recarga costaría.
                diameter: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE, cap: Mesh.NO_CAP, tessellation: 24 
            }, scene);
            
            shell.parent = this.fogWalls[i];
            shell.scaling.set(1, 1, 1); 
            shell.material = mat;
            shell.isPickable = false;
            shell.checkCollisions = false;
            shell.receiveShadows = false;
            shell.applyFog = false;
            shell.doNotSyncBoundingInfo = true; 
            Tags.AddTagsTo(shell, "system_element fog_element ignore_raycast");
        }
      }

      const wallGroup = this.fogWalls[i];
      const state = this.wallStates[i];

      let tDist = 50000;
      let tHeight = 10;
      let tAlpha = 0;
      let tThick = 10;
      let tOffsetY = 0; 
      
      this.tColorCache.copyFrom(targetColor);

      if (useFog && activeLevels && activeLevels[i]) {
          tDist = Math.max(0.1, activeLevels[i].distance);
          tHeight = Math.max(0.1, activeLevels[i].height);
          tAlpha = Math.max(0, Math.min(100, activeLevels[i].opacity)) / 100;
          tThick = Math.max(0.1, activeLevels[i].thickness ?? 10);
          tOffsetY = activeLevels[i].offsetY ?? 0;
          if (activeLevels[i].color) {
             this.hexToColor3(activeLevels[i].color!, this.tColorCache);
          }
      }

      if (firstFrame) {
         state.dist = tDist; state.height = tHeight; state.alpha = tAlpha; state.thickness = tThick; state.offsetY = tOffsetY;
         state.r = this.tColorCache.r; state.g = this.tColorCache.g; state.b = this.tColorCache.b;
      } else {
         state.dist += (tDist - state.dist) * lerpSpeed;
         state.height += (tHeight - state.height) * lerpSpeed;
         state.alpha += (tAlpha - state.alpha) * lerpSpeed;
         state.thickness += (tThick - state.thickness) * lerpSpeed;
         state.offsetY += (tOffsetY - state.offsetY) * lerpSpeed;
         state.r += (this.tColorCache.r - state.r) * lerpSpeed;
         state.g += (this.tColorCache.g - state.g) * lerpSpeed;
         state.b += (this.tColorCache.b - state.b) * lerpSpeed;
      }

      wallGroup.scaling.set(state.dist * 2, state.height, state.dist * 2);
      wallGroup.position.set(anchorX, anchorY + (state.height / 2) + state.offsetY, anchorZ);
      
      const isVisible = state.alpha > 0.001 && !isFogDisabledTemp;
      const curDist = Math.max(0.1, state.dist);
      const halfThick = state.thickness / 2;
      const meshes = wallGroup.getChildMeshes();

      // Ajustamos el step según cuántas capas permitimos dibujar
      const step = 12 / maxDrawLayers;

      let currentLayers = [5, 10, 20, 40, 60, 100, 100, 60, 40, 20, 10, 5]; 
      let currentHeights = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]; 
      
      if (activeLevels && activeLevels[i]) {
          if (activeLevels[i].layerOpacities && activeLevels[i].layerOpacities!.length === 12) currentLayers = activeLevels[i].layerOpacities!;
          if (activeLevels[i].layerHeights && activeLevels[i].layerHeights!.length === 12) currentHeights = activeLevels[i].layerHeights!;
      }

      for (let j = 0; j < 12; j++) {
          const shell = meshes.find(m => m.name === `sharedFogShell_${i}_${j}`);
          if (!shell) continue;

          // 🔥 Si la capa no coincide con el step del tier, la apagamos (Overdraw Reduction)
          if (j % step !== 0) {
              shell.isVisible = false;
              continue;
          }

          // Distribuimos el grosor uniformemente pero usando el índice original
          const offsetNormalized = -1 + (j * (2 / 11));
          const targetRadius = curDist + (offsetNormalized * halfThick);
          const localScaleX = targetRadius / curDist;
          
          const heightRatio = (currentHeights[j] ?? 100) / 100.0;
          shell.scaling.set(localScaleX, heightRatio, localScaleX);
          shell.position.y = -0.5 * (1 - heightRatio);

          const mat = this.fogMats[i][j];
          mat.emissiveColor.set(state.r, state.g, state.b);
          
          // Compensamos la opacidad si estamos saltando capas para mantener el volumen visual
          const opacityCompensator = step; 
          const opacityRatio = ((currentLayers[j] ?? 0) / 100.0) * opacityCompensator;
          
          mat.alpha = state.alpha * Math.min(1.0, opacityRatio); 

          shell.isVisible = isVisible && mat.alpha > 0.005;
      }
    }
  }
}