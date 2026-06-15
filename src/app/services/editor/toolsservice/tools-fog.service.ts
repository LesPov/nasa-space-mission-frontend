import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Color4, Scene, Vector3, Observer, Mesh, MeshBuilder, Engine, ShaderMaterial, Effect } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsFogService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private fogObserver: Observer<Scene> | null = null;
  private fogCylinder: Mesh | null = null; 

  private curStart = 500000;
  private curEnd = 500000;
  private curR = 0;
  private curG = 0;
  private curB = 0;
  private curDensity = 0.01;
  private curCylAlpha = 0; 
  private firstFrame = true;

  constructor() {
    // Shaders de la niebla cilíndrica (Perfectos)
    Effect.ShadersStore['silentFogVertexShader'] = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      varying vec3 vPositionW;
      varying vec2 vUV;
      void main() {
          vec4 p = vec4(position, 1.0);
          vPositionW = vec3(world * p);
          gl_Position = worldViewProjection * p;
          vUV = uv;
      }
    `;

    Effect.ShadersStore['silentFogFragmentShader'] = `
      precision highp float;
      varying vec3 vPositionW;
      varying vec2 vUV;
      
      uniform vec3 color;
      uniform float alphaMax;
      uniform float heightMax;
      uniform float falloffY;
      uniform vec3 playerPos;

      void main() {
          float yDist = vPositionW.y - playerPos.y;
          float yFactor = 1.0;
          
          if (yDist > (heightMax - falloffY)) {
             yFactor = clamp(1.0 - ((yDist - (heightMax - falloffY)) / falloffY), 0.0, 1.0);
          }
          if (yDist < 0.0) {
             yFactor = 1.0; 
          }

          float finalAlpha = alphaMax * yFactor;

          float edgeSoftness = 0.05;
          if(vUV.y > (1.0 - edgeSoftness)) finalAlpha *= (1.0 - vUV.y) / edgeSoftness;
          if(vUV.y < edgeSoftness) finalAlpha *= vUV.y / edgeSoftness;

          if (finalAlpha <= 0.01) discard;

          gl_FragColor = vec4(color, finalAlpha);
      }
    `;
  }

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
      this.curCylAlpha = 0;
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
    let activeEnd = 50000;
    let activeDensityEnd = 100;

    let targetFogHeightY = 10;
    let targetFogFalloffY = 3;
    let targetFogShape = 'sphere';

    // Se aplica la niebla si estamos jugando o editando y está activada
    if (modo === 'PLAYING' || modo === 'EDITING_IN_GAME' || modo === 'TRANSITIONING' || (targetPlayer && this.state.subObjetoSeleccionado() === 'fog')) {
      if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled) {
        useFog = true;
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        targetMode = fog.fogMode || 'linear';
        targetFogShape = fog.fogShape || 'cylinder';

        let rawStart: any = 0, rawEnd: any = 50000, rawRender: any = 100000, rawDensStart: any = 0, rawDensEnd: any = 100;

        // LÓGICA ESTRICTA: Separación Blanco/Negro vs Color
        if (isBW) {
          const colorObj = Color3.FromHexString(fog.colorBW || '#555555');
          targetR = colorObj.r; targetG = colorObj.g; targetB = colorObj.b;

          rawStart = isFPS ? fog.startFpsBW : fog.startTpsBW;
          rawEnd = isFPS ? fog.endFpsBW : fog.endTpsBW;
          rawRender = isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW;
          rawDensStart = isFPS ? fog.densityStartFpsBW : fog.densityStartTpsBW;
          rawDensEnd = isFPS ? fog.densityEndFpsBW : fog.densityEndTpsBW;
          
          targetFogHeightY = Math.max(0.1, fog.fogHeightYBW ?? 4.0);
          targetFogFalloffY = Math.max(0.1, fog.fogFalloffYBW ?? 1.5);
        } else {
          const colorObj = Color3.FromHexString(fog.color || '#0d1729');
          targetR = colorObj.r; targetG = colorObj.g; targetB = colorObj.b;

          rawStart = isFPS ? fog.startFPS : fog.startTPS;
          rawEnd = isFPS ? fog.endFPS : fog.endTPS;
          rawRender = isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS;
          rawDensStart = isFPS ? fog.densityStartFPS : fog.densityStartTPS;
          rawDensEnd = isFPS ? fog.densityEndFPS : fog.densityEndTPS;
          
          targetFogHeightY = Math.max(0.1, fog.fogHeightY ?? 4.0);
          targetFogFalloffY = Math.max(0.1, fog.fogFalloffY ?? 1.5);
        }
        
        if (targetMode !== 'linear') {
           targetDensity = Number.isFinite(Number(fog.density)) ? Number(fog.density) : 0.01;
        }

        const activeStart = Number.isFinite(Number(rawStart)) ? Math.max(0, Number(rawStart)) : 0;
        activeEnd = (Number.isFinite(Number(rawEnd)) && Number(rawEnd) > activeStart) ? Number(rawEnd) : activeStart + 50;
        const activeRenderDistance = (Number.isFinite(Number(rawRender)) && Number(rawRender) > activeEnd) ? Number(rawRender) : activeEnd + 500;
        
        const activeDensityStart = Number.isFinite(Number(rawDensStart)) ? Math.max(0, Math.min(99, Number(rawDensStart))) : 0;
        activeDensityEnd = Number.isFinite(Number(rawDensEnd)) ? Math.max(1, Math.min(100, Number(rawDensEnd))) : 100;

        let distCamToPlayer = 0;
        if (scene.activeCamera) {
          distCamToPlayer = Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition());
          if (modo === 'TRANSITIONING') distCamToPlayer = Math.min(distCamToPlayer, 8); 
        }

        const S = activeStart;
        const E = activeEnd;
        const ds = activeDensityStart / 100;
        const de = activeDensityEnd / 100;

        let targetFogStart, targetFogEnd;
        if (de > ds && E > S) {
            const range = (E - S) / (de - ds);
            targetFogStart = S - ds * range;
            targetFogEnd = targetFogStart + range;
        } else {
            targetFogStart = S;
            targetFogEnd = E;
        }

        targetStart = targetFogStart + distCamToPlayer; 
        targetEnd = targetFogEnd + distCamToPlayer; 
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

    const lerpSpeed = (modo === 'TRANSITIONING' || modo === 'PLAYING') ? 0.35 : 0.035; 

    if (!useFog || targetFogShape === 'sphere') {
      if (this.fogCylinder) {
          this.fogCylinder.dispose();
          this.fogCylinder = null;
          this.curCylAlpha = 0;
      }
      if (!useFog) {
        const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
        const targetColorObj = Color3.FromHexString(globalClearHex);
        targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;
        targetStart = 500000;
        targetEnd = 500000;
      }
    } else if (targetFogShape === 'cylinder' && useFog) {
      if (!this.fogCylinder) {
          this.fogCylinder = MeshBuilder.CreateCylinder('silentFogMesh', { height: 1, diameter: 1, tessellation: 32, cap: Mesh.NO_CAP }, scene);
          const shaderMat = new ShaderMaterial("silentFogMat", scene, { vertex: "silentFog", fragment: "silentFog" },
            { attributes: ["position", "uv"], uniforms: ["worldViewProjection", "world", "color", "alphaMax", "heightMax", "falloffY", "playerPos"], needAlphaBlending: true }
          );
          shaderMat.backFaceCulling = false; shaderMat.alphaMode = Engine.ALPHA_COMBINE; shaderMat.zOffset = -5; 
          this.fogCylinder.material = shaderMat;
          this.fogCylinder.isPickable = false; this.fogCylinder.receiveShadows = false; this.fogCylinder.applyFog = false; 
          this.fogCylinder.scaling.set(0, 0, 0); this.curCylAlpha = 0;
      }

      if (this.fogCylinder && targetPlayer) {
          const fog = targetPlayer.metadata.playerConfig.fog;
          const targetDiam = Math.max(15, activeEnd * 2.0); 
          const lerpCyl = lerpSpeed * 1.5;
          
          this.fogCylinder.scaling.x += (targetDiam - this.fogCylinder.scaling.x) * lerpCyl;
          this.fogCylinder.scaling.z += (targetDiam - this.fogCylinder.scaling.z) * lerpCyl;
          this.fogCylinder.scaling.y += (targetFogHeightY - this.fogCylinder.scaling.y) * lerpCyl;
          
          const fogOffsetX = Number.isFinite(Number(fog.offsetX)) ? Number(fog.offsetX) : 0;
          const fogOffsetY = Number.isFinite(Number(fog.offsetY)) ? Number(fog.offsetY) : 0;
          const fogOffsetZ = Number.isFinite(Number(fog.offsetZ)) ? Number(fog.offsetZ) : 0;

          const pPos = targetPlayer.getAbsolutePosition();
          
          // Posicionamiento tomando en cuenta el Offset guardado por el Gizmo
          this.fogCylinder.position.x = pPos.x + fogOffsetX;
          this.fogCylinder.position.z = pPos.z + fogOffsetZ;
          this.fogCylinder.position.y = pPos.y + fogOffsetY + (this.fogCylinder.scaling.y / 2); 
          
          const mat = this.fogCylinder.material as ShaderMaterial;
          const targetAlpha = Math.min(1.0, (activeDensityEnd / 100));

          mat.setColor3("color", new Color3(this.curR, this.curG, this.curB));
          this.curCylAlpha += (targetAlpha - this.curCylAlpha) * lerpCyl;
          
          mat.setFloat("alphaMax", this.curCylAlpha);
          mat.setFloat("heightMax", targetFogHeightY);
          mat.setFloat("falloffY", targetFogFalloffY);
          mat.setVector3("playerPos", new Vector3(pPos.x + fogOffsetX, pPos.y + fogOffsetY, pPos.z + fogOffsetZ));
      }
    }
    
    if (this.firstFrame) {
      this.curStart = targetStart; this.curEnd = targetEnd; this.curR = targetR; this.curG = targetG; this.curB = targetB; this.curDensity = targetDensity;
      this.firstFrame = false;
    } else {
      this.curStart += (targetStart - this.curStart) * lerpSpeed;
      this.curEnd += (targetEnd - this.curEnd) * lerpSpeed;
      this.curR += (targetR - this.curR) * lerpSpeed;
      this.curG += (targetG - this.curG) * lerpSpeed;
      this.curB += (targetB - this.curB) * lerpSpeed;
      this.curDensity += (targetDensity - this.curDensity) * lerpSpeed;
    }

    if (useFog && targetFogShape === 'sphere') {
      if (targetMode === 'exp2') scene.fogMode = Scene.FOGMODE_EXP2;
      else if (targetMode === 'exp') scene.fogMode = Scene.FOGMODE_EXP;
      else scene.fogMode = Scene.FOGMODE_LINEAR;
      scene.fogStart = this.curStart; scene.fogEnd = this.curEnd;
      if (targetMode !== 'linear') scene.fogDensity = this.curDensity;
      scene.fogColor = new Color3(this.curR, this.curG, this.curB);
      scene.clearColor = new Color4(this.curR, this.curG, this.curB, 1);
    } else {
      scene.fogMode = Scene.FOGMODE_NONE; 
      scene.clearColor = new Color4(this.curR, this.curG, this.curB, 1);
    }

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ += (shadowLimit - sg.shadowMaxZ) * lerpSpeed;
      }
    });
  }
}