
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3, Matrix } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugLightService {
  public debugLightBox: Mesh | null = null;
  public debugLightDir: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;
  private currentEntity: GameEntity | null = null;

  // Optimización para cálculos en tiempo real sin GC (Garbage Collector)
  private static _localOffset = Vector3.Zero();
  private static _localDir = Vector3.Zero();
  private static _downDir = new Vector3(0, -1, 0);
  private static _localRotMatrix = Matrix.Identity();

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (subSelected !== 'light' || !entity.light) {
      this.dispose();
      return;
    }

    this.attachedMesh = mesh;
    this.currentEntity = entity;

    if (!this.debugLightBox) {
      this.debugLightBox = MeshBuilder.CreateSphere('debugLightBox', { diameter: 0.4 }, scene);
      const mat = new StandardMaterial('debugLightMat', scene);
      mat.diffuseColor = new Color3(1, 1, 0);
      mat.emissiveColor = new Color3(0.8, 0.8, 0);
      mat.wireframe = true;
      mat.disableLighting = true;
      this.debugLightBox.material = mat;
      this.debugLightBox.isPickable = true;
      Tags.AddTagsTo(this.debugLightBox, "system_element editor_only debug_element");
    }

    if (!this.debugLightDir && (entity.type === 'light_spot' || entity.type === 'light_directional')) {
      this.debugLightDir = MeshBuilder.CreateCylinder('debugLightDir', { diameterTop: 0, diameterBottom: 0.1, height: 1 }, scene);
      const mat = new StandardMaterial('debugLightDirMat', scene);
      mat.diffuseColor = new Color3(1, 0.5, 0);
      mat.emissiveColor = new Color3(1, 0.5, 0);
      mat.disableLighting = true;
      this.debugLightDir.material = mat;
      this.debugLightDir.isPickable = false;
      Tags.AddTagsTo(this.debugLightDir, "system_element editor_only debug_element ignore_raycast");
      this.debugLightDir.parent = this.debugLightBox;
    } else if (this.debugLightDir && entity.type === 'light_point') {
        this.debugLightDir.dispose();
        this.debugLightDir = null;
    }

    this.sync(entity.light.lightPosX || 0, entity.light.lightPosY || 0, entity.light.lightPosZ || 0, 0, 0, 0);
  }

  public sync(offsetX: number, offsetY: number, offsetZ: number, breathX: number, breathY: number, breathZ: number): void {
    if (this.debugLightBox && this.attachedMesh && this.currentEntity) {
      const entity = this.currentEntity;
      
      let targetParent: AbstractMesh = this.attachedMesh;
      if (entity.light?.attachedNodeName) {
          const found = this.attachedMesh.getDescendants(false).find(n => n.name === entity.light!.attachedNodeName);
          if (found) targetParent = found as AbstractMesh;
      }
      
      targetParent.computeWorldMatrix(true);
      const worldMatrix = targetParent.getWorldMatrix();
      
      ToolsDebugLightService._localOffset.set(offsetX + breathX, offsetY + breathY, offsetZ + breathZ);
      Vector3.TransformCoordinatesToRef(ToolsDebugLightService._localOffset, worldMatrix, this.debugLightBox.position);
      
      if (this.debugLightDir) {
         const rx = (entity.light?.lightRotX || 0) * Math.PI / 180;
         const ry = (entity.light?.lightRotY || 0) * Math.PI / 180;
         const rz = (entity.light?.lightRotZ || 0) * Math.PI / 180;

         Matrix.RotationYawPitchRollToRef(ry, rx, rz, ToolsDebugLightService._localRotMatrix);
         Vector3.TransformNormalToRef(ToolsDebugLightService._downDir, ToolsDebugLightService._localRotMatrix, ToolsDebugLightService._localDir);
         
         const worldDir = Vector3.TransformNormal(ToolsDebugLightService._localDir, worldMatrix).normalize();
         
         const targetPos = this.debugLightBox.position.add(worldDir);
         this.debugLightBox.lookAt(targetPos); 
         
         // Fix cilindro originando en esfera visual apuntando a donde mira lookAt (Z)
         this.debugLightDir.rotation.x = Math.PI / 2;
         this.debugLightDir.position.z = 0.5; 
      }
    }
  }

  public dispose(): void {
    if (this.debugLightBox) {
      this.debugLightBox.dispose();
      this.debugLightBox = null;
    }
    if (this.debugLightDir) {
        this.debugLightDir.dispose();
        this.debugLightDir = null;
    }
    this.attachedMesh = null;
    this.currentEntity = null;
  }
}