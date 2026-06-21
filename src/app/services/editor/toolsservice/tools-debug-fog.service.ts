
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugFogService {
  public debugFogStartSphere: Mesh | null = null;
  public debugFogEndSphere: Mesh | null = null;
  public debugFogCylinder: Mesh | null = null;

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null, fogAnchor: Vector3, isBW: boolean, isFPS: boolean): void {
    if (subSelected !== 'fog' || !entity.playerConfig?.fog?.enabled) {
      this.dispose();
      return;
    }

    const fogConfig = entity.playerConfig.fog;
    const fogShape = fogConfig.fogShape || 'cylinder';
    
    let hStartFpsBW = fogConfig.fogHeightYStartFpsBW ?? 4.0;
    let hStartTpsBW = fogConfig.fogHeightYStartTpsBW ?? 4.0;
    let hStartFPS = fogConfig.fogHeightYStartFPS ?? 4.0;
    let hStartTPS = fogConfig.fogHeightYStartTPS ?? 4.0;
    let fogHeightStart = Math.max(0.1, isBW ? (isFPS ? hStartFpsBW : hStartTpsBW) : (isFPS ? hStartFPS : hStartTPS));

    let hEndFpsBW = fogConfig.fogHeightYEndFpsBW ?? 10.0;
    let hEndTpsBW = fogConfig.fogHeightYEndTpsBW ?? 10.0;
    let hEndFPS = fogConfig.fogHeightYEndFPS ?? 10.0;
    let hEndTPS = fogConfig.fogHeightYEndTPS ?? 10.0;
    let fogHeightEnd = Math.max(0.1, isBW ? (isFPS ? hEndFpsBW : hEndTpsBW) : (isFPS ? hEndFPS : hEndTPS));

    if (!this.debugFogStartSphere) {
      this.debugFogStartSphere = MeshBuilder.CreateSphere('debugFogStart', { diameter: 0.6 }, scene);
      const mat = new StandardMaterial('debugFogStartMat', scene);
      mat.diffuseColor = new Color3(0, 1, 1);
      mat.emissiveColor = new Color3(0, 0.5, 0.5);
      mat.wireframe = true;
      mat.disableLighting = true;
      this.debugFogStartSphere.material = mat;
      this.debugFogStartSphere.isPickable = true;
      Tags.AddTagsTo(this.debugFogStartSphere, "system_element editor_only debug_element");
    }

    if (!this.debugFogEndSphere) {
      this.debugFogEndSphere = MeshBuilder.CreateSphere('debugFogEnd', { diameter: 0.4 }, scene);
      const mat2 = new StandardMaterial('debugFogEndMat', scene);
      mat2.diffuseColor = new Color3(0, 0.5, 1);
      mat2.emissiveColor = new Color3(0, 0.2, 0.5);
      mat2.wireframe = true;
      mat2.disableLighting = true;
      this.debugFogEndSphere.material = mat2;
      this.debugFogEndSphere.isPickable = false;
      Tags.AddTagsTo(this.debugFogEndSphere, "system_element editor_only debug_element ignore_raycast");
    }

    if (!this.debugFogCylinder) {
      this.debugFogCylinder = MeshBuilder.CreateCylinder('debugFogCyl', { diameter: 0.2, height: 1 }, scene);
      const mat3 = new StandardMaterial('debugFogCylMat', scene);
      mat3.diffuseColor = new Color3(0, 1, 1);
      mat3.emissiveColor = new Color3(0, 0.5, 0.5);
      mat3.alpha = 0.3;
      mat3.disableLighting = true;
      this.debugFogCylinder.material = mat3;
      this.debugFogCylinder.isPickable = false;
      Tags.AddTagsTo(this.debugFogCylinder, "system_element editor_only debug_element ignore_raycast");
    }

    this.sync(fogShape, fogHeightStart, fogHeightEnd, fogAnchor);
  }

  public sync(fogShape: string, fogHeightStart: number, fogHeightEnd: number, fogAnchor: Vector3): void {
    if (this.debugFogStartSphere) {
      const posStart = fogAnchor.clone();
      if (fogShape === 'cylinder') posStart.y += (fogHeightStart / 2);
      this.debugFogStartSphere.position.copyFrom(posStart);
    }
    if (this.debugFogEndSphere) {
      const posEnd = fogAnchor.clone();
      if (fogShape === 'cylinder') posEnd.y += fogHeightEnd;
      else posEnd.y += fogHeightEnd;
      this.debugFogEndSphere.position.copyFrom(posEnd);
    }
    if (this.debugFogCylinder && this.debugFogStartSphere && this.debugFogEndSphere) {
      const posStart = this.debugFogStartSphere.position;
      const posEnd = this.debugFogEndSphere.position;
      const dist = Vector3.Distance(posStart, posEnd);
      this.debugFogCylinder.scaling.y = dist;
      this.debugFogCylinder.position = Vector3.Center(posStart, posEnd);
      
      if (dist > 0.001) {
          this.debugFogCylinder.lookAt(posEnd, 0, Math.PI / 2, 0);
      }
    }
  }

  public dispose(): void {
    if (this.debugFogStartSphere) { this.debugFogStartSphere.dispose(); this.debugFogStartSphere = null; }
    if (this.debugFogEndSphere) { this.debugFogEndSphere.dispose(); this.debugFogEndSphere = null; }
    if (this.debugFogCylinder) { this.debugFogCylinder.dispose(); this.debugFogCylinder = null; }
  }
}