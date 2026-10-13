// file: src/app/services/editor/toolsservice/tools-debug-portals.service.ts
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Tags, Quaternion, Matrix } from '@babylonjs/core';
import { GameEntity, ConfiguredPortal } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugPortalsService {
  private portalMeshes: Mesh[] = [];
  private currentEntityUid: string | null = null;
  private selectedPortalId: string | null = null;

  public setSelectedPortalId(id: string | null): void {
    this.selectedPortalId = id;
    this.refreshColors();
  }

  public update(scene: Scene, entity: GameEntity, activeSelectedPortalId?: string | null): void {
    if (activeSelectedPortalId !== undefined) {
      this.selectedPortalId = activeSelectedPortalId;
    }

    if (!entity || !entity.light || entity.light.containmentMode !== 'INTERIOR') {
      this.dispose();
      return;
    }

    const portals: ConfiguredPortal[] = entity.light.portals || [];
    if (portals.length === 0) {
      this.dispose();
      return;
    }

    this.currentEntityUid = entity.uid;
    const rootMesh = entity.view;
    if (!rootMesh || rootMesh.isDisposed()) {
      this.dispose();
      return;
    }

    rootMesh.computeWorldMatrix(true);
    const wm = rootMesh.getWorldMatrix();

    if (this.portalMeshes.length !== portals.length) {
      this.dispose();
    }

    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      let pMesh = this.portalMeshes[i];

      if (!pMesh || pMesh.isDisposed()) {
        pMesh = MeshBuilder.CreateDisc(`debug_portal_disc_${p.id}`, { radius: 1, tessellation: 36 }, scene);
        const mat = new StandardMaterial(`mat_portal_disc_${p.id}`, scene);
        mat.diffuseColor = Color3.Black();
        mat.emissiveColor = Color3.FromHexString('#38bdf8');
        mat.alpha = 0.55;
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        pMesh.material = mat;
        pMesh.isPickable = false;
        pMesh.renderingGroupId = 2;

        Tags.AddTagsTo(pMesh, "system_element editor_only debug_element ignore_raycast");
        this.portalMeshes[i] = pMesh;
      }

      // Escala visual del disco según el radio configurado en cada portal
      const r = p.radius || ((p.width || 3.5) * 0.5);
      pMesh.scaling.set(r, r, 1);

      // Posición y orientación en el espacio mundial
      const locPos = new Vector3(p.localPosition.x, p.localPosition.y, p.localPosition.z);
      
      let rawNorm = new Vector3(p.localNormal.x, p.localNormal.y, p.localNormal.z);
      if (rawNorm.lengthSquared() < 0.0001) rawNorm.set(0, 0, 1);
      const locNorm = rawNorm.normalize();

      const worldPos = Vector3.TransformCoordinates(locPos, wm);
      const worldNorm = Vector3.TransformNormal(locNorm, wm).normalize();

      pMesh.position.copyFrom(worldPos);

      // Orientar el disco para que mire exactamente en la dirección de la normal
      const forwardRef = new Vector3(0, 0, 1);
      const rotQuat = Quaternion.FromUnitVectorsToRef(forwardRef, worldNorm, new Quaternion());
      pMesh.rotationQuaternion = rotQuat;
      pMesh.isVisible = true;
    }

    this.refreshColors();
  }

  private refreshColors(): void {
    for (let i = 0; i < this.portalMeshes.length; i++) {
      const m = this.portalMeshes[i];
      if (m && m.material) {
        const isSelected = m.name.includes(this.selectedPortalId || '____none____');
        const mat = m.material as StandardMaterial;
        mat.emissiveColor = isSelected ? Color3.FromHexString('#facc15') : Color3.FromHexString('#38bdf8');
        mat.alpha = isSelected ? 0.85 : 0.5;
      }
    }
  }

  public dispose(): void {
    for (let i = 0; i < this.portalMeshes.length; i++) {
      if (this.portalMeshes[i] && !this.portalMeshes[i].isDisposed()) {
        this.portalMeshes[i].dispose(false, true);
      }
    }
    this.portalMeshes = [];
    this.currentEntityUid = null;
    this.selectedPortalId = null;
  }
}