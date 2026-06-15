import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Color4, Scene, Vector3, Observer, Mesh, Engine, ShaderMaterial, Effect, VertexData } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsFogService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private fogObserver: Observer<Scene> | null = null;
  private fogDonut: Mesh | null = null; 

  private curStart = 500000;
  private curEnd = 500000;
  private curR = 0;
  private curG = 0;
  private curB = 0;
  private curDensity = 0.01;
  
  private curInner = 0.1;
  private curOuter = 1.0;
  private curHeightStart = 4.0;
  private curHeightEnd = 10.0;
  private curAlpha = 0; 

  private firstFrame = true;

  constructor() {
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
      
      uniform float heightMaxStart;
      uniform float heightMaxEnd;
      uniform float falloffYStart;
      uniform float falloffYEnd;
      
      uniform float innerRadius;
      uniform float outerRadius;
      uniform vec3 playerPos;

      void main() {
          float distXZ = distance(vPositionW.xz, playerPos.xz);
          
          float t = clamp((distXZ - innerRadius) / (outerRadius - innerRadius + 0.001), 0.0, 1.0);
          
          float currentHeight = mix(heightMaxStart, heightMaxEnd, t);
          float currentFalloff = mix(falloffYStart, falloffYEnd, t);

          float yDist = vPositionW.y - playerPos.y;
          float yFactor = 1.0;
          
          if (yDist > (currentHeight - currentFalloff)) {
             yFactor = clamp(1.0 - ((yDist - (currentHeight - currentFalloff)) / max(0.001, currentFalloff)), 0.0, 1.0);
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

  // 🔥 FIX: Limpia totalmente los observadores de niebla para que recargue al 100%
  public limpiarEstado(): void {
    if (this.fogObserver && this.motor3d.scene) {
      this.motor3d.scene.onBeforeRenderObservable.remove(this.fogObserver);
    }
    this.fogObserver = null;
    if (this.fogDonut) {
      this.fogDonut.dispose();
      this.fogDonut = null;
    }
    this.firstFrame = true;
  }

  private updateDonutMesh(mesh: Mesh, innerRadius: number, outerRadius: number, innerHeight: number, outerHeight: number, tessellation: number = 48) {
      if (innerRadius < 0) innerRadius = 0.1;
      if (outerRadius <= innerRadius) outerRadius = innerRadius + 0.1;
      
      const positions = [];
      const indices = [];
      const uvs = [];
      
      for (let i = 0; i <= tessellation; i++) {
          const angle = (i / tessellation) * Math.PI * 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          
          positions.push(innerRadius * cos, 0, innerRadius * sin); uvs.push(i / tessellation, 0);
          positions.push(outerRadius * cos, 0, outerRadius * sin); uvs.push(i / tessellation, 0);
          positions.push(outerRadius * cos, outerHeight, outerRadius * sin); uvs.push(i / tessellation, 1);
          positions.push(innerRadius * cos, innerHeight, innerRadius * sin); uvs.push(i / tessellation, 1);
      }
      
      for (let i = 0; i < tessellation; i++) {
          const base = i * 4;
          const next = (i + 1) * 4;
          
          indices.push(base, next, base + 1); indices.push(next, next + 1, base + 1);
          indices.push(base + 1, next + 1, base + 2); indices.push(next + 1, next + 2, base + 2);
          indices.push(base + 2, next + 2, base + 3); indices.push(next + 2, next + 3, base + 3);
          indices.push(base + 3, next + 3, base); indices.push(next + 3, next, base);
      }
      
      const vertexData = new VertexData();
      vertexData.positions = positions;
      vertexData.indices = indices;
      vertexData.uvs = uvs;
      
      vertexData.applyToMesh(mesh, true); 
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
      
      this.curInner = 0.1;
      this.curOuter = 1.0;
      this.curHeightStart = 4.0;
      this.curHeightEnd = 10.0;
      this.curAlpha = 0;

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

    let targetFogHeightStart = 4.0, targetFogHeightEnd = 10.0;
    let targetFogFalloffStart = 1.5, targetFogFalloffEnd = 3.0;
    let targetFogShape = 'sphere';
    let activeStart = 0;

    const isSelectedInEditor = (modo === 'EDITOR' || modo === 'EDITING_IN_GAME') && this.state.objetoSeleccionado() === targetPlayer;

    if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled && (modo === 'PLAYING' || modo === 'TRANSITIONING' || isSelectedInEditor)) {
        useFog = true;
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        targetMode = fog.fogMode || 'linear';
        targetFogShape = fog.fogShape || 'cylinder';

        let rawStart: any = 0, rawEnd: any = 50000, rawRender: any = 100000, rawDensStart: any = 0, rawDensEnd: any = 100;

        if (isBW) {
          const colorObj = Color3.FromHexString(fog.colorBW || '#555555');
          targetR = colorObj.r; targetG = colorObj.g; targetB = colorObj.b;

          rawStart = isFPS ? fog.startFpsBW : fog.startTpsBW;
          rawEnd = isFPS ? fog.endFpsBW : fog.endTpsBW;
          rawRender = isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW;
          rawDensStart = isFPS ? fog.densityStartFpsBW : fog.densityStartTpsBW;
          rawDensEnd = isFPS ? fog.densityEndFpsBW : fog.densityEndTpsBW;
          
          targetFogHeightStart = Math.max(0.1, isFPS ? (fog.fogHeightYStartFpsBW ?? 4.0) : (fog.fogHeightYStartTpsBW ?? 4.0));
          targetFogHeightEnd = Math.max(0.1, isFPS ? (fog.fogHeightYEndFpsBW ?? targetFogHeightStart) : (fog.fogHeightYEndTpsBW ?? targetFogHeightStart));
          targetFogFalloffStart = Math.max(0.1, isFPS ? (fog.fogFalloffYStartFpsBW ?? 1.5) : (fog.fogFalloffYStartTpsBW ?? 1.5));
          targetFogFalloffEnd = Math.max(0.1, isFPS ? (fog.fogFalloffYEndFpsBW ?? targetFogFalloffStart) : (fog.fogFalloffYEndTpsBW ?? targetFogFalloffStart));
        } else {
          const colorObj = Color3.FromHexString(fog.color || '#0d1729');
          targetR = colorObj.r; targetG = colorObj.g; targetB = colorObj.b;

          rawStart = isFPS ? fog.startFPS : fog.startTPS;
          rawEnd = isFPS ? fog.endFPS : fog.endTPS;
          rawRender = isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS;
          rawDensStart = isFPS ? fog.densityStartFPS : fog.densityStartTPS;
          rawDensEnd = isFPS ? fog.densityEndFPS : fog.densityEndTPS;
          
          targetFogHeightStart = Math.max(0.1, isFPS ? (fog.fogHeightYStartFPS ?? 4.0) : (fog.fogHeightYStartTPS ?? 4.0));
          targetFogHeightEnd = Math.max(0.1, isFPS ? (fog.fogHeightYEndFPS ?? targetFogHeightStart) : (fog.fogHeightYEndTPS ?? targetFogHeightStart));
          targetFogFalloffStart = Math.max(0.1, isFPS ? (fog.fogFalloffYStartFPS ?? 1.5) : (fog.fogFalloffYStartTPS ?? 1.5));
          targetFogFalloffEnd = Math.max(0.1, isFPS ? (fog.fogFalloffYEndFPS ?? targetFogFalloffStart) : (fog.fogFalloffYEndTPS ?? targetFogFalloffStart));
        }
        
        if (targetMode !== 'linear') {
           targetDensity = Number.isFinite(Number(fog.density)) ? Number(fog.density) : 0.01;
        }

        activeStart = Number.isFinite(Number(rawStart)) ? Math.max(0, Number(rawStart)) : 0;
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

    const lerpSpeed = (modo === 'TRANSITIONING' || modo === 'PLAYING') ? 0.35 : 0.06; 

    if (!useFog || targetFogShape === 'sphere') {
      if (this.fogDonut) {
          this.fogDonut.dispose();
          this.fogDonut = null;
          this.curAlpha = 0;
      }
      if (!useFog) {
        const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
        const targetColorObj = Color3.FromHexString(globalClearHex);
        targetR = targetColorObj.r; targetG = targetColorObj.g; targetB = targetColorObj.b;
        targetStart = 500000;
        targetEnd = 500000;
      }
    } else if (targetFogShape === 'cylinder' && useFog) {
      if (!this.fogDonut) {
          this.fogDonut = new Mesh('silentFogDonut', scene);
          const shaderMat = new ShaderMaterial("silentFogMat", scene, { vertex: "silentFog", fragment: "silentFog" },
            { attributes: ["position", "uv"], 
              uniforms: ["worldViewProjection", "world", "color", "alphaMax", "heightMaxStart", "heightMaxEnd", "falloffYStart", "falloffYEnd", "innerRadius", "outerRadius", "playerPos"], 
              needAlphaBlending: true }
          );
          shaderMat.backFaceCulling = false; 
          shaderMat.alphaMode = Engine.ALPHA_COMBINE; 
          shaderMat.zOffset = -5; 
          this.fogDonut.material = shaderMat;
          this.fogDonut.isPickable = false; 
          this.fogDonut.receiveShadows = false; 
          this.fogDonut.applyFog = false; 
          this.curAlpha = 0;
          this.updateDonutMesh(this.fogDonut, 0.1, 1.0, 4.0, 10.0, 48);
      }

      if (this.fogDonut && targetPlayer) {
          const fog = targetPlayer.metadata.playerConfig.fog;
          const lerpCyl = lerpSpeed * 1.5;
          
          const targetInnerRadius = Math.max(0.1, activeStart);
          const targetOuterRadius = Math.max(targetInnerRadius + 0.1, activeEnd);

          if (this.firstFrame) {
            this.curInner = targetInnerRadius;
            this.curOuter = targetOuterRadius;
            this.curHeightStart = targetFogHeightStart;
            this.curHeightEnd = targetFogHeightEnd;
          } else {
            this.curInner += (targetInnerRadius - this.curInner) * lerpCyl;
            this.curOuter += (targetOuterRadius - this.curOuter) * lerpCyl;
            this.curHeightStart += (targetFogHeightStart - this.curHeightStart) * lerpCyl;
            this.curHeightEnd += (targetFogHeightEnd - this.curHeightEnd) * lerpCyl;
          }

          this.updateDonutMesh(this.fogDonut, this.curInner, this.curOuter, this.curHeightStart, this.curHeightEnd, 48);
          
          const fogOffsetX = isFPS ? (Number.isFinite(Number(fog.offsetXFPS)) ? Number(fog.offsetXFPS) : 0) : (Number.isFinite(Number(fog.offsetXTPS)) ? Number(fog.offsetXTPS) : 0);
          const fogOffsetY = isFPS ? (Number.isFinite(Number(fog.offsetYFPS)) ? Number(fog.offsetYFPS) : 0) : (Number.isFinite(Number(fog.offsetYTPS)) ? Number(fog.offsetYTPS) : 0);
          const fogOffsetZ = isFPS ? (Number.isFinite(Number(fog.offsetZFPS)) ? Number(fog.offsetZFPS) : 0) : (Number.isFinite(Number(fog.offsetZTPS)) ? Number(fog.offsetZTPS) : 0);

          const pPos = targetPlayer.getAbsolutePosition();
          
          this.fogDonut.position.x = pPos.x + fogOffsetX;
          this.fogDonut.position.z = pPos.z + fogOffsetZ;
          this.fogDonut.position.y = pPos.y + fogOffsetY; 
          
          const mat = this.fogDonut.material as ShaderMaterial;
          const targetAlpha = Math.min(1.0, (activeDensityEnd / 100));

          mat.setColor3("color", new Color3(this.curR, this.curG, this.curB));
          
          if (this.firstFrame) this.curAlpha = targetAlpha;
          else this.curAlpha += (targetAlpha - this.curAlpha) * lerpCyl;
          
          mat.setFloat("alphaMax", this.curAlpha);
          
          mat.setFloat("heightMaxStart", this.curHeightStart);
          mat.setFloat("heightMaxEnd", this.curHeightEnd);
          mat.setFloat("falloffYStart", targetFogFalloffStart);
          mat.setFloat("falloffYEnd", targetFogFalloffEnd);
          mat.setFloat("innerRadius", this.curInner);
          mat.setFloat("outerRadius", this.curOuter);
          
          mat.setVector3("playerPos", new Vector3(pPos.x + fogOffsetX, pPos.y + fogOffsetY, pPos.z + fogOffsetZ));
      }
    }
    
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

    if (useFog && (modo === 'PLAYING' || modo === 'TRANSITIONING')) {
      if (targetMode === 'exp2') scene.fogMode = Scene.FOGMODE_EXP2;
      else if (targetMode === 'exp') scene.fogMode = Scene.FOGMODE_EXP;
      else scene.fogMode = Scene.FOGMODE_LINEAR;
      
      scene.fogStart = this.curStart; 
      scene.fogEnd = this.curEnd;
      if (targetMode !== 'linear') scene.fogDensity = this.curDensity;
      
      scene.fogColor = new Color3(this.curR, this.curG, this.curB);
      // 🔥 FIX: Quitamos la orden de pintar scene.clearColor, así el Cielo no se altera por la Niebla.
    } else {
      scene.fogMode = Scene.FOGMODE_NONE; 
      // 🔥 FIX: Lo mismo aquí, respetamos el color del usuario configurado en PropWorld
    }

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ += (shadowLimit - sg.shadowMaxZ) * lerpSpeed;
      }
    });
  }
}