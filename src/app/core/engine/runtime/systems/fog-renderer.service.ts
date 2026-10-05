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

  constructor() { 
    for (let i = 0; i < 3; i++) {
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
    if (this.gradTex) { 
      try { this.gradTex.dispose(); } catch (e) {} 
    }
    this.currentScene = scene;

    const tex = new DynamicTexture("sharedFogGradTex", { width: 2, height: 256 }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();

    // Gradiente continuo con cobertura total en la base para evitar huecos en el horizonte bajo
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

    // Centro espacial tomado de coordenadas absolutas en espacio mundial
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

    const capasDeGrosor = 6;

    for (let i = 0; i < 3; i++) {
      if (!this.fogWalls[i] || this.fogWalls[i].isDisposed()) {
        this.fogWalls[i] = new TransformNode("sharedFogWallGroup_" + i, scene);
        this.fogMats[i] = []; 
        this.fogShells[i] = [];
        
        for (let j = capasDeGrosor - 1; j >= 0; j--) {
          const mat = new StandardMaterial(`sharedFogMat_${i}_${j}`, scene);
          mat.disableLighting = true; 
          mat.alphaMode = Engine.ALPHA_COMBINE;
          mat.disableDepthWrite = true; 
          mat.backFaceCulling = false; // Permite ver el reverso de los cilindros sin descarte de GPU
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

          // EVITA LA DESAPARICIÓN AL GIRAR LA CÁMARA:
          // Inmuniza la malla contra el frustum culling de Babylon.js para que siempre exista alrededor del Player en 360°
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

      if (useFog && activeLevels && activeLevels[i]) {
        tDist = Math.max(15.0, activeLevels[i].distance);
        tHeight = Math.max(2.0, activeLevels[i].height);
        tAlpha = Math.max(0, Math.min(100, activeLevels[i].opacity)) / 100;
        tThick = Math.max(1.0, activeLevels[i].thickness ?? 15);
        tOffsetY = activeLevels[i].offsetY ?? 0;
        if (activeLevels[i].color) {
          this.hexToColor3(activeLevels[i].color!, this.tColorCache);
        }
      }

      this.lastRingDistances[i] = tDist;

      if (firstFrame) {
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

      // Renderizado estable de todas las capas artísticas con acceso directo en O(1)
      for (let j = 0; j < capasDeGrosor; j++) {
        const shell = shells[j];
        if (!shell || shell.isDisposed()) continue;

        const offsetNormalized = -1 + (j * (2 / Math.max(1, capasDeGrosor - 1)));
        const targetRadius = curDist + (offsetNormalized * halfThick);
        const localScaleX = targetRadius / curDist;
        
        shell.scaling.set(localScaleX, 1.0, localScaleX);
        shell.position.y = 0;

        const mat = this.fogMats[i][j];
        mat.emissiveColor.set(state.r, state.g, state.b);
        mat.alpha = state.alpha * 0.45;

        shell.isVisible = isVisible && mat.alpha > 0.005;
      }
    }
  }
}