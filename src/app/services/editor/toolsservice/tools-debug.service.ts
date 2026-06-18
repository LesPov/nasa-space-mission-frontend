
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Light, Mesh, MeshBuilder, StandardMaterial, Vector3, Matrix } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { ToolsSelectionService } from './tools-selection.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class ToolsDebugService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private selectionSvc = inject(ToolsSelectionService);
  private entityManager = inject(EntityManagerService);

  public debugCollider: Mesh | null = null;
  public debugCameraBox: Mesh | null = null;
  public debugLightBox: Mesh | null = null; 
  public debugFogStartSphere: Mesh | null = null;
  public debugFogEndSphere: Mesh | null = null;

  public getFogBaseLocalPos(selected: AbstractMesh): Vector3 {
    const entity = this.entityManager.getEntityByMesh(selected);
    const camOffset = entity?.camOffset;
    if (entity && (entity.rol === 'npc' || entity.rol === 'spawn_point') && camOffset) {
      return new Vector3(
        this.selectionSvc.normalizarNumero(camOffset.x, 0),
        this.selectionSvc.normalizarNumero(camOffset.y, 1.6),
        this.selectionSvc.normalizarNumero(camOffset.z, 0)
      );
    }
    if (entity?.initialHeadLocal) {
      return new Vector3(
        this.selectionSvc.normalizarNumero(entity.initialHeadLocal.x, 0),
        this.selectionSvc.normalizarNumero(entity.initialHeadLocal.y, 1.6),
        this.selectionSvc.normalizarNumero(entity.initialHeadLocal.z, 0)
      );
    }
    const collider = entity?.collider;
    if (collider) {
      const offsetY = this.selectionSvc.normalizarNumero(collider.offsetY, 0);
      const sizeY = this.selectionSvc.normalizarNumero(collider.sizeY, 1);
      return new Vector3(
        this.selectionSvc.normalizarNumero(collider.offsetX, 0),
        offsetY + Math.max(sizeY, 0.8),
        this.selectionSvc.normalizarNumero(collider.offsetZ, 0)
      );
    }
    return new Vector3(0, 1.6, 0);
  }

  public getFogDebugAnchor(selected: AbstractMesh): Vector3 {
    const pPos = selected.getAbsolutePosition().clone();
    const entity = this.entityManager.getEntityByMesh(selected);
    const fogConfig = entity?.playerConfig?.fog;
    if (fogConfig) {
       const isFPS = this.state.modoVistaPrueba === 'FPS';
       pPos.x += this.selectionSvc.normalizarNumero(isFPS ? fogConfig.offsetXFPS : fogConfig.offsetXTPS, 0);
       pPos.y += this.selectionSvc.normalizarNumero(isFPS ? fogConfig.offsetYFPS : fogConfig.offsetYTPS, 0);
       pPos.z += this.selectionSvc.normalizarNumero(isFPS ? fogConfig.offsetZFPS : fogConfig.offsetZTPS, 0);
    }
    return pPos;
  }

  public actualizarDebugMeshes(selected: Mesh | null): void {
    const playState = this.state.playState();
    if (!selected || (playState !== 'EDITOR' && playState !== 'EDITING_IN_GAME')) {
      if (this.debugCollider) { this.debugCollider.dispose(); this.debugCollider = null; }
      if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
      if (this.debugLightBox) { this.debugLightBox.dispose(); this.debugLightBox = null; }
      if (this.debugFogStartSphere) { this.debugFogStartSphere.dispose(); this.debugFogStartSphere = null; }
      if (this.debugFogEndSphere) { this.debugFogEndSphere.dispose(); this.debugFogEndSphere = null; }
      return;
    }

    const scene = this.motor3d.scene;
    const entity = this.entityManager.getEntityByMesh(selected);
    if (!entity) return;

    const colMeta = entity.collider;

    if (colMeta && colMeta.type !== 'mesh') {
      if (this.debugCollider) this.debugCollider.dispose();
      if (colMeta.type === 'capsule') this.debugCollider = MeshBuilder.CreateCapsule('debugCollider', { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
      else if (colMeta.type === 'sphere') this.debugCollider = MeshBuilder.CreateSphere('debugCollider', { diameterX: colMeta.sizeX * 2, diameterY: colMeta.sizeY * 2, diameterZ: colMeta.sizeZ * 2 }, scene);
      else this.debugCollider = MeshBuilder.CreateBox('debugCollider', { width: colMeta.sizeX * 2, height: colMeta.sizeY * 2, depth: colMeta.sizeZ * 2 }, scene);

      this.debugCollider.position = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
      this.debugCollider.parent = selected;

      const matCol = new StandardMaterial('debugColMat', scene);
      matCol.wireframe = true;
      matCol.emissiveColor = colMeta.type === 'capsule' ? new Color3(0.2, 0.8, 0.2) : new Color3(0.8, 0.8, 0.2);
      matCol.disableLighting = true;
      this.debugCollider.material = matCol;
      this.debugCollider.isPickable = false;
    } else {
      if (this.debugCollider) { this.debugCollider.dispose(); this.debugCollider = null; }
    }

    const camOffset = entity.camOffset;
    if (camOffset && (entity.rol === 'npc' || entity.rol === 'spawn_point')) {
      if (this.debugCameraBox) this.debugCameraBox.dispose();
      this.debugCameraBox = MeshBuilder.CreateBox('debugCamBox', { size: 0.25 }, scene);
      this.debugCameraBox.position = new Vector3(camOffset.x, camOffset.y, camOffset.z);
      this.debugCameraBox.parent = selected;
      const matCam = new StandardMaterial('debugCamMat', scene);
      matCam.wireframe = true;
      matCam.emissiveColor = new Color3(0.9, 0.2, 0.2);
      matCam.disableLighting = true;
      this.debugCameraBox.material = matCam;
      this.debugCameraBox.isPickable = false;
    } else {
      if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
    }

    if (entity.type?.startsWith('light_')) {
        if (this.debugLightBox) this.debugLightBox.dispose();
        this.debugLightBox = MeshBuilder.CreateSphere('debugLightBox', { diameter: 0.3 }, scene);
        
        const lightObj = selected.getDescendants(false).find(c => c.name.startsWith('l_')) as Light;
        if (lightObj && lightObj.parent) {
            this.debugLightBox.parent = lightObj.parent;
        } else {
            this.debugLightBox.parent = selected;
        }
        
        this.debugLightBox.position = new Vector3(
          entity.light?.lightPosX ?? 0, 
          entity.light?.lightPosY ?? 0, 
          entity.light?.lightPosZ ?? 0
        );
        
        const matLight = new StandardMaterial('debugLightMat', scene);
        matLight.wireframe = true;
        matLight.emissiveColor = new Color3(1, 1, 0); 
        matLight.disableLighting = true;
        this.debugLightBox.material = matLight;
        this.debugLightBox.isPickable = false;
    } else {
        if (this.debugLightBox) { this.debugLightBox.dispose(); this.debugLightBox = null; }
    }

    if (this.debugFogStartSphere) { this.debugFogStartSphere.dispose(); this.debugFogStartSphere = null; }
    if (this.debugFogEndSphere) { this.debugFogEndSphere.dispose(); this.debugFogEndSphere = null; }

    const playerConfig = entity.playerConfig;
    if (playerConfig && playerConfig.fog && playerConfig.fog.enabled && (entity.rol === 'npc' || entity.rol === 'spawn_point')) {
      
      const isBW = scene.metadata?.globalVisualMode === 'bw';
      const isFPS = this.state.modoVistaPrueba === 'FPS';
      const fog = playerConfig.fog;
      
      let activeStart = isBW ? (isFPS ? (fog.startFpsBW ?? 0) : (fog.startTpsBW ?? 5)) : (isFPS ? (fog.startFPS ?? 0) : (fog.startTPS ?? 5));
      let rawEnd = isBW ? (isFPS ? (fog.endFpsBW ?? 60) : (fog.endTpsBW ?? 90)) : (isFPS ? (fog.endFPS ?? 80) : (fog.endTPS ?? 120));
      let activeEnd = Math.max(activeStart + 0.1, rawEnd);

      const fogAnchor = this.getFogDebugAnchor(selected);
      const fogShape = fog.fogShape || 'cylinder';
      
      const hStartFpsBW = fog?.fogHeightYStartFpsBW ?? 4.0;
      const hStartTpsBW = fog?.fogHeightYStartTpsBW ?? 4.0;
      const hStartFPS = fog?.fogHeightYStartFPS ?? 4.0;
      const hStartTPS = fog?.fogHeightYStartTPS ?? 4.0;
      const fogHeightStart = Math.max(0.1, isBW ? (isFPS ? hStartFpsBW : hStartTpsBW) : (isFPS ? hStartFPS : hStartTPS));

      const hEndFpsBW = fog?.fogHeightYEndFpsBW ?? 10.0;
      const hEndTpsBW = fog?.fogHeightYEndTpsBW ?? 10.0;
      const hEndFPS = fog?.fogHeightYEndFPS ?? 10.0;
      const hEndTPS = fog?.fogHeightYEndTPS ?? 10.0;
      const fogHeightEnd = Math.max(0.1, isBW ? (isFPS ? hEndFpsBW : hEndTpsBW) : (isFPS ? hEndFPS : hEndTPS));

      if (fogShape === 'cylinder') {
        this.debugFogStartSphere = MeshBuilder.CreateCylinder('debugFogStartSphere', { diameter: Math.max(0.5, activeStart * 2) + 0.05, height: fogHeightStart, tessellation: 32, cap: Mesh.NO_CAP }, scene);
        this.debugFogStartSphere.position.set(fogAnchor.x, fogAnchor.y + (fogHeightStart / 2), fogAnchor.z);
      } else {
        this.debugFogStartSphere = MeshBuilder.CreateSphere('debugFogStartSphere', { diameter: Math.max(0.5, activeStart * 2) + 0.05, segments: 32 }, scene);
        this.debugFogStartSphere.position = fogAnchor.clone();
      }

      this.debugFogStartSphere.parent = null; 
      const matFogStart = new StandardMaterial('debugFogStartMat', scene);
      matFogStart.wireframe = true;
      matFogStart.emissiveColor = new Color3(0.2, 0.8, 1.0); 
      matFogStart.alpha = 0.3;
      matFogStart.disableLighting = true;
      this.debugFogStartSphere.material = matFogStart;
      this.debugFogStartSphere.isPickable = false;

      if (activeEnd > 0.1) {
        if (fogShape === 'cylinder') {
          this.debugFogEndSphere = MeshBuilder.CreateCylinder('debugFogEndSphere', { diameter: (activeEnd * 2) + 0.1, height: fogHeightEnd, tessellation: 32, cap: Mesh.NO_CAP }, scene);
          this.debugFogEndSphere.position.set(fogAnchor.x, fogAnchor.y + (fogHeightEnd / 2), fogAnchor.z);
        } else {
          this.debugFogEndSphere = MeshBuilder.CreateSphere('debugFogEndSphere', { diameter: (activeEnd * 2) + 0.1, segments: 32 }, scene);
          this.debugFogEndSphere.position = fogAnchor.clone();
        }

        this.debugFogEndSphere.parent = null; 
        const matFogEnd = new StandardMaterial('debugFogEndMat', scene);
        matFogEnd.wireframe = true;
        matFogEnd.emissiveColor = new Color3(1.0, 0.2, 0.2); 
        matFogEnd.alpha = 0.25;
        matFogEnd.disableLighting = true;
        this.debugFogEndSphere.material = matFogEnd;
        this.debugFogEndSphere.isPickable = false;
      }
    }
  }

  public syncBreathAnimations(obj: Mesh): void {
    if (!obj) return;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (!entity) return;

    let breathX = 0, breathY = 0, breathZ = 0;

    if (entity.initialHeadLocal) {
      const headNode = obj.getChildTransformNodes(false).find((n: any) =>
        n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')
      );
      if (headNode) {
        const currentGlobal = headNode.getAbsolutePosition();
        const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(obj.getWorldMatrix()));
        breathX = currentLocal.x - entity.initialHeadLocal.x;
        breathY = currentLocal.y - entity.initialHeadLocal.y;
        breathZ = currentLocal.z - entity.initialHeadLocal.z;
      }
    }

    const colMeta = entity.collider;
    if (colMeta && this.debugCollider) {
      this.debugCollider.position.set(colMeta.offsetX + breathX, colMeta.offsetY + breathY, colMeta.offsetZ + breathZ);
    }

    const camOffset = entity.camOffset;
    if (camOffset && this.debugCameraBox) {
      this.debugCameraBox.position.set(camOffset.x + breathX, camOffset.y + breathY, camOffset.z + breathZ);
    }
    
    if (this.debugLightBox && entity.type?.startsWith('light_') && entity.light) {
       this.debugLightBox.position.set(
          (entity.light.lightPosX ?? 0) + breathX,
          (entity.light.lightPosY ?? 0) + breathY,
          (entity.light.lightPosZ ?? 0) + breathZ
       );
    }

    const fogConfig = entity.playerConfig?.fog;
    const fogShape = fogConfig?.fogShape || 'cylinder';
    const isBW = this.motor3d.scene?.metadata?.globalVisualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';
    
    const hStartFpsBW = fogConfig?.fogHeightYStartFpsBW ?? 4.0;
    const hStartTpsBW = fogConfig?.fogHeightYStartTpsBW ?? 4.0;
    const hStartFPS = fogConfig?.fogHeightYStartFPS ?? 4.0;
    const hStartTPS = fogConfig?.fogHeightYStartTPS ?? 4.0;
    const fogHeightStart = Math.max(0.1, isBW ? (isFPS ? hStartFpsBW : hStartTpsBW) : (isFPS ? hStartFPS : hStartTPS));

    const hEndFpsBW = fogConfig?.fogHeightYEndFpsBW ?? 10.0;
    const hEndTpsBW = fogConfig?.fogHeightYEndTpsBW ?? 10.0;
    const hEndFPS = fogConfig?.fogHeightYEndFPS ?? 10.0;
    const hEndTPS = fogConfig?.fogHeightYEndTPS ?? 10.0;
    const fogHeightEnd = Math.max(0.1, isBW ? (isFPS ? hEndFpsBW : hEndTpsBW) : (isFPS ? hEndFPS : hEndTPS));

    const fogAnchor = this.getFogDebugAnchor(obj);
    
    if (this.debugFogStartSphere) {
      this.debugFogStartSphere.position.set(
        fogAnchor.x, 
        fogAnchor.y + (fogShape === 'cylinder' ? (fogHeightStart / 2) : 0), 
        fogAnchor.z
      );
    }

    if (this.debugFogEndSphere) {
      this.debugFogEndSphere.position.set(
        fogAnchor.x, 
        fogAnchor.y + (fogShape === 'cylinder' ? (fogHeightEnd / 2) : 0), 
        fogAnchor.z
      );
    }
  }
}