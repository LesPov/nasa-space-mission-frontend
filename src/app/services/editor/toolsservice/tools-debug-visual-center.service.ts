
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugVisualCenterService {
  public debugVisualCenter: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;
  private currentEntity: GameEntity | null = null;

  // Zero-Allocation Vector para actualización en Update Loop
  private static _tempRef = Vector3.Zero();

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    // Solo lo mostramos si es un personaje, para evitar polución visual en props normales.
    // También desaparece si estamos editando un subobjeto (como luces o colliders).
    if (!entity.characterConfig || subSelected !== null) {
      this.dispose();
      return;
    }

    this.attachedMesh = mesh;
    this.currentEntity = entity;

    if (!this.debugVisualCenter) {
      this.debugVisualCenter = MeshBuilder.CreateSphere('debugVisualCenterSphere', { diameter: 0.15 }, scene);
      
      const mat = new StandardMaterial('debugVisualCenterMat', scene);
      mat.diffuseColor = new Color3(0, 1, 1); // Cyan característico
      mat.emissiveColor = new Color3(0, 0.8, 0.8);
      mat.wireframe = true;
      mat.disableLighting = true;
      
      this.debugVisualCenter.material = mat;
      this.debugVisualCenter.isPickable = false;
      this.debugVisualCenter.receiveShadows = false;
      
      Tags.AddTagsTo(this.debugVisualCenter, "system_element editor_only debug_element ignore_raycast");
    }

    this.sync();
  }

  public sync(): void {
    if (this.debugVisualCenter && this.currentEntity) {
       this.currentEntity.getVisualCenterAbsoluteToRef(ToolsDebugVisualCenterService._tempRef);
       this.debugVisualCenter.position.copyFrom(ToolsDebugVisualCenterService._tempRef);
    }
  }

  public dispose(): void {
    if (this.debugVisualCenter) {
      this.debugVisualCenter.dispose();
      this.debugVisualCenter = null;
    }
    this.attachedMesh = null;
    this.currentEntity = null;
  }
}