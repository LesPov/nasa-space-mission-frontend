// file: src/app/core/engine/runtime/systems/fog-renderer.service.ts
import { Injectable } from '@angular/core';
import { AbstractMesh, Color3, DynamicTexture, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Tags } from '@babylonjs/core';
import { FogLevel } from '../../models/player-config.model';

class FogWallState { 
  dist = 150; 
  height = 25; 
  alpha = 1.0; 
  thickness = 30; 
  offsetY = 0; 
  r = 0; 
  g = 0; 
  b = 0;
}

@Injectable({ providedIn: 'root' })
export class FogRendererService {
  private fogWalls: TransformNode[] = []; 
  private fogShells: Mesh[][] = [];
  private fogMats: StandardMaterial[][] = []; 
  private wallStates: FogWallState[] = []; 
  private gradTex: DynamicTexture | null = null;
  private currentScene: Scene | null = null;

  private tColorCache = new Color3(0, 0, 0);

  public lastAnchorPosition = { x: 0, y: 0, z: 0 };
  public lastRingDistances: number[] = [15, 45, 90];

  private prevRenderAnchorX = -99999;
  private prevRenderAnchorY = -99999;
  private prevRenderAnchorZ = -99999;
  private prevTargetColorHex = '';
  private prevLevelsHash = '';

  private readonly MAX_CAPAS_POR_ANILLO = 12;

  constructor() { 
    for (let i = 0; i < 3; i++) {
      this.wallStates.push(new FogWallState()); 
    }
  }

  public invalidateCache(): void {
    this.prevRenderAnchorX = -99999;
    this.prevRenderAnchorY = -99999;
    this.prevRenderAnchorZ = -99999;
    this.prevTargetColorHex = '';
    this.prevLevelsHash = '';
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
    if (this.gradTex) { 
      try { this.gradTex.dispose(); } catch (e) {} 
    }
    this.currentScene = scene;

    const tex = new DynamicTexture("sharedFogGradTex", { width: 2, height: 256 }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();

    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, "rgba(255,255,255,0.75)"); 
    grad.addColorStop(0.15, "rgba(255,255,255,0.95)"); 
    grad.addColorStop(0.50, "rgba(255,255,255,1.0)"); 
    grad.addColorStop(0.85, "rgba(255,255,255,0.85)"); 
    grad.addColorStop(0.98, "rgba(255,255,255,0.25)"); 
    grad.addColorStop(1.00, "rgba(255,255,255,0.0)"); 

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    tex.update();

    this.gradTex = tex;
    return tex;
  }

  public hideAll(): void {
    for (let i = 0; i < this.fogShells.length; i++) {
      const shells = this.fogShells[i];
      if (shells) {
        for (let j = 0; j < shells.length; j++) {
          if (shells[j] && !shells[j].isDisposed() && shells[j].isVisible) {
            shells[j].isVisible = false;
          }
        }
      }
    }
  }

  public dispose(): void {
    for (let i = 0; i < this.fogShells.length; i++) {
      const shells = this.fogShells[i];
      if (shells) {
        for (let j = 0; j < shells.length; j++) {
          if (shells[j] && !shells[j].isDisposed()) {
            shells[j].dispose(false, true);
          }
        }
      }
    }
    this.fogShells = [];

    this.fogWalls.forEach(w => { 
      if (w && !w.isDisposed()) w.dispose(); 
    });
    this.fogWalls = [];
    this.fogMats = [];

    if (this.gradTex) { 
      try { this.gradTex.dispose(); } catch (e) {} 
    }
    this.gradTex = null;
    this.currentScene = null;

    this.invalidateCache();
  }

  private computeLevelsHash(levels: FogLevel[]): string {
    if (!levels || levels.length === 0) return '';
    let hash = '';
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (!l) continue;
      hash += `${i}:${l.distance}_${l.height}_${l.opacity}_${l.thickness}_${l.offsetY}_${l.color || ''}|`;
    }
    return hash;
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
    if (hideCompletely || !useFog || isFogDisabledTemp) {
      this.hideAll();
      return;
    }

    if (this.fogWalls[0] && (this.fogWalls[0].getScene() !== scene || this.fogWalls[0].isDisposed())) {
      this.dispose();
    }

    let anchorX = 0;
    let anchorY = 0;
    let anchorZ = 0;

    if (targetPlayer && !targetPlayer.isDisposed()) {
      targetPlayer.computeWorldMatrix(true);
      const absPos = targetPlayer.getAbsolutePosition();
      anchorX = absPos.x;
      anchorY = absPos.y;
      anchorZ = absPos.z;
    } else {
      const activeCam = scene.activeCamera;
      if (activeCam) {
        activeCam.computeWorldMatrix();
        anchorX = activeCam.globalPosition.x;
        anchorY = activeCam.globalPosition.y - 1.6;
        anchorZ = activeCam.globalPosition.z;
      }
    }

    this.lastAnchorPosition.x = anchorX;
    this.lastAnchorPosition.y = anchorY;
    this.lastAnchorPosition.z = anchorZ;

    const currentLevelsHash = this.computeLevelsHash(activeLevels);

    const dx = Math.abs(anchorX - this.prevRenderAnchorX);
    const dy = Math.abs(anchorY - this.prevRenderAnchorY);
    const dz = Math.abs(anchorZ - this.prevRenderAnchorZ);
    const isStationary = !firstFrame && dx < 0.02 && dy < 0.02 && dz < 0.02 && 
                         this.prevTargetColorHex === globalClearHex && 
                         this.prevLevelsHash === currentLevelsHash;

    if (isStationary && this.fogWalls.length === 3) {
      return;
    }

    this.prevRenderAnchorX = anchorX;
    this.prevRenderAnchorY = anchorY;
    this.prevRenderAnchorZ = anchorZ;
    this.prevTargetColorHex = globalClearHex;
    this.prevLevelsHash = currentLevelsHash;

    const totalCapas = this.MAX_CAPAS_POR_ANILLO;

    for (let i = 0; i < 3; i++) {
      if (!this.fogWalls[i] || this.fogWalls[i].isDisposed()) {
        this.fogWalls[i] = new TransformNode("sharedFogWallGroup_" + i, scene);
        this.fogMats[i] = []; 
        this.fogShells[i] = [];
        
        for (let j = totalCapas - 1; j >= 0; j--) {
          const mat = new StandardMaterial(`sharedFogMat_${i}_${j}`, scene);
          mat.disableLighting = true; 
          mat.alphaMode = Engine.ALPHA_COMBINE;
          mat.disableDepthWrite = true; 
          mat.backFaceCulling = false;
          mat.opacityTexture = this.getGradientTexture(scene); 
          mat.fogEnabled = false; 
          this.fogMats[i][j] = mat; 

          const shell = MeshBuilder.CreateCylinder(`sharedFogShell_${i}_${j}`, { 
            diameter: 1, 
            height: 1, 
            sideOrientation: Mesh.DOUBLESIDE, 
            cap: Mesh.NO_CAP, 
            tessellation: 32 
          }, scene);
          
          shell.parent = this.fogWalls[i];
          shell.scaling.set(1, 1, 1); 
          shell.material = mat;
          shell.isPickable = false;
          shell.checkCollisions = false;
          shell.receiveShadows = false;
          shell.applyFog = false;
          shell.alwaysSelectAsActiveMesh = true;
          shell.doNotSyncBoundingInfo = true; 
          Tags.AddTagsTo(shell, "system_element fog_element ignore_raycast");

          this.fogShells[i][j] = shell;
        }
      }

      const wallGroup = this.fogWalls[i];
      const state = this.wallStates[i];

      let tDist = 150;
      let tHeight = 25;
      let tAlpha = 1.0;
      let tThick = 30;
      let tOffsetY = 0; 
      
      this.tColorCache.copyFrom(targetColor);

      const level = activeLevels && activeLevels[i];

      if (useFog && level) {
        tDist = Math.max(1.0, level.distance);
        tHeight = Math.max(1.0, level.height);
        tAlpha = Math.max(0, Math.min(100, level.opacity)) / 100;
        tThick = Math.max(1.0, level.thickness ?? 15);
        tOffsetY = level.offsetY ?? 0;
        if (level.color) {
          this.hexToColor3(level.color, this.tColorCache);
        }
      }

      this.lastRingDistances[i] = tDist;

      if (firstFrame || lerpSpeed >= 0.99) {
        state.dist = tDist; 
        state.height = tHeight; 
        state.alpha = tAlpha; 
        state.thickness = tThick; 
        state.offsetY = tOffsetY;
        state.r = this.tColorCache.r; 
        state.g = this.tColorCache.g; 
        state.b = this.tColorCache.b;
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
      const shells = this.fogShells[i];

      const activeSubCapas = level?.layerOpacities ? Math.min(totalCapas, level.layerOpacities.length) : 6;
      const numCapas = Math.max(1, activeSubCapas);

      for (let j = 0; j < totalCapas; j++) {
        const shell = shells[j];
        if (!shell || shell.isDisposed()) continue;

        if (j >= numCapas) {
          shell.isVisible = false;
          continue;
        }

        const offsetNormalized = numCapas > 1 ? -1 + (j * (2 / (numCapas - 1))) : 0;
        const targetRadius = curDist + (offsetNormalized * halfThick);
        const localScaleX = targetRadius / curDist;
        
        const hFactor = (level?.layerHeights && level.layerHeights[j] !== undefined)
          ? Math.max(0.01, level.layerHeights[j] / 100)
          : 1.0;

        shell.scaling.set(localScaleX, hFactor, localScaleX);
        shell.position.y = 0;

        const oFactor = (level?.layerOpacities && level.layerOpacities[j] !== undefined)
          ? Math.max(0.0, Math.min(1.0, level.layerOpacities[j] / 100))
          : 1.0;

        const mat = this.fogMats[i][j];
        mat.emissiveColor.set(state.r, state.g, state.b);
        mat.alpha = state.alpha * 0.45 * oFactor;

        shell.isVisible = isVisible && mat.alpha > 0.002;
      }
    }
  }
}