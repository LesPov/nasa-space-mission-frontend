

import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugColliderService {
  public debugCollider: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;
  private currentColliderKey: string = '';

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (subSelected !== 'collider') {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;
    const type = entity.collider.type || 'box';

    mesh.computeWorldMatrix(true);
    const scaleX = Math.abs(mesh.scaling.x || 1);
    const scaleY = Math.abs(mesh.scaling.y || 1);
    const scaleZ = Math.abs(mesh.scaling.z || 1);

    const sX = (entity.collider.sizeX ?? 0.5) * scaleX;
    const sY = (entity.collider.sizeY ?? 0.5) * scaleY;
    const sZ = (entity.collider.sizeZ ?? 0.5) * scaleZ;

    // Generamos una clave única para saber si las dimensiones reales cambiaron
    const newKey = `${type}_${sX.toFixed(3)}_${sY.toFixed(3)}_${sZ.toFixed(3)}`;

    // 🔥 FIX 1: Si cambiaron las medidas, destruimos y recreamos. No escalamos. 
    // Escalar deforma las esferas y los polos de la cápsula.
    if (this.debugCollider && this.currentColliderKey !== newKey) {
       this.debugCollider.dispose();
       this.debugCollider = null;
    }

    if (!this.debugCollider) {
      this.currentColliderKey = newKey;
      
      if (type === 'capsule') {
         // Radio = ancho/profundidad mayor dividido en 2. Altura = sY (total).
         const r = Math.max(sX, sZ) / 2;
         this.debugCollider = MeshBuilder.CreateCapsule('debugColliderBox', { radius: r, height: sY }, scene);
      } else if (type === 'sphere') {
         this.debugCollider = MeshBuilder.CreateSphere('debugColliderBox', { diameterX: sX, diameterY: sY, diameterZ: sZ }, scene);
      } else {
         this.debugCollider = MeshBuilder.CreateBox('debugColliderBox', { width: sX, height: sY, depth: sZ }, scene);
      }
      
      const mat = new StandardMaterial('debugColliderMat', scene);
      mat.diffuseColor = new Color3(0, 1, 0); 
      mat.emissiveColor = new Color3(0, 0.8, 0);
      mat.wireframe = true;
      mat.disableLighting = true;
      this.debugCollider.material = mat;
      this.debugCollider.isPickable = true;
      Tags.AddTagsTo(this.debugCollider, "system_element editor_only debug_element");

      // Forzamos escala a 1 porque ya está horneada en la creación
      this.debugCollider.scaling.set(1, 1, 1);
    }

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
    this.currentColliderKey = '';
  }
}
