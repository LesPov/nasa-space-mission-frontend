import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugColliderService {
  public debugCollider: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;
  private currentColliderType: string = '';

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (subSelected !== 'collider') {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;
    const type = entity.collider.type || 'box';

    // Eliminamos la caja anterior si decidimos cambiar a cápsula u otra forma
    if (this.debugCollider && this.currentColliderType !== type) {
       this.debugCollider.dispose();
       this.debugCollider = null;
    }

    if (!this.debugCollider) {
      this.currentColliderType = type;
      
      // La altura/radio se establece en la creación como enteros, y luego la escalaremos
      if (type === 'capsule') {
         this.debugCollider = MeshBuilder.CreateCapsule('debugColliderBox', { radius: 1, height: 2 }, scene);
      } else if (type === 'sphere') {
         this.debugCollider = MeshBuilder.CreateSphere('debugColliderBox', { diameter: 2 }, scene);
      } else {
         this.debugCollider = MeshBuilder.CreateBox('debugColliderBox', { size: 2 }, scene);
      }
      
      const mat = new StandardMaterial('debugColliderMat', scene);
      mat.diffuseColor = new Color3(0, 1, 0); // Verde para colliders
      mat.emissiveColor = new Color3(0, 0.8, 0);
      mat.wireframe = true;
      mat.disableLighting = true;
      this.debugCollider.material = mat;
      this.debugCollider.isPickable = true;
      Tags.AddTagsTo(this.debugCollider, "system_element editor_only debug_element");
    }

    const scaleX = Math.abs(mesh.scaling.x || 1);
    const scaleY = Math.abs(mesh.scaling.y || 1);
    const scaleZ = Math.abs(mesh.scaling.z || 1);

    // Scaling the mesh which has radius 1 / size 2
    // If collider.sizeX is 0.4, it will correctly scale the capsule radius to 0.4
    this.debugCollider.scaling.set(
      (entity.collider.sizeX || 0.5) * scaleX,
      (entity.collider.sizeY || 0.5) * scaleY,
      (entity.collider.sizeZ || 0.5) * scaleZ
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
      // El LocalOffset se adapta al pivote mundial, heredando la escala de forma perfecta
      this.debugCollider.position = Vector3.TransformCoordinates(localOffset, this.attachedMesh.getWorldMatrix());
    }
  }

  public dispose(): void {
    if (this.debugCollider) {
      this.debugCollider.dispose();
      this.debugCollider = null;
    }
    this.attachedMesh = null;
    this.currentColliderType = '';
  }
}