import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugLightService {
  public debugLightBox: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (subSelected !== 'light' || !entity.light) {
      this.dispose();
      return;
    }

    this.attachedMesh = mesh;

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

    this.sync(entity.light.lightPosX || 0, entity.light.lightPosY || 0, entity.light.lightPosZ || 0, 0, 0, 0);
  }

  public sync(offsetX: number, offsetY: number, offsetZ: number, breathX: number, breathY: number, breathZ: number): void {
    if (this.debugLightBox && this.attachedMesh) {
      const localOffset = new Vector3(offsetX + breathX, offsetY + breathY, offsetZ + breathZ);
      
      // 🔥 FIX: Buscar el padre real de la luz en la jerarquía (por si está amarrada a un hueso/pieza)
      let targetParent: any = this.attachedMesh;
      const lightObj = this.attachedMesh.getDescendants(false).find(c => c.name.startsWith('l_'));
      if (lightObj && lightObj.parent) {
          targetParent = lightObj.parent;
      }
      
      targetParent.computeWorldMatrix(true);
      this.debugLightBox.position = Vector3.TransformCoordinates(localOffset, targetParent.getWorldMatrix());
    }
  }

  public dispose(): void {
    if (this.debugLightBox) {
      this.debugLightBox.dispose();
      this.debugLightBox = null;
    }
    this.attachedMesh = null;
  }
}