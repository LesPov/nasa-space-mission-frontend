
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugCameraService {
  public debugCameraBox: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (subSelected !== 'camera') {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;

    if (!this.debugCameraBox) {
      this.debugCameraBox = MeshBuilder.CreateBox('debugCameraBox', { size: 0.3 }, scene);
      const mat = new StandardMaterial('debugCameraMat', scene);
      mat.diffuseColor = new Color3(1, 0, 1);
      mat.emissiveColor = new Color3(0.5, 0, 0.5);
      mat.wireframe = true;
      mat.disableLighting = true;
      this.debugCameraBox.material = mat;
      this.debugCameraBox.isPickable = true;
      Tags.AddTagsTo(this.debugCameraBox, "system_element editor_only debug_element");
    }

    // 🔥 FIX 2: Usar PlayerConfig si es personaje.
    let cX = entity.camOffset.x || 0;
    let cY = entity.camOffset.y || 1.6;
    let cZ = entity.camOffset.z || 0;

    if (entity.characterConfig && entity.playerConfig) {
       cY = entity.playerConfig.camera.fpsEyeLevel;
    }

    this.sync(cX, cY, cZ, 0, 0, 0);

    if (mesh.rotationQuaternion) {
        this.debugCameraBox.rotationQuaternion = mesh.rotationQuaternion.clone();
    } else {
        this.debugCameraBox.rotation = mesh.rotation.clone();
    }
  }

  public sync(offsetX: number, offsetY: number, offsetZ: number, breathX: number, breathY: number, breathZ: number): void {
    if (this.debugCameraBox && this.attachedMesh) {
      const scaleY = this.attachedMesh.scaling.y || 1;
      const localOffset = new Vector3(offsetX + breathX, (offsetY / scaleY) + breathY, offsetZ + breathZ);
      this.attachedMesh.computeWorldMatrix(true);
      this.debugCameraBox.position = Vector3.TransformCoordinates(localOffset, this.attachedMesh.getWorldMatrix());
    }
  }

  public dispose(): void {
    if (this.debugCameraBox) {
      this.debugCameraBox.dispose();
      this.debugCameraBox = null;
    }
    this.attachedMesh = null;
  }
}