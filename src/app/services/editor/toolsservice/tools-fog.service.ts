import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Color4, DynamicTexture, Engine, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, Observer } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { FogLevel } from '../player-config.model';

// Clase para mantener la interpolación individual de cada uno de los 5 muros
class FogWallState { 
  dist = 500; 
  height = 10; 
  alpha = 0; 
}

@Injectable({ providedIn: 'root' }) 
export class ToolsFogService { 
  private motor3d = inject(Motor3dService); 
  private state = inject(EditorStateService);

  private fogObserver: Observer<Scene> | null = null; 
  private firstFrame = true;

  // Colores Globales de la Niebla de Fondo Clásica 
  private curR = 0; 
  private curG = 0; 
  private curB = 0; 
  private curStart = 500000; 
  private curEnd = 500000;

  // MUROS FÍSICOS DE NIEBLA (Los 5 niveles) 
  private fogWalls: TransformNode[] = []; 
  // NODO QUE AGRUPA LAS CAPAS DE GROSOR 
  private fogMats: StandardMaterial[][] = []; 
  private wallStates: FogWallState[] = []; 
  private gradTex: DynamicTexture | null = null;

  constructor() { 
    for(let i = 0; i < 5; i++) {
      this.wallStates.push(new FogWallState()); 
    }
  }

  // 🔥 GRADIENTE MEJORADO: Diseñado para ocultar edificios.
  // Abajo es 100% sólido, arriba es invisible.
  private getGradientTexture(scene: Scene): DynamicTexture { 
    if (this.gradTex) return this.gradTex;

    // Textura hiper-liviana 2x128 para crear un degradado 1D
    const tex = new DynamicTexture("fogGradTex", { width: 2, height: 128 }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext();

    // Gradiente Y (Altura): Diseñado para tapar bases de objetos
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    
    // Y=0 es la PUNTA del cilindro (Techos visibles)
    grad.addColorStop(0, "rgba(255,255,255,0)");      // Cúspide: 100% invisible
    grad.addColorStop(0.15, "rgba(255,255,255,0)");   // Margen extra arriba invisible
    grad.addColorStop(0.35, "rgba(255,255,255,0.4)"); // Fusión suave a la mitad
    // Y=128 es el SUELO del cilindro (Bases ocultas)
    grad.addColorStop(0.6, "rgba(255,255,255,0.95)"); // Desde la mitad ya es casi sólido
    grad.addColorStop(0.8, "rgba(255,255,255,1)");    // Abajo es pared impenetrable
    grad.addColorStop(1, "rgba(255,255,255,1)");      // Piso: Sólido total

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 128);
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
      const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
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

    scene.clearColor = new Color4(this.curR, this.curG, this.curB, 1);
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
        
        const capasDeGrosor = 4;

        // 🔥 LOGICA VOLUMÉTRICA MEJORADA (Degradado Z Real)
        // Capa 0: Borde Interno (Muy transparente, evita corte cuando pasas cerca) - 15%
        // Capa 1: Núcleo Interno (Media densidad) - 45%
        // Capa 2: Núcleo Externo (Muy denso) - 85%
        // Capa 3: Borde Externo (Totalmente Sólido, oculta el fondo por completo) - 100%
        const alphaMultipliers = [0.15, 0.45, 0.85, 1.0];
        const scaleOffsets = [0.85, 0.95, 1.05, 1.15];

        for (let j = 0; j < capasDeGrosor; j++) {
            
            const mat = new StandardMaterial(`fogMat_${i}_${j}`, scene);
            mat.disableLighting = true; 
            mat.alphaMode = Engine.ALPHA_COMBINE;
            mat.disableDepthWrite = true; 
            mat.opacityTexture = this.getGradientTexture(scene);
            mat.fogEnabled = false; 
            
            (mat as any)._layerAlphaMultiplier = alphaMultipliers[j]; 
            this.fogMats[i].push(mat);

            const shell = MeshBuilder.CreateCylinder(`fogShell_${i}_${j}`, { 
                diameter: 1, 
                height: 1, 
                sideOrientation: Mesh.DOUBLESIDE, // Importante para que se vea por dentro y fuera
                cap: Mesh.NO_CAP,
                tessellation: 48 
            }, scene);
            
            shell.parent = this.fogWalls[i];
            
            const scaleOffset = scaleOffsets[j];
            shell.scaling.set(scaleOffset, 1, scaleOffset); 
            
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

      if (useFog && activeLevels && activeLevels[i]) {
          tDist = Math.max(0.1, activeLevels[i].distance);
          tHeight = Math.max(0.1, activeLevels[i].height);
          tAlpha = Math.max(0, Math.min(100, activeLevels[i].opacity)) / 100;
      }

      if (this.firstFrame) {
         state.dist = tDist; state.height = tHeight; state.alpha = tAlpha;
      } else {
         state.dist += (tDist - state.dist) * lerpSpeed;
         state.height += (tHeight - state.height) * lerpSpeed;
         state.alpha += (tAlpha - state.alpha) * lerpSpeed;
      }

      wallGroup.scaling.set(state.dist * 2, state.height, state.dist * 2);
      
      // Ajuste para que la base del cilindro corte perfectamente con el piso de tu juego
      wallGroup.position.set(anchorX, anchorY + (state.height / 2), anchorZ);
      
      const isVisible = state.alpha > 0.001;

      for (let j = 0; j < 4; j++) {
          const mat = this.fogMats[i][j];
          mat.emissiveColor.set(this.curR, this.curG, this.curB);
          mat.alpha = state.alpha * (mat as any)._layerAlphaMultiplier; 
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