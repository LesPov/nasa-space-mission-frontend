
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, CascadedShadowGenerator, Color3, Scene, Vector3, Observer, Mesh, Engine, ShaderMaterial, Effect, VertexData } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsFogService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private fogObserver: Observer<Scene> | null = null;
  // 🔥 AHORA USAMOS UN ARRAY PARA GUARDAR LOS 4 CILINDROS (4 Anillos de Niebla)
  private fogDonuts: Mesh[] = []; 

  private curStart = 500000;
  private curEnd = 500000;
  
  // Variables Lerp para colores de inicio, medios y fin
  private curRStart = 0; private curGStart = 0; private curBStart = 0;
  private curRMedio1 = 0; private curGMedio1 = 0; private curBMedio1 = 0;
  private curRMedio2 = 0; private curGMedio2 = 0; private curBMedio2 = 0;
  private curREnd = 0; private curGEnd = 0; private curBEnd = 0;
  
  private curDensity = 0.01;
  private curInner = 0.1;
  private curMedio1 = 1.0;
  private curMedio2 = 2.0;
  private curOuter = 3.0;

  private curHeightStart = 4.0;
  private curHeightMedio1 = 6.0;
  private curHeightMedio2 = 8.0;
  private curHeightEnd = 10.0;
  
  // Variables Lerp para opacidades
  private curAlphaStart = 0; 
  private curAlphaMedio1 = 0; 
  private curAlphaMedio2 = 0; 
  private curAlphaEnd = 0; 

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
      
      uniform vec3 colorStart;
      uniform vec3 colorMedio1;
      uniform vec3 colorMedio2;
      uniform vec3 colorEnd;
      
      uniform float alphaStart;
      uniform float alphaMedio1;
      uniform float alphaMedio2;
      uniform float alphaEnd;
      
      uniform float heightMaxStart;
      uniform float heightMaxMedio1;
      uniform float heightMaxMedio2;
      uniform float heightMaxEnd;
      
      uniform float falloffYStart;
      uniform float falloffYMedio1;
      uniform float falloffYMedio2;
      uniform float falloffYEnd;
      
      uniform float radiusInner;
      uniform float radiusStart;
      uniform float radiusMedio1;
      uniform float radiusMedio2;
      uniform float radiusEnd;
      
      uniform vec3 playerPos;

      void main() {
          float distXZ = distance(vPositionW.xz, playerPos.xz);
          
          vec3 currentColor;
          float currentAlpha;
          float currentHeight;
          float currentFalloff;

          // Interpolación suave y exacta entre los 4 anillos definidos en el Panel UI
          // Ring 0: Center to Start
          if (distXZ <= radiusStart) {
              float t = clamp((distXZ - radiusInner) / max(0.001, radiusStart - radiusInner), 0.0, 1.0);
              currentColor = colorStart; // El color base se mantiene constante hasta el anillo Start
              currentAlpha = mix(0.0, alphaStart, t); // Se desvanece hacia 0 en el centro exacto del jugador
              currentHeight = heightMaxStart;
              currentFalloff = falloffYStart;
          } 
          // Ring 1: Start to Medio 1
          else if (distXZ <= radiusMedio1) {
              float t = clamp((distXZ - radiusStart) / max(0.001, radiusMedio1 - radiusStart), 0.0, 1.0);
              currentColor = mix(colorStart, colorMedio1, t);
              currentAlpha = mix(alphaStart, alphaMedio1, t);
              currentHeight = mix(heightMaxStart, heightMaxMedio1, t);
              currentFalloff = mix(falloffYStart, falloffYMedio1, t);
          } 
          // Ring 2: Medio 1 to Medio 2
          else if (distXZ <= radiusMedio2) {
              float t = clamp((distXZ - radiusMedio1) / max(0.001, radiusMedio2 - radiusMedio1), 0.0, 1.0);
              currentColor = mix(colorMedio1, colorMedio2, t);
              currentAlpha = mix(alphaMedio1, alphaMedio2, t);
              currentHeight = mix(heightMaxMedio1, heightMaxMedio2, t);
              currentFalloff = mix(falloffYMedio1, falloffYMedio2, t);
          } 
          // Ring 3: Medio 2 to End
          else {
              float t = clamp((distXZ - radiusMedio2) / max(0.001, radiusEnd - radiusMedio2), 0.0, 1.0);
              currentColor = mix(colorMedio2, colorEnd, t);
              currentAlpha = mix(alphaMedio2, alphaEnd, t);
              currentHeight = mix(heightMaxMedio2, heightMaxEnd, t);
              currentFalloff = mix(falloffYMedio2, falloffYEnd, t);
          }

          float yDist = vPositionW.y - playerPos.y;
          float yFactor = 1.0;
          
          if (yDist > (currentHeight - currentFalloff)) {
             yFactor = clamp(1.0 - ((yDist - (currentHeight - currentFalloff)) / max(0.001, currentFalloff)), 0.0, 1.0);
          }
          if (yDist < 0.0) {
             yFactor = 1.0; 
          }

          float finalAlpha = currentAlpha * yFactor;

          float edgeSoftness = 0.05;
          // Suavizado en bordes para no "manchar" el cielo ni crear líneas duras en el piso
          if(vUV.y > (1.0 - edgeSoftness)) finalAlpha *= (1.0 - vUV.y) / edgeSoftness;
          if(vUV.y < edgeSoftness) finalAlpha *= vUV.y / edgeSoftness;

          if (finalAlpha <= 0.01) discard;

          gl_FragColor = vec4(currentColor, finalAlpha);
      }
    `;
  }

  public limpiarEstado(): void {
    if (this.fogObserver && this.motor3d.scene) {
      this.motor3d.scene.onBeforeRenderObservable.remove(this.fogObserver);
    }
    this.fogObserver = null;
    
    // 🔥 DESTRUIMOS LOS 4 CILINDROS AL SALIR
    if (this.fogDonuts) {
      this.fogDonuts.forEach(d => { if(d) d.dispose(); });
      this.fogDonuts = [];
    }
    
    this.firstFrame = true;
  }

  // 🔥 ACTUALIZACIÓN DE MALLA (Requiere la altura máxima para mapear bien las UV Y)
  private updateDonutMesh(mesh: Mesh, innerRadius: number, outerRadius: number, innerHeight: number, outerHeight: number, maxHeight: number, tessellation: number = 48) {
      if (innerRadius < 0) innerRadius = 0.1;
      if (outerRadius <= innerRadius) outerRadius = innerRadius + 0.1;
      if (maxHeight <= 0) maxHeight = 0.1;

      const m = mesh as any;

      // FIX DE RENDIMIENTO BRUTAL: Evita redibujar la malla si no ha cambiado de tamaño
      if (Math.abs((m._lastInner || -1) - innerRadius) < 0.01 && 
          Math.abs((m._lastOuter || -1) - outerRadius) < 0.01 && 
          Math.abs((m._lastHStart || -1) - innerHeight) < 0.01 && 
          Math.abs((m._lastHEnd || -1) - outerHeight) < 0.01 &&
          Math.abs((m._lastMaxH || -1) - maxHeight) < 0.01) {
          return;
      }

      m._lastInner = innerRadius;
      m._lastOuter = outerRadius;
      m._lastHStart = innerHeight;
      m._lastHEnd = outerHeight;
      m._lastMaxH = maxHeight;
      
      const positions = [];
      const indices = [];
      const uvs = [];
      
      for (let i = 0; i <= tessellation; i++) {
          const angle = (i / tessellation) * Math.PI * 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          
          positions.push(innerRadius * cos, 0, innerRadius * sin); uvs.push(i / tessellation, 0);
          positions.push(outerRadius * cos, 0, outerRadius * sin); uvs.push(i / tessellation, 0);
          // Las UVs Y se calculan en base a la altura global para que el difuminado no se repita en cada anillo
          positions.push(outerRadius * cos, outerHeight, outerRadius * sin); uvs.push(i / tessellation, outerHeight / maxHeight);
          positions.push(innerRadius * cos, innerHeight, innerRadius * sin); uvs.push(i / tessellation, innerHeight / maxHeight);
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
      this.curRStart = clearColor3.r; this.curGStart = clearColor3.g; this.curBStart = clearColor3.b;
      this.curRMedio1 = clearColor3.r; this.curGMedio1 = clearColor3.g; this.curBMedio1 = clearColor3.b;
      this.curRMedio2 = clearColor3.r; this.curGMedio2 = clearColor3.g; this.curBMedio2 = clearColor3.b;
      this.curREnd = clearColor3.r; this.curGEnd = clearColor3.g; this.curBEnd = clearColor3.b;
      
      this.curStart = scene.fogStart || 500000;
      this.curEnd = scene.fogEnd || 500000;
      this.curDensity = scene.fogDensity || 0.01;
      
      this.curInner = 0.1;
      this.curMedio1 = 1.0;
      this.curMedio2 = 2.0;
      this.curOuter = 3.0;

      this.curHeightStart = 4.0;
      this.curHeightMedio1 = 6.0;
      this.curHeightMedio2 = 8.0;
      this.curHeightEnd = 10.0;
      
      this.curAlphaStart = 0;
      this.curAlphaMedio1 = 0;
      this.curAlphaMedio2 = 0;
      this.curAlphaEnd = 0;

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

    let targetStart = 500000, targetMedio1 = 500000, targetMedio2 = 500000, targetEnd = 500000;
    
    let targetRStart = 0, targetGStart = 0, targetBStart = 0;
    let targetRMedio1 = 0, targetGMedio1 = 0, targetBMedio1 = 0;
    let targetRMedio2 = 0, targetGMedio2 = 0, targetBMedio2 = 0;
    let targetREnd = 0, targetGEnd = 0, targetBEnd = 0;
    
    let useFog = false;
    let targetMode = 'linear';
    let targetDensity = 0.01;
    
    let activeDensityStart = 0, activeDensityMedio1 = 30, activeDensityMedio2 = 60, activeDensityEnd = 100;
    let activeStart = 0, activeMedio1 = 15000, activeMedio2 = 30000, activeEnd = 50000;

    let targetFogHeightStart = 4.0, targetFogHeightMedio1 = 6.0, targetFogHeightMedio2 = 8.0, targetFogHeightEnd = 10.0;
    let targetFogFalloffStart = 1.5, targetFogFalloffMedio1 = 2.0, targetFogFalloffMedio2 = 2.5, targetFogFalloffEnd = 3.0;
    
    let targetFogShape = 'sphere';

    const isSelectedInEditor = (modo === 'EDITOR' || modo === 'EDITING_IN_GAME') && this.state.objetoSeleccionado() === targetPlayer;

    if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled && (modo === 'PLAYING' || modo === 'TRANSITIONING' || isSelectedInEditor)) {
        useFog = true;
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        targetMode = fog.fogMode || 'linear';
        targetFogShape = fog.fogShape || 'cylinder';

        let rawStart: any = 0, rawMedio1: any = 15000, rawMedio2: any = 30000, rawEnd: any = 50000;
        let rawRender: any = 100000, rawDensStart: any = 0, rawDensMedio1: any = 30, rawDensMedio2: any = 60, rawDensEnd: any = 100;

        if (isBW) {
          const cStartObj = Color3.FromHexString(fog.colorStartBW || fog.colorBW || '#555555');
          const cMed1Obj = Color3.FromHexString(fog.colorMedio1BW || fog.colorBW || '#555555');
          const cMed2Obj = Color3.FromHexString(fog.colorMedio2BW || fog.colorBW || '#555555');
          const cEndObj = Color3.FromHexString(fog.colorEndBW || fog.colorBW || '#555555');
          
          targetRStart = cStartObj.r; targetGStart = cStartObj.g; targetBStart = cStartObj.b;
          targetRMedio1 = cMed1Obj.r; targetGMedio1 = cMed1Obj.g; targetBMedio1 = cMed1Obj.b;
          targetRMedio2 = cMed2Obj.r; targetGMedio2 = cMed2Obj.g; targetBMedio2 = cMed2Obj.b;
          targetREnd = cEndObj.r; targetGEnd = cEndObj.g; targetBEnd = cEndObj.b;

          rawStart = isFPS ? fog.startFpsBW : fog.startTpsBW;
          rawMedio1 = isFPS ? fog.medio1FpsBW : fog.medio1TpsBW;
          rawMedio2 = isFPS ? fog.medio2FpsBW : fog.medio2TpsBW;
          rawEnd = isFPS ? fog.endFpsBW : fog.endTpsBW;
          
          rawRender = isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW;
          
          rawDensStart = isFPS ? fog.densityStartFpsBW : fog.densityStartTpsBW;
          rawDensMedio1 = isFPS ? fog.densityMedio1FpsBW : fog.densityMedio1TpsBW;
          rawDensMedio2 = isFPS ? fog.densityMedio2FpsBW : fog.densityMedio2TpsBW;
          rawDensEnd = isFPS ? fog.densityEndFpsBW : fog.densityEndTpsBW;
          
          targetFogHeightStart = Math.max(0.1, isFPS ? (fog.fogHeightYStartFpsBW ?? 4.0) : (fog.fogHeightYStartTpsBW ?? 4.0));
          targetFogHeightMedio1 = Math.max(0.1, isFPS ? (fog.fogHeightYMedio1FpsBW ?? 6.0) : (fog.fogHeightYMedio1TpsBW ?? 6.0));
          targetFogHeightMedio2 = Math.max(0.1, isFPS ? (fog.fogHeightYMedio2FpsBW ?? 8.0) : (fog.fogHeightYMedio2TpsBW ?? 8.0));
          targetFogHeightEnd = Math.max(0.1, isFPS ? (fog.fogHeightYEndFpsBW ?? targetFogHeightStart) : (fog.fogHeightYEndTpsBW ?? targetFogHeightStart));
          
          targetFogFalloffStart = Math.max(0.1, isFPS ? (fog.fogFalloffYStartFpsBW ?? 1.5) : (fog.fogFalloffYStartTpsBW ?? 1.5));
          targetFogFalloffMedio1 = Math.max(0.1, isFPS ? (fog.fogFalloffYMedio1FpsBW ?? 2.0) : (fog.fogFalloffYMedio1TpsBW ?? 2.0));
          targetFogFalloffMedio2 = Math.max(0.1, isFPS ? (fog.fogFalloffYMedio2FpsBW ?? 2.5) : (fog.fogFalloffYMedio2TpsBW ?? 2.5));
          targetFogFalloffEnd = Math.max(0.1, isFPS ? (fog.fogFalloffYEndFpsBW ?? targetFogFalloffStart) : (fog.fogFalloffYEndTpsBW ?? targetFogFalloffStart));
        } else {
          const cStartObj = Color3.FromHexString(fog.colorStart || fog.color || '#0d1729');
          const cMed1Obj = Color3.FromHexString(fog.colorMedio1 || fog.color || '#0d1729');
          const cMed2Obj = Color3.FromHexString(fog.colorMedio2 || fog.color || '#0d1729');
          const cEndObj = Color3.FromHexString(fog.colorEnd || fog.color || '#0d1729');
          
          targetRStart = cStartObj.r; targetGStart = cStartObj.g; targetBStart = cStartObj.b;
          targetRMedio1 = cMed1Obj.r; targetGMedio1 = cMed1Obj.g; targetBMedio1 = cMed1Obj.b;
          targetRMedio2 = cMed2Obj.r; targetGMedio2 = cMed2Obj.g; targetBMedio2 = cMed2Obj.b;
          targetREnd = cEndObj.r; targetGEnd = cEndObj.g; targetBEnd = cEndObj.b;

          rawStart = isFPS ? fog.startFPS : fog.startTPS;
          rawMedio1 = isFPS ? fog.medio1FPS : fog.medio1TPS;
          rawMedio2 = isFPS ? fog.medio2FPS : fog.medio2TPS;
          rawEnd = isFPS ? fog.endFPS : fog.endTPS;
          
          rawRender = isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS;
          
          rawDensStart = isFPS ? fog.densityStartFPS : fog.densityStartTPS;
          rawDensMedio1 = isFPS ? fog.densityMedio1FPS : fog.densityMedio1TPS;
          rawDensMedio2 = isFPS ? fog.densityMedio2FPS : fog.densityMedio2TPS;
          rawDensEnd = isFPS ? fog.densityEndFPS : fog.densityEndTPS;
          
          targetFogHeightStart = Math.max(0.1, isFPS ? (fog.fogHeightYStartFPS ?? 4.0) : (fog.fogHeightYStartTPS ?? 4.0));
          targetFogHeightMedio1 = Math.max(0.1, isFPS ? (fog.fogHeightYMedio1FPS ?? 6.0) : (fog.fogHeightYMedio1TPS ?? 6.0));
          targetFogHeightMedio2 = Math.max(0.1, isFPS ? (fog.fogHeightYMedio2FPS ?? 8.0) : (fog.fogHeightYMedio2TPS ?? 8.0));
          targetFogHeightEnd = Math.max(0.1, isFPS ? (fog.fogHeightYEndFPS ?? targetFogHeightStart) : (fog.fogHeightYEndTPS ?? targetFogHeightStart));
          
          targetFogFalloffStart = Math.max(0.1, isFPS ? (fog.fogFalloffYStartFPS ?? 1.5) : (fog.fogFalloffYStartTPS ?? 1.5));
          targetFogFalloffMedio1 = Math.max(0.1, isFPS ? (fog.fogFalloffYMedio1FPS ?? 2.0) : (fog.fogFalloffYMedio1TPS ?? 2.0));
          targetFogFalloffMedio2 = Math.max(0.1, isFPS ? (fog.fogFalloffYMedio2FPS ?? 2.5) : (fog.fogFalloffYMedio2TPS ?? 2.5));
          targetFogFalloffEnd = Math.max(0.1, isFPS ? (fog.fogFalloffYEndFPS ?? targetFogFalloffStart) : (fog.fogFalloffYEndTPS ?? targetFogFalloffStart));
        }
        
        if (targetMode !== 'linear') {
           targetDensity = Number.isFinite(Number(fog.density)) ? Number(fog.density) : 0.01;
        }

        // Clampeo en cascada para evitar anillos invertidos (Start < Medio 1 < Medio 2 < Fin)
        activeStart = Number.isFinite(Number(rawStart)) ? Math.max(0, Number(rawStart)) : 0;
        activeMedio1 = (Number.isFinite(Number(rawMedio1)) && Number(rawMedio1) > activeStart) ? Number(rawMedio1) : activeStart + 15;
        activeMedio2 = (Number.isFinite(Number(rawMedio2)) && Number(rawMedio2) > activeMedio1) ? Number(rawMedio2) : activeMedio1 + 15;
        activeEnd = (Number.isFinite(Number(rawEnd)) && Number(rawEnd) > activeMedio2) ? Number(rawEnd) : activeMedio2 + 20;
        
        const activeRenderDistance = (Number.isFinite(Number(rawRender)) && Number(rawRender) > activeEnd) ? Number(rawRender) : activeEnd + 500;
        
        activeDensityStart = Number.isFinite(Number(rawDensStart)) ? Math.max(0, Math.min(100, Number(rawDensStart))) : 0;
        activeDensityMedio1 = Number.isFinite(Number(rawDensMedio1)) ? Math.max(0, Math.min(100, Number(rawDensMedio1))) : 30;
        activeDensityMedio2 = Number.isFinite(Number(rawDensMedio2)) ? Math.max(0, Math.min(100, Number(rawDensMedio2))) : 60;
        activeDensityEnd = Number.isFinite(Number(rawDensEnd)) ? Math.max(0, Math.min(100, Number(rawDensEnd))) : 100;

        let distCamToPlayer = 0;
        if (scene.activeCamera) {
          distCamToPlayer = Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition());
          if (modo === 'TRANSITIONING') distCamToPlayer = Math.min(distCamToPlayer, 8); 
        }

        targetStart = activeStart + distCamToPlayer; 
        targetMedio1 = activeMedio1 + distCamToPlayer;
        targetMedio2 = activeMedio2 + distCamToPlayer;
        targetEnd = activeEnd + distCamToPlayer; 
        
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

    // 🔥 DESTRUIMOS LOS 4 CILINDROS SI YA NO SON NECESARIOS O CAMBIA A ESFERA GLOBAL
    if (!useFog || targetFogShape === 'sphere') {
      if (this.fogDonuts && this.fogDonuts.length > 0) {
          this.fogDonuts.forEach(d => { if(d) d.dispose(); });
          this.fogDonuts = [];
          this.curAlphaStart = 0; this.curAlphaMedio1 = 0; this.curAlphaMedio2 = 0; this.curAlphaEnd = 0;
      }
      if (!useFog) {
        const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
        const targetColorObj = Color3.FromHexString(globalClearHex);
        targetREnd = targetColorObj.r; targetGEnd = targetColorObj.g; targetBEnd = targetColorObj.b;
        targetStart = 500000; targetMedio1 = 500000; targetMedio2 = 500000; targetEnd = 500000;
      }
    } 
    // 🔥 LÓGICA DE LOS 4 CILINDROS CONCÉNTRICOS (NUEVO CONTROL 4 ANILLOS)
    else if (targetFogShape === 'cylinder' && useFog) {
      if (!this.fogDonuts || this.fogDonuts.length === 0) {
          this.fogDonuts = [];
          const shaderMat = new ShaderMaterial("silentFogMat", scene, { vertex: "silentFog", fragment: "silentFog" },
            { attributes: ["position", "uv"], 
              uniforms: [
                  "worldViewProjection", "world", 
                  "colorStart", "colorMedio1", "colorMedio2", "colorEnd", 
                  "alphaStart", "alphaMedio1", "alphaMedio2", "alphaEnd", 
                  "heightMaxStart", "heightMaxMedio1", "heightMaxMedio2", "heightMaxEnd", 
                  "falloffYStart", "falloffYMedio1", "falloffYMedio2", "falloffYEnd", 
                  "radiusInner", "radiusStart", "radiusMedio1", "radiusMedio2", "radiusEnd", 
                  "playerPos"
              ], 
              needAlphaBlending: true }
          );
          shaderMat.backFaceCulling = false; 
          shaderMat.alphaMode = Engine.ALPHA_COMBINE; 
          shaderMat.zOffset = -5; 
          
          // CREAMOS LOS 4 CILINDROS
          for(let i=0; i<4; i++) {
              const donut = new Mesh('silentFogDonut_' + i, scene);
              donut.material = shaderMat;
              donut.isPickable = false; 
              donut.receiveShadows = false; 
              donut.applyFog = false; 
              this.fogDonuts.push(donut);
          }
          this.curAlphaStart = 0; this.curAlphaMedio1 = 0; this.curAlphaMedio2 = 0; this.curAlphaEnd = 0;
      }

      if (this.fogDonuts.length === 4 && targetPlayer) {
          const fog = targetPlayer.metadata.playerConfig.fog;
          const lerpCyl = lerpSpeed * 1.5;
          
          const targetInnerRadius = Math.max(0.1, activeStart);
          const targetMedio1Radius = Math.max(targetInnerRadius + 0.1, activeMedio1);
          const targetMedio2Radius = Math.max(targetMedio1Radius + 0.1, activeMedio2);
          const targetOuterRadius = Math.max(targetMedio2Radius + 0.1, activeEnd);

          if (this.firstFrame) {
            this.curInner = targetInnerRadius;
            this.curMedio1 = targetMedio1Radius;
            this.curMedio2 = targetMedio2Radius;
            this.curOuter = targetOuterRadius;
            
            this.curHeightStart = targetFogHeightStart;
            this.curHeightMedio1 = targetFogHeightMedio1;
            this.curHeightMedio2 = targetFogHeightMedio2;
            this.curHeightEnd = targetFogHeightEnd;
          } else {
            this.curInner += (targetInnerRadius - this.curInner) * lerpCyl;
            this.curMedio1 += (targetMedio1Radius - this.curMedio1) * lerpCyl;
            this.curMedio2 += (targetMedio2Radius - this.curMedio2) * lerpCyl;
            this.curOuter += (targetOuterRadius - this.curOuter) * lerpCyl;
            
            this.curHeightStart += (targetFogHeightStart - this.curHeightStart) * lerpCyl;
            this.curHeightMedio1 += (targetFogHeightMedio1 - this.curHeightMedio1) * lerpCyl;
            this.curHeightMedio2 += (targetFogHeightMedio2 - this.curHeightMedio2) * lerpCyl;
            this.curHeightEnd += (targetFogHeightEnd - this.curHeightEnd) * lerpCyl;
          }

          // 🔥 CÁLCULO DE LAS BARRERAS FÍSICAS DE LOS 4 CILINDROS (Inner->Start, Start->Medio1, Medio1->Medio2, Medio2->End)
          const r0 = 0.1; // Central hole boundary
          const r1 = this.curInner;
          const r2 = this.curMedio1;
          const r3 = this.curMedio2;
          const r4 = this.curOuter;

          // Alturas escalonadas para el efecto domo
          const h0 = this.curHeightStart; // Hole height
          const h1 = this.curHeightStart; 
          const h2 = this.curHeightMedio1;
          const h3 = this.curHeightMedio2;
          const h4 = this.curHeightEnd;

          // Enviar la altura global al renderizador de vértices para que el Alpha UV no se resetee en cada cilindro
          const maxHeight = Math.max(this.curHeightStart, this.curHeightMedio1, this.curHeightMedio2, this.curHeightEnd);

          // Generar geometrías dejándoles huecos minúsculos (-0.05 / +0.05) para NO causar Z-Fighting
          this.updateDonutMesh(this.fogDonuts[0], r0, r1 - 0.05, h0, h1, maxHeight, 48);
          this.updateDonutMesh(this.fogDonuts[1], r1 + 0.05, r2 - 0.05, h1, h2, maxHeight, 48);
          this.updateDonutMesh(this.fogDonuts[2], r2 + 0.05, r3 - 0.05, h2, h3, maxHeight, 48);
          this.updateDonutMesh(this.fogDonuts[3], r3 + 0.05, r4, h3, h4, maxHeight, 48);
          
          const fogOffsetX = isFPS ? (Number.isFinite(Number(fog.offsetXFPS)) ? Number(fog.offsetXFPS) : 0) : (Number.isFinite(Number(fog.offsetXTPS)) ? Number(fog.offsetXTPS) : 0);
          const fogOffsetY = isFPS ? (Number.isFinite(Number(fog.offsetYFPS)) ? Number(fog.offsetYFPS) : 0) : (Number.isFinite(Number(fog.offsetYTPS)) ? Number(fog.offsetYTPS) : 0);
          const fogOffsetZ = isFPS ? (Number.isFinite(Number(fog.offsetZFPS)) ? Number(fog.offsetZFPS) : 0) : (Number.isFinite(Number(fog.offsetZTPS)) ? Number(fog.offsetZTPS) : 0);

          const pPos = targetPlayer.getAbsolutePosition();
          
          // Posición base sin temblores (ya que pPos es World Exacto)
          const targetFogPosX = pPos.x + fogOffsetX;
          const targetFogPosY = pPos.y + fogOffsetY;
          const targetFogPosZ = pPos.z + fogOffsetZ;

          // Mover las 4 mallas a su posición
          this.fogDonuts.forEach(d => d.position.set(targetFogPosX, targetFogPosY, targetFogPosZ));
          
          const mat = this.fogDonuts[0].material as ShaderMaterial;
          const tAlphaStart = activeDensityStart / 100;
          const tAlphaMedio1 = activeDensityMedio1 / 100;
          const tAlphaMedio2 = activeDensityMedio2 / 100;
          const tAlphaEnd = activeDensityEnd / 100;

          if (this.firstFrame) {
             this.curAlphaStart = tAlphaStart;
             this.curAlphaMedio1 = tAlphaMedio1;
             this.curAlphaMedio2 = tAlphaMedio2;
             this.curAlphaEnd = tAlphaEnd;
          } else {
             this.curAlphaStart += (tAlphaStart - this.curAlphaStart) * lerpCyl;
             this.curAlphaMedio1 += (tAlphaMedio1 - this.curAlphaMedio1) * lerpCyl;
             this.curAlphaMedio2 += (tAlphaMedio2 - this.curAlphaMedio2) * lerpCyl;
             this.curAlphaEnd += (tAlphaEnd - this.curAlphaEnd) * lerpCyl;
          }

          mat.setColor3("colorStart", new Color3(this.curRStart, this.curGStart, this.curBStart));
          mat.setColor3("colorMedio1", new Color3(this.curRMedio1, this.curGMedio1, this.curBMedio1));
          mat.setColor3("colorMedio2", new Color3(this.curRMedio2, this.curGMedio2, this.curBMedio2));
          mat.setColor3("colorEnd", new Color3(this.curREnd, this.curGEnd, this.curBEnd));
          
          mat.setFloat("alphaStart", this.curAlphaStart);
          mat.setFloat("alphaMedio1", this.curAlphaMedio1);
          mat.setFloat("alphaMedio2", this.curAlphaMedio2);
          mat.setFloat("alphaEnd", this.curAlphaEnd);
          
          mat.setFloat("heightMaxStart", this.curHeightStart);
          mat.setFloat("heightMaxMedio1", this.curHeightMedio1);
          mat.setFloat("heightMaxMedio2", this.curHeightMedio2);
          mat.setFloat("heightMaxEnd", this.curHeightEnd);
          
          mat.setFloat("falloffYStart", targetFogFalloffStart);
          mat.setFloat("falloffYMedio1", targetFogFalloffMedio1);
          mat.setFloat("falloffYMedio2", targetFogFalloffMedio2);
          mat.setFloat("falloffYEnd", targetFogFalloffEnd);
          
          // 🔥 VITAL: Pasamos los límites EXPLÍCITOS al shader para que la opacidad fluya limpiamente cruzando los anillos
          mat.setFloat("radiusInner", 0.1);
          mat.setFloat("radiusStart", this.curInner);
          mat.setFloat("radiusMedio1", this.curMedio1);
          mat.setFloat("radiusMedio2", this.curMedio2);
          mat.setFloat("radiusEnd", this.curOuter);
          
          mat.setVector3("playerPos", this.fogDonuts[0].position);
      }
    }
    
    if (this.firstFrame) {
      this.curStart = targetStart; this.curMedio1 = targetMedio1; this.curMedio2 = targetMedio2; this.curEnd = targetEnd; 
      
      this.curRStart = targetRStart; this.curGStart = targetGStart; this.curBStart = targetBStart;
      this.curRMedio1 = targetRMedio1; this.curGMedio1 = targetGMedio1; this.curBMedio1 = targetBMedio1;
      this.curRMedio2 = targetRMedio2; this.curGMedio2 = targetGMedio2; this.curBMedio2 = targetBMedio2;
      this.curREnd = targetREnd; this.curGEnd = targetGEnd; this.curBEnd = targetBEnd;
      
      this.curDensity = targetDensity;
      this.firstFrame = false;
    } else {
      this.curStart += (targetStart - this.curStart) * lerpSpeed;
      this.curMedio1 += (targetMedio1 - this.curMedio1) * lerpSpeed;
      this.curMedio2 += (targetMedio2 - this.curMedio2) * lerpSpeed;
      this.curEnd += (targetEnd - this.curEnd) * lerpSpeed;
      
      this.curRStart += (targetRStart - this.curRStart) * lerpSpeed;
      this.curGStart += (targetGStart - this.curGStart) * lerpSpeed;
      this.curBStart += (targetBStart - this.curBStart) * lerpSpeed;
      
      this.curRMedio1 += (targetRMedio1 - this.curRMedio1) * lerpSpeed;
      this.curGMedio1 += (targetGMedio1 - this.curGMedio1) * lerpSpeed;
      this.curBMedio1 += (targetBMedio1 - this.curBMedio1) * lerpSpeed;
      
      this.curRMedio2 += (targetRMedio2 - this.curRMedio2) * lerpSpeed;
      this.curGMedio2 += (targetGMedio2 - this.curGMedio2) * lerpSpeed;
      this.curBMedio2 += (targetBMedio2 - this.curBMedio2) * lerpSpeed;
      
      this.curREnd += (targetREnd - this.curREnd) * lerpSpeed;
      this.curGEnd += (targetGEnd - this.curGEnd) * lerpSpeed;
      this.curBEnd += (targetBEnd - this.curBEnd) * lerpSpeed;
      
      this.curDensity += (targetDensity - this.curDensity) * lerpSpeed;
    }

    // APLICAR NIEBLA GLOBAL
    if (useFog && (modo === 'PLAYING' || modo === 'TRANSITIONING')) {
      let applyStart = this.curStart;
      let applyEnd = this.curEnd;
      let applyDensity = this.curDensity;

      if (targetFogShape === 'cylinder') {
          // Si usamos cilindros, la niebla global se empuja un poco más atrás
          // para no teñir la punta de los rascacielos/edificios a corta distancia.
          const range = Math.max(10, this.curEnd - this.curStart);
          applyStart = this.curStart + range * 0.8; 
          applyEnd = this.curEnd + range * 2.0;     
          applyDensity = this.curDensity * 0.35;    
      }

      if (targetMode === 'exp2') scene.fogMode = Scene.FOGMODE_EXP2;
      else if (targetMode === 'exp') scene.fogMode = Scene.FOGMODE_EXP;
      else scene.fogMode = Scene.FOGMODE_LINEAR;
      
      scene.fogStart = applyStart; 
      scene.fogEnd = applyEnd;
      if (targetMode !== 'linear') scene.fogDensity = applyDensity;
      
      scene.fogColor = new Color3(this.curREnd, this.curGEnd, this.curBEnd);
    } else {
      scene.fogMode = Scene.FOGMODE_NONE; 
    }

    // LÍMITES DE SOMBRA
    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        sg.shadowMaxZ += (shadowLimit - sg.shadowMaxZ) * lerpSpeed;
      }
    });
  }
}