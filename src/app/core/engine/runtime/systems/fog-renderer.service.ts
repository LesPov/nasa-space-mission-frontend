import { Injectable } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, DynamicTexture, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Tags } from '@babylonjs/core';
import { FogLevel } from '../../models/player-config.model';

class FogWallState { 
  dist = 500; height = 10; alpha = 0; thickness = 10; offsetY = 0; r = 0; g = 0; b = 0;
}

@Injectable({ providedIn: 'root' })
export class FogRendererService {
  private fogWalls: TransformNode[] = []; 
  private fogMats: StandardMaterial[][] = []; 
  private wallStates: FogWallState[] = []; 
  private gradTex: DynamicTexture | null = null;
  private currentScene: Scene | null = null;

  constructor() { 
    for(let i = 0; i < 5; i++) {
      this.wallStates.push(new FogWallState()); 
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

    const anchorX = targetPlayer ? targetPlayer.position.x : 0;
    const anchorY = targetPlayer ? targetPlayer.position.y : 0;
    const anchorZ = targetPlayer ? targetPlayer.position.z : 0;

    for (let i = 0; i < 5; i++) {
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
                diameter: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE, cap: Mesh.NO_CAP, tessellation: 32 
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
      let tHex = globalClearHex; 

      if (useFog && activeLevels && activeLevels[i]) {
          tDist = Math.max(0.1, activeLevels[i].distance);
          tHeight = Math.max(0.1, activeLevels[i].height);
          tAlpha = Math.max(0, Math.min(100, activeLevels[i].opacity)) / 100;
          tThick = Math.max(0.1, activeLevels[i].thickness ?? 10);
          tOffsetY = activeLevels[i].offsetY ?? 0;
          tHex = activeLevels[i].color || targetColor.toHexString();
      }
      
      const tColor = Color3.FromHexString(tHex);

      if (firstFrame) {
         state.dist = tDist; state.height = tHeight; state.alpha = tAlpha; state.thickness = tThick; state.offsetY = tOffsetY;
         state.r = tColor.r; state.g = tColor.g; state.b = tColor.b;
      } else {
         state.dist += (tDist - state.dist) * lerpSpeed;
         state.height += (tHeight - state.height) * lerpSpeed;
         state.alpha += (tAlpha - state.alpha) * lerpSpeed;
         state.thickness += (tThick - state.thickness) * lerpSpeed;
         state.offsetY += (tOffsetY - state.offsetY) * lerpSpeed;
         state.r += (tColor.r - state.r) * lerpSpeed;
         state.g += (tColor.g - state.g) * lerpSpeed;
         state.b += (tColor.b - state.b) * lerpSpeed;
      }

      wallGroup.scaling.set(state.dist * 2, state.height, state.dist * 2);
      wallGroup.position.set(anchorX, anchorY + (state.height / 2) + state.offsetY, anchorZ);
      
      const isVisible = state.alpha > 0.001 && !isFogDisabledTemp;
      const thickOffsets = Array.from({length: 12}, (_, k) => -1 + (k * (2 / 11)));
      const curDist = Math.max(0.1, state.dist);
      const halfThick = state.thickness / 2;
      const meshes = wallGroup.getChildMeshes();

      let currentLayers = [5, 10, 20, 40, 60, 100, 100, 60, 40, 20, 10, 5]; 
      let currentHeights = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]; 
      if (activeLevels && activeLevels[i]) {
          if (activeLevels[i].layerOpacities && activeLevels[i].layerOpacities!.length === 12) currentLayers = activeLevels[i].layerOpacities!;
          if (activeLevels[i].layerHeights && activeLevels[i].layerHeights!.length === 12) currentHeights = activeLevels[i].layerHeights!;
      }

      for (let j = 0; j < 12; j++) {
          const shell = meshes.find(m => m.name === `sharedFogShell_${i}_${j}`);
          if (!shell) continue;

          const targetRadius = curDist + (thickOffsets[j] * halfThick);
          const localScaleX = targetRadius / curDist;
          
          const heightRatio = (currentHeights[j] ?? 100) / 100.0;
          shell.scaling.set(localScaleX, heightRatio, localScaleX);
          shell.position.y = -0.5 * (1 - heightRatio);

          const mat = this.fogMats[i][j];
          mat.emissiveColor.set(state.r, state.g, state.b);
          
          const opacityRatio = (currentLayers[j] ?? 0) / 100.0;
          mat.alpha = state.alpha * opacityRatio; 

          shell.isVisible = isVisible && mat.alpha > 0.005;
      }
    }

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ += (shadowLimit - sg.shadowMaxZ) * lerpSpeed;
      }
    });
  }
}