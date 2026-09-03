
import { Injectable } from '@angular/core';
import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, Tags, Vector3, Engine } from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugColliderService {
  public debugCollider: Mesh | null = null;
  private attachedMesh: AbstractMesh | null = null;
  private currentColliderKey: string = '';

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    // 🔥 CORRECCIÓN CRÍTICA (Bug 3): Forzar la visualización en el editor
    // para CUALQUIER personaje, incluso si el subSelected no es 'collider'.
    const isCharacter = !!entity.characterConfig;
    if (subSelected !== 'collider' && !isCharacter) {
      this.dispose();
      return;
    }
    
    this.attachedMesh = mesh;
    // Si es personaje el motor lo fuerza siempre a capsule internamente, respetemos eso en el debug
    const type = isCharacter ? 'capsule' : (entity.collider.type || 'box');

    mesh.computeWorldMatrix(true);
    const scaleX = Math.abs(mesh.scaling.x || 1);
    const scaleY = Math.abs(mesh.scaling.y || 1);
    const scaleZ = Math.abs(mesh.scaling.z || 1);

    // 🔥 CORRECCIÓN CRÍTICA (Bug 3): BabylonJS maneja los Ellipsoids como RADIOS.
    // Por tanto, las dimensiones guardadas en BD son radios. Para el debug visual
    // debemos multiplicar por 2 para mostrar los Diámetros (escala real que ocupa en escena).
    const sX = (entity.collider.sizeX ?? 0.5) * scaleX * 2;
    const sY = (entity.collider.sizeY ?? 0.5) * scaleY * 2;
    const sZ = (entity.collider.sizeZ ?? 0.5) * scaleZ * 2;

    const newKey = `${type}_${sX.toFixed(3)}_${sY.toFixed(3)}_${sZ.toFixed(3)}`;

    if (this.debugCollider && this.currentColliderKey !== newKey) {
       this.debugCollider.dispose();
       this.debugCollider = null;
    }

    if (!this.debugCollider) {
      this.currentColliderKey = newKey;
      
      // 🔥 CORRECCIÓN CRÍTICA: Renderizar visualmente la geometría exacta configurada
      if (type === 'capsule' || type === 'cylinder') {
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
      mat.alpha = 0.25; // Color Sólido Semitransparente
      mat.alphaMode = Engine.ALPHA_COMBINE;
      mat.wireframe = true; // Y también un Wireframe por encima para fácil distinción
      mat.disableLighting = true;
      this.debugCollider.material = mat;
      this.debugCollider.isPickable = false; // JAMÁS interfiere con la selección en editor
      Tags.AddTagsTo(this.debugCollider, "system_element editor_only debug_element ignore_raycast");

      this.debugCollider.scaling.set(1, 1, 1);
    }

    // Los offsets en la base de datos se pasan crudos a sync, porque Vector3.TransformCoordinates 
    // aplicará internamente la matriz de escala del jugador para posicionarlo donde corresponde
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