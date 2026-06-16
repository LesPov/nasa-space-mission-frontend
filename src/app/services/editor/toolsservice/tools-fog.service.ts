import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Color4, DynamicTexture, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, Observer } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { FogLevel } from '../player-config.model';

class FogWallState { 
  dist = 500; 
  height = 10; 
  alpha = 0; 
  thickness = 10; 
  offsetY = 0; 
  r = 0;
  g = 0;
  b = 0;
}

@Injectable({ providedIn: 'root' }) 
export class ToolsFogService { 
  private motor3d = inject(Motor3dService); 
  private state = inject(EditorStateService);

  private fogObserver: Observer<Scene> | null = null; 
  private firstFrame = true;

  private curR = 0; 
  private curG = 0; 
  private curB = 0; 
  private curStart = 500000; 
  private curEnd = 500000;

  private fogWalls: TransformNode[] = []; 
  private fogMats: StandardMaterial[][] = []; 
  private wallStates: FogWallState[] = []; 
  private gradTex: DynamicTexture | null = null;

  constructor() { 
    for(let i = 0; i < 5; i++) {
      this.wallStates.push(new FogWallState()); 
    }
  }

  private getGradientTexture(scene: Scene): DynamicTexture { 
    if (this.gradTex) return this.gradTex;

    const tex = new DynamicTexture("fogGradTex", { width: 2, height: 256 }, scene, false);
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

  public aplicarNieblaEnTiempoReal(): void { 
    const scene = this.motor3d.scene; 
    if (!scene) return;

    if (!this.fogObserver) {
      const globalClearHex = (scene.metadata && scene.metadata.globalClearColor) ? scene.metadata.globalClearColor : '#0d1729';
      const clearColor3 = Color3.FromHexString(globalClearHex);
      this.curR = clearColor3.r; this.curG = clearColor3.g; this.curB = clearColor3.b;
      
      this.curStart = scene.fogStart || 500000;
      this.curEnd = scene.fogEnd || 500000;
      this.firstFrame = true;

      this.fogObserver = scene.onBeforeRenderObservable.add(() => this.updateFogFrame(scene));
    }
  }

  private updateFogFrame(scene: Scene): void { 
    const modo = this.state.playState(); 
    let targetPlayer: AbstractMesh | null = null; 
    let shadowLimit = 500000;

    if (this.state.jugadorActivo) {
       targetPlayer = this.state.jugadorActivo;
    } else {
       targetPlayer = scene.meshes.find(m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc') || null;
    }

    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    const lerpSpeed = (modo === 'TRANSITIONING' || modo === 'PLAYING') ? 0.35 : 0.035; 

    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;
    let activeLevels: FogLevel[] = [];
    
    const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');

    if ((modo === 'PLAYING' || modo === 'EDITING_IN_GAME' || modo === 'TRANSITIONING') && targetPlayer?.metadata?.playerConfig?.fog?.enabled) {
      useFog = true;
      const fog = targetPlayer.metadata.playerConfig.fog;
      
      const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
      const targetColorObj = Color3.FromHexString(activeColor);
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;

      const renderDistance = isBW 
        ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW) 
        : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);

      activeLevels = isBW 
        ? (isFPS ? fog.levelsFpsBW : fog.levelsTpsBW) 
        : (isFPS ? fog.levelsFPS : fog.levelsTPS);

      let distCamToPlayer = scene.activeCamera ? Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition()) : 0;
      if (modo === 'TRANSITIONING') distCamToPlayer = Math.min(distCamToPlayer, 8); 
      
      const renderMaxZ = (Number(renderDistance) || 100000) + distCamToPlayer;

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
      this.curStart = renderMaxZ * 0.8;
      this.curEnd = renderMaxZ;
    } else {
      const targetColorObj = Color3.FromHexString(globalClearHex);
      targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;

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

    if (this.fogWalls[0] && this.fogWalls[0].getScene() !== scene) {
        this.fogWalls = [];
        this.fogMats = [];
    }

    const anchorX = targetPlayer ? targetPlayer.position.x : 0;
    const anchorY = targetPlayer ? targetPlayer.position.y : 0;
    const anchorZ = targetPlayer ? targetPlayer.position.z : 0;

    for (let i = 0; i < 5; i++) {
      if (!this.fogWalls[i]) {
        this.fogWalls[i] = new TransformNode("fogWallGroup_" + i, scene);
        this.fogMats[i] = []; 
        
        const capasDeGrosor = 12; // 🔥 AHORA SON 12 CAPAS
        for (let j = capasDeGrosor - 1; j >= 0; j--) {
            const mat = new StandardMaterial(`fogMat_${i}_${j}`, scene);
            mat.disableLighting = true; 
            mat.alphaMode = Engine.ALPHA_COMBINE;
            mat.disableDepthWrite = true; 
            mat.opacityTexture = this.getGradientTexture(scene); // Mantiene solo el corte suave en la parte SUPERIOR para que no parezca un tubo cortado
            mat.fogEnabled = false; 
            this.fogMats[i][j] = mat; 

            // 🔥 SUAVIZADO DE CILINDRO PERFECTO (tessellation 128)
            const shell = MeshBuilder.CreateCylinder(`fogShell_${i}_${j}`, { 
                diameter: 1, 
                height: 1, 
                sideOrientation: Mesh.DOUBLESIDE, 
                cap: Mesh.NO_CAP,
                tessellation: 128 
            }, scene);
            
            shell.parent = this.fogWalls[i];
            shell.scaling.set(1, 1, 1); 
            shell.material = mat;
            shell.isPickable = false;
            shell.checkCollisions = false;
            shell.receiveShadows = false;
            shell.applyFog = false;
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
          
          const fog = targetPlayer?.metadata?.playerConfig?.fog;
          tHex = activeLevels[i].color || (isBW ? (fog?.colorBW || '#888888') : (fog?.color || '#0d1729'));
      }
      
      const tColor = Color3.FromHexString(tHex);

      if (this.firstFrame) {
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
      
      const isVisible = state.alpha > 0.001;
      
      // 🔥 ESPACIADO MANUAL DINÁMICO PARA 12 CAPAS (De -1 a 1 equitativo)
      // Esto reparte las 12 capas en el "Grosor" que hayas definido, sin usar curvas de Gauss
      const thickOffsets = Array.from({length: 12}, (_, k) => -1 + (k * (2 / 11)));
      
      const curDist = Math.max(0.1, state.dist);
      const halfThick = state.thickness / 2;

      const meshes = wallGroup.getChildMeshes();

      // Valores por defecto si falla el input
      let currentLayers = [5, 10, 20, 40, 60, 100, 100, 60, 40, 20, 10, 5]; 
      let currentHeights = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]; 
      if (activeLevels && activeLevels[i]) {
          if (activeLevels[i].layerOpacities && activeLevels[i].layerOpacities!.length === 12) currentLayers = activeLevels[i].layerOpacities!;
          if (activeLevels[i].layerHeights && activeLevels[i].layerHeights!.length === 12) currentHeights = activeLevels[i].layerHeights!;
      }

      // 🔥 BUCLE PARA LAS 12 CAPAS
      for (let j = 0; j < 12; j++) {
          const shell = meshes.find(m => m.name === `fogShell_${i}_${j}`);
          if (!shell) continue;

          const targetRadius = curDist + (thickOffsets[j] * halfThick);
          const localScaleX = targetRadius / curDist;
          
          // 🔥 Aplicamos la Altura en %
          const heightRatio = (currentHeights[j] ?? 100) / 100.0;
          shell.scaling.set(localScaleX, heightRatio, localScaleX);
          
          shell.position.y = -0.5 * (1 - heightRatio);

          const mat = this.fogMats[i][j];
          mat.emissiveColor.set(state.r, state.g, state.b);
          
          // 🔥 Opacidad 100% controlada por tu input manual
          const opacityRatio = (currentLayers[j] ?? 0) / 100.0;
          mat.alpha = state.alpha * opacityRatio; 
      }

      wallGroup.getChildMeshes().forEach((m) => {
          m.isVisible = isVisible;
      });
    }

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ += (shadowLimit - sg.shadowMaxZ) * lerpSpeed;
      }
    });

    this.firstFrame = false;
  } 
}