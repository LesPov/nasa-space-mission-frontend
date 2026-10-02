
import { Injectable, inject } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Engine, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { LightContainmentService } from '../../../core/engine/runtime/systems/lighting/light-containment.service';

@Injectable({ providedIn: 'root' })
export class ToolsDebugLightRangeService {
  public debugRangeSphere: Mesh | null = null;
  public debugContainerBox: Mesh | null = null;
  
  private attachedMesh: AbstractMesh | null = null;
  private currentEntity: GameEntity | null = null;
  private containmentSvc = inject(LightContainmentService);

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if ((entity.type !== 'light_point' && entity.type !== 'light_spot') || subSelected !== null) {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;
    this.currentEntity = entity;

    if (!this.debugRangeSphere) {
      this.debugRangeSphere = MeshBuilder.CreateSphere('debugLightRangeSphere', { diameter: 2, segments: 32 }, scene);
      
      const mat = new StandardMaterial('debugLightRangeMat', scene);
      mat.diffuseColor = new Color3(1, 1, 0); 
      mat.emissiveColor = new Color3(1, 0.8, 0);
      mat.alpha = 0.15; 
      mat.alphaMode = Engine.ALPHA_COMBINE;
      mat.wireframe = true; 
      mat.disableLighting = true;
      
      this.debugRangeSphere.material = mat;
      this.debugRangeSphere.isPickable = false;
      this.debugRangeSphere.receiveShadows = false;
      
      Tags.AddTagsTo(this.debugRangeSphere, "system_element editor_only debug_element ignore_raycast");
    }

    // 🔥 FASE 6 FIX: Caja visual de contención interior si el modo es INTERIOR
    if (this.currentEntity.light?.containmentMode === 'INTERIOR') {
       if (!this.debugContainerBox) {
           this.debugContainerBox = MeshBuilder.CreateBox('debugContainerBox', { size: 1 }, scene);
           const cMat = new StandardMaterial('cmat', scene);
           cMat.wireframe = true; 
           cMat.emissiveColor = new Color3(0, 1, 1); // Cyan para diferenciar de la luz (Amarilla)
           cMat.disableLighting = true;
           
           this.debugContainerBox.material = cMat;
           this.debugContainerBox.isPickable = false;
           this.debugContainerBox.receiveShadows = false;
           Tags.AddTagsTo(this.debugContainerBox, "system_element editor_only debug_element ignore_raycast");
       }
    } else if (this.debugContainerBox) {
       this.debugContainerBox.dispose();
       this.debugContainerBox = null;
    }

    this.sync();
  }

  public sync(): void {
    if (this.debugRangeSphere && this.attachedMesh && this.currentEntity) {
      this.attachedMesh.computeWorldMatrix(true);
      
      let origin = this.attachedMesh.getAbsolutePosition();
      
      if (this.currentEntity.type.startsWith('light_') && !this.currentEntity.visual.assetId) {
         const visual = this.attachedMesh.getChildMeshes().find(m => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
         if (visual) {
             visual.computeWorldMatrix(true);
             origin = visual.getAbsolutePosition();
         }
      }

      this.debugRangeSphere.position.copyFrom(origin);
      
      const range = this.currentEntity.light?.range ?? 50;
      this.debugRangeSphere.scaling.setAll(range);
      
      const hex = this.currentEntity.light?.lightColor || '#ffffff';
      if (this.debugRangeSphere.material) {
          const c3 = Color3.FromHexString(hex);
          (this.debugRangeSphere.material as StandardMaterial).emissiveColor = c3;
          (this.debugRangeSphere.material as StandardMaterial).diffuseColor = c3;
      }
      
      if (this.debugContainerBox && this.currentEntity.light?.containmentMode === 'INTERIOR') {
          const containerEnt = this.containmentSvc.resolveContainerEntity(this.currentEntity, this.attachedMesh.getScene());
          if (containerEnt && containerEnt.view) {
              containerEnt.view.computeWorldMatrix(true);
              const bounds = containerEnt.view.getHierarchyBoundingVectors(true);
              const center = bounds.max.add(bounds.min).scale(0.5);
              const size = bounds.max.subtract(bounds.min);
              this.debugContainerBox.position.copyFrom(center);
              this.debugContainerBox.scaling.copyFrom(size);
              this.debugContainerBox.isVisible = true;
          } else {
              this.debugContainerBox.isVisible = false;
          }
      }
    }
  }

  public dispose(): void {
    if (this.debugRangeSphere) {
      this.debugRangeSphere.dispose();
      this.debugRangeSphere = null;
    }
    if (this.debugContainerBox) {
      this.debugContainerBox.dispose();
      this.debugContainerBox = null;
    }
    this.attachedMesh = null;
    this.currentEntity = null;
  }
}