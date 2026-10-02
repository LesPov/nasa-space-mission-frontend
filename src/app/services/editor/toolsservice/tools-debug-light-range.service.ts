import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Engine } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugLightRangeService {
  public debugRangeSphere: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;
  private currentEntity: GameEntity | null = null;

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    // Solo mostramos el Helper de Rango para luces puntuales y focos. Si hay subselección (gizmos internos) lo ocultamos.
    if ((entity.type !== 'light_point' && entity.type !== 'light_spot') || subSelected !== null) {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;
    this.currentEntity = entity;

    if (!this.debugRangeSphere) {
      // Un diámetro de 2 significa que el radio base es 1.
      // Al escalar el Mesh por el valor de "Range", el radio final coincidirá matemáticamente con el Range de BabylonJS.
      this.debugRangeSphere = MeshBuilder.CreateSphere('debugLightRangeSphere', { diameter: 2, segments: 32 }, scene);
      
      const mat = new StandardMaterial('debugLightRangeMat', scene);
      mat.diffuseColor = new Color3(1, 1, 0); 
      mat.emissiveColor = new Color3(1, 0.8, 0);
      mat.alpha = 0.15; 
      mat.alphaMode = Engine.ALPHA_COMBINE;
      mat.wireframe = true; 
      mat.disableLighting = true;
      
      this.debugRangeSphere.material = mat;
      this.debugRangeSphere.isPickable = false; // Transparente a los clics del usuario
      this.debugRangeSphere.receiveShadows = false;
      
      // Etiquetas vitales para evitar polución en el Outliner y Raycasts
      Tags.AddTagsTo(this.debugRangeSphere, "system_element editor_only debug_element ignore_raycast");
    }

    this.sync();
  }

  public sync(): void {
    if (this.debugRangeSphere && this.attachedMesh && this.currentEntity) {
      this.attachedMesh.computeWorldMatrix(true);
      
      let origin = this.attachedMesh.getAbsolutePosition();
      
      // Si el usuario seleccionó la luz y tiene un helper visual (el bombillito), lo centramos exactamente ahí
      if (this.currentEntity.type.startsWith('light_') && !this.currentEntity.visual.assetId) {
         const visual = this.attachedMesh.getChildMeshes().find(m => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
         if (visual) {
             visual.computeWorldMatrix(true);
             origin = visual.getAbsolutePosition();
         }
      }

      this.debugRangeSphere.position.copyFrom(origin);
      
      // Sincronizamos la escala visual con el Rango real de la luz
      const range = this.currentEntity.light?.range ?? 50;
      this.debugRangeSphere.scaling.setAll(range);
      
      // Sincronizamos el color del wireframe con el color de la luz para mejor UX
      const hex = this.currentEntity.light?.lightColor || '#ffffff';
      if (this.debugRangeSphere.material) {
          const c3 = Color3.FromHexString(hex);
          (this.debugRangeSphere.material as StandardMaterial).emissiveColor = c3;
          (this.debugRangeSphere.material as StandardMaterial).diffuseColor = c3;
      }
    }
  }

  public dispose(): void {
    if (this.debugRangeSphere) {
      this.debugRangeSphere.dispose();
      this.debugRangeSphere = null;
    }
    this.attachedMesh = null;
    this.currentEntity = null;
  }
}