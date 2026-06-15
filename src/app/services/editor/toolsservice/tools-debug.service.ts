
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Light, Matrix, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { ToolsSelectionService } from './tools-selection.service';

@Injectable({ providedIn: 'root' })
export class ToolsDebugService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private selectionSvc = inject(ToolsSelectionService);

  public debugCollider: Mesh | null = null;
  public debugCameraBox: Mesh | null = null;
  public debugLightBox: Mesh | null = null; 
  public debugFogStartSphere: Mesh | null = null;
  public debugFogEndSphere: Mesh | null = null;

  public getFogBaseLocalPos(selected: AbstractMesh): Vector3 {
    const meta = selected?.metadata || {};
    const camMeta = meta?.camOffset;
    if ((meta?.rol === 'npc' || meta?.rol === 'spawn_point') && camMeta) {
      return new Vector3(
        this.selectionSvc.normalizarNumero(camMeta.x, 0),
        this.selectionSvc.normalizarNumero(camMeta.y, 1.6),
        this.selectionSvc.normalizarNumero(camMeta.z, 0)
      );
    }
    if (meta?.initialHeadLocal) {
      return new Vector3(
        this.selectionSvc.normalizarNumero(meta.initialHeadLocal.x, 0),
        this.selectionSvc.normalizarNumero(meta.initialHeadLocal.y, 1.6),
        this.selectionSvc.normalizarNumero(meta.initialHeadLocal.z, 0)
      );
    }
    const colMeta = meta?.collider;
    if (colMeta) {
      const offsetY = this.selectionSvc.normalizarNumero(colMeta.offsetY, 0);
      const sizeY = this.selectionSvc.normalizarNumero(colMeta.sizeY, 1);
      return new Vector3(
        this.selectionSvc.normalizarNumero(colMeta.offsetX, 0),
        offsetY + Math.max(sizeY, 0.8),
        this.selectionSvc.normalizarNumero(colMeta.offsetZ, 0)
      );
    }
    return new Vector3(0, 1.6, 0);
  }

  public getFogDebugAnchor(selected: AbstractMesh): Vector3 {
    const basePos = this.getFogBaseLocalPos(selected);
    const fogConfig = selected?.metadata?.playerConfig?.fog;
    if (fogConfig) {
       basePos.x += this.selectionSvc.normalizarNumero(fogConfig.offsetX, 0);
       basePos.y += this.selectionSvc.normalizarNumero(fogConfig.offsetY, 0);
       basePos.z += this.selectionSvc.normalizarNumero(fogConfig.offsetZ, 0);
    }
    return basePos;
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
    const colMeta = selected.metadata?.collider;

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

    const camMeta = selected.metadata?.camOffset;
    if (camMeta && (selected.metadata?.rol === 'npc' || selected.metadata?.rol === 'spawn_point')) {
      if (this.debugCameraBox) this.debugCameraBox.dispose();
      this.debugCameraBox = MeshBuilder.CreateBox('debugCamBox', { size: 0.25 }, scene);
      this.debugCameraBox.position = new Vector3(camMeta.x, camMeta.y, camMeta.z);
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

    if (selected.metadata?.type?.startsWith('light_')) {
        if (this.debugLightBox) this.debugLightBox.dispose();
        this.debugLightBox = MeshBuilder.CreateSphere('debugLightBox', { diameter: 0.3 }, scene);
        
        const lightObj = selected.getDescendants(false).find(c => c.name.startsWith('l_')) as Light;
        if (lightObj && lightObj.parent) {
            this.debugLightBox.parent = lightObj.parent;
        } else {
            this.debugLightBox.parent = selected;
        }
        
        this.debugLightBox.position = new Vector3(
          selected.metadata.lightPosX ?? 0, 
          selected.metadata.lightPosY ?? 0, 
          selected.metadata.lightPosZ ?? 0
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

    const playerConfig = selected.metadata?.playerConfig;
    if (playerConfig && playerConfig.fog && playerConfig.fog.enabled && (selected.metadata?.rol === 'npc' || selected.metadata?.rol === 'spawn_point')) {
      
      const isBW = scene.metadata?.globalVisualMode === 'bw';
      const isFPS = this.state.modoVistaPrueba === 'FPS';
      const fog = playerConfig.fog;
      
      let activeStart = isBW ? (isFPS ? (fog.startFpsBW ?? 0) : (fog.startTpsBW ?? 5)) : (isFPS ? (fog.startFPS ?? 0) : (fog.startTPS ?? 5));
      let activeEnd = isBW ? (isFPS ? (fog.endFpsBW ?? 60) : (fog.endTpsBW ?? 90)) : (isFPS ? (fog.endFPS ?? 80) : (fog.endTPS ?? 120));

      const fogAnchor = this.getFogDebugAnchor(selected);

      // We always create the start sphere because we want the user to be able to drag the Offset, even if activeStart is 0.
      this.debugFogStartSphere = MeshBuilder.CreateSphere('debugFogStartSphere', { diameter: Math.max(0.5, activeStart * 2), segments: 32 }, scene);
      this.debugFogStartSphere.position = fogAnchor.clone();
      this.debugFogStartSphere.parent = selected;
      const matFogStart = new StandardMaterial('debugFogStartMat', scene);
      matFogStart.wireframe = true;
      matFogStart.emissiveColor = new Color3(0.2, 0.8, 1.0); 
      matFogStart.alpha = 0.3;
      matFogStart.disableLighting = true;
      this.debugFogStartSphere.material = matFogStart;
      this.debugFogStartSphere.isPickable = false;

      if (activeEnd > 0.1) {
        this.debugFogEndSphere = MeshBuilder.CreateSphere('debugFogEndSphere', { diameter: activeEnd * 2, segments: 32 }, scene);
        this.debugFogEndSphere.position = fogAnchor.clone();
        this.debugFogEndSphere.parent = selected;
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
    let breathX = 0, breathY = 0, breathZ = 0;

    if (obj.metadata?.initialHeadLocal) {
      const headNode = obj.getChildTransformNodes(false).find((n: any) =>
        n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')
      );
      if (headNode) {
        const currentGlobal = headNode.getAbsolutePosition();
        const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(obj.getWorldMatrix()));
        breathX = currentLocal.x - obj.metadata.initialHeadLocal.x;
        breathY = currentLocal.y - obj.metadata.initialHeadLocal.y;
        breathZ = currentLocal.z - obj.metadata.initialHeadLocal.z;
      }
    }

    const colMeta = obj.metadata?.collider;
    if (colMeta && this.debugCollider) {
      this.debugCollider.position.set(colMeta.offsetX + breathX, colMeta.offsetY + breathY, colMeta.offsetZ + breathZ);
    }

    const camMeta = obj.metadata?.camOffset;
    if (camMeta && this.debugCameraBox) {
      this.debugCameraBox.position.set(camMeta.x + breathX, camMeta.y + breathY, camMeta.z + breathZ);
    }
    
    if (this.debugLightBox && obj.metadata?.type?.startsWith('light_')) {
       this.debugLightBox.position.set(
          (obj.metadata.lightPosX ?? 0) + breathX,
          (obj.metadata.lightPosY ?? 0) + breathY,
          (obj.metadata.lightPosZ ?? 0) + breathZ
       );
    }

    const fogAnchor = this.getFogDebugAnchor(obj);
    if (this.debugFogStartSphere) {
      this.debugFogStartSphere.position.set(fogAnchor.x + breathX, fogAnchor.y + breathY, fogAnchor.z + breathZ);
    }
    if (this.debugFogEndSphere) {
      this.debugFogEndSphere.position.set(fogAnchor.x + breathX, fogAnchor.y + breathY, fogAnchor.z + breathZ);
    }
  }
}
