
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugColliderService {
  public debugCollider: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (subSelected !== 'collider') {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;

    if (!this.debugCollider) {
      this.debugCollider = MeshBuilder.CreateBox('debugColliderBox', { size: 1 }, scene);
      const mat = new StandardMaterial('debugColliderMat', scene);
      mat.diffuseColor = new Color3(1, 0.5, 0);
      mat.emissiveColor = new Color3(0.5, 0.2, 0);
      mat.wireframe = true;
      mat.disableLighting = true;
      this.debugCollider.material = mat;
      this.debugCollider.isPickable = true;
      Tags.AddTagsTo(this.debugCollider, "system_element editor_only debug_element");
    }

    const scaleX = mesh.scaling.x || 1;
    const scaleY = mesh.scaling.y || 1;
    const scaleZ = mesh.scaling.z || 1;

    this.debugCollider.scaling.set(
      (entity.collider.sizeX || 1) * scaleX,
      (entity.collider.sizeY || 1) * scaleY,
      (entity.collider.sizeZ || 1) * scaleZ
    );

    this.sync(entity.collider.offsetX || 0, entity.collider.offsetY || 0, entity.collider.offsetZ || 0, 0, 0, 0);
    
    if (mesh.rotationQuaternion) {
        this.debugCollider.rotationQuaternion = mesh.rotationQuaternion.clone();
    } else {
        this.debugCollider.rotation = mesh.rotation.clone();
    }
  }

  public sync(offsetX: number, offsetY: number, offsetZ: number, breathX: number, breathY: number, breathZ: number): void {
    if (this.debugCollider && this.attachedMesh) {
      const localOffset = new Vector3(offsetX + breathX, offsetY + breathY, offsetZ + breathZ);
      this.attachedMesh.computeWorldMatrix(true);
      this.debugCollider.position = Vector3.TransformCoordinates(localOffset, this.attachedMesh.getWorldMatrix());
    }
  }

  public dispose(): void {
    if (this.debugCollider) {
      this.debugCollider.dispose();
      this.debugCollider = null;
    }
    this.attachedMesh = null;
  }
}