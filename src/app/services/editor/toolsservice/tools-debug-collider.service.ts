// file: src/app/services/editor/toolsservice/tools-debug-collider.service.ts
import { Injectable } from '@angular/core';
import { 
  Scene, Mesh, MeshBuilder, StandardMaterial, Color3, AbstractMesh, 
  Tags, Vector3, Engine, InstancedMesh, Quaternion 
} from '@babylonjs/core';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ToolsDebugColliderService {
  public debugCollider: Mesh | null = null;
  public debugColliderRoot: Mesh | null = null;
  public debugMeshColliders: AbstractMesh[] = [];
  private attachedMesh: AbstractMesh | null = null;
  private currentColliderKey: string = '';
  private debugMaterial: StandardMaterial | null = null;

  public get currentColliderTarget(): AbstractMesh | null {
    if (this.debugCollider) return this.debugCollider;
    if (this.debugColliderRoot) return this.debugColliderRoot;
    return null;
  }

  private isMaterialDisposed(mat: any): boolean {
    if (!mat) return true;
    if (typeof mat.isDisposed === 'function') return mat.isDisposed();
    return mat.isDisposed === true || !mat.getScene();
  }

  private getOrCreateDebugMaterial(scene: Scene): StandardMaterial {
    if (!this.debugMaterial || this.debugMaterial.getScene() !== scene || this.isMaterialDisposed(this.debugMaterial)) {
      const mat = new StandardMaterial('debugColliderMatWhite', scene);
      mat.diffuseColor = new Color3(1, 1, 1);
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = 0.5;
      mat.alphaMode = Engine.ALPHA_COMBINE;
      mat.wireframe = true;
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      this.debugMaterial = mat;
    }
    return this.debugMaterial;
  }

  public update(scene: Scene, mesh: AbstractMesh, entity: GameEntity, subSelected: string | null): void {
    if (!mesh || mesh.isDisposed() || !entity) {
      this.dispose();
      return;
    }

    if (entity.type.startsWith('light_') && !entity.visual?.assetId && !entity.visual?.path) {
      this.dispose();
      return;
    }

    if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') {
      this.dispose();
      return;
    }

    this.attachedMesh = mesh;
    const isCharacter = !!entity.characterConfig;
    const colType = isCharacter ? 'capsule' : (entity.collider?.type || 'box');

    // CASO A: Collider tipo MESH (Geometría idéntica del modelo GLB)
    if (colType === 'mesh') {
      this.disposePrimitiveCollider();
      this.updateMeshColliders(scene, mesh, entity);
      return;
    }

    // CASO B: Collider Primitivo (Box, Sphere, Capsule, Cylinder)
    this.disposeMeshColliders();
    this.updatePrimitiveCollider(scene, mesh, entity, colType);
  }

  private updateMeshColliders(scene: Scene, rootMesh: AbstractMesh, entity: GameEntity): void {
    const mat = this.getOrCreateDebugMaterial(scene);
    rootMesh.computeWorldMatrix(true);

    const targetMeshes: Mesh[] = [];
    const checkCandidate = (m: AbstractMesh) => {
      if (!m || m.isDisposed()) return;
      if (Tags.MatchesQuery(m, 'system_element || editor_only || debug_element || proxy_collider || light_visual')) return;
      if (m.getClassName() === 'Mesh' && (m as Mesh).getTotalVertices() > 0) {
        targetMeshes.push(m as Mesh);
      } else if (m.getClassName() === 'InstancedMesh') {
        const src = (m as InstancedMesh).sourceMesh;
        if (src && src.getTotalVertices() > 0) {
          targetMeshes.push(src);
        }
      }
    };

    checkCandidate(rootMesh);
    rootMesh.getChildMeshes(false).forEach(checkCandidate);

    // Nodo pivote de colisión para enganche de Gizmo
    if (!this.debugColliderRoot || this.debugColliderRoot.isDisposed()) {
      this.debugColliderRoot = new Mesh('debugMeshColliderRoot', scene);
      this.debugColliderRoot.isPickable = false;
      this.debugColliderRoot.checkCollisions = false;
      this.debugColliderRoot.isVisible = false;
      Tags.AddTagsTo(this.debugColliderRoot, 'system_element editor_only debug_element ignore_raycast');
    }

    const key = `mesh_${rootMesh.uniqueId}_${targetMeshes.length}`;
    if (this.currentColliderKey !== key) {
      this.disposeMeshColliders();
      this.currentColliderKey = key;

      this.debugColliderRoot = new Mesh('debugMeshColliderRoot', scene);
      this.debugColliderRoot.isPickable = false;
      this.debugColliderRoot.checkCollisions = false;
      this.debugColliderRoot.isVisible = false;
      Tags.AddTagsTo(this.debugColliderRoot, 'system_element editor_only debug_element ignore_raycast');

      // Crear cada malla wireframe compartiendo la geometría real y colocándola como hija directa
      for (let i = 0; i < targetMeshes.length; i++) {
        const src = targetMeshes[i];

        // Crear una malla vacía que comparta la geometría exacta de la submalla
        const wireMesh = new Mesh(`debugWire_${src.name}`, scene);
        const geom = src.geometry;
        if (geom) {
          geom.applyToMesh(wireMesh);
        }

        wireMesh.material = mat;
        wireMesh.isPickable = false;
        wireMesh.checkCollisions = false;
        wireMesh.receiveShadows = false;
        wireMesh.isVisible = true;
        wireMesh.alwaysSelectAsActiveMesh = true;
        wireMesh.renderingGroupId = 2;

        // Al emparentarla a la submalla original, hereda automáticamente la rotación,
        // escala y posición de glTF sin importar cuántos nodos intermedios tenga el modelo
        wireMesh.parent = src;
        wireMesh.position.set(0, 0, 0);
        wireMesh.rotation.set(0, 0, 0);
        if (wireMesh.rotationQuaternion) {
          wireMesh.rotationQuaternion = null;
        }
        wireMesh.scaling.set(1, 1, 1);

        Tags.AddTagsTo(wireMesh, 'system_element editor_only debug_element ignore_raycast');
        this.debugMeshColliders.push(wireMesh);
      }
    }

    // Offset configurado desde el inspector o arrastrado con el Gizmo
    const offX = entity.collider?.offsetX || 0;
    const offY = entity.collider?.offsetY || 0;
    const offZ = entity.collider?.offsetZ || 0;
    const localOffset = new Vector3(offX, offY, offZ);

    // El centro del collider para el Gizmo sigue la posición mundial del modelo + offset
    const worldMatrix = rootMesh.getWorldMatrix();
    const worldColliderPos = Vector3.TransformCoordinates(localOffset, worldMatrix);
    const worldRot = rootMesh.rotationQuaternion 
      ? rootMesh.rotationQuaternion.clone() 
      : Quaternion.FromEulerAngles(rootMesh.rotation.x, rootMesh.rotation.y, rootMesh.rotation.z);

    if (this.debugColliderRoot && !this.debugColliderRoot.isDisposed()) {
      this.debugColliderRoot.position.copyFrom(worldColliderPos);
      this.debugColliderRoot.rotationQuaternion = worldRot;
      this.debugColliderRoot.scaling.set(1, 1, 1);
      this.debugColliderRoot.computeWorldMatrix(true);
    }

    // Aplicar el desplazamiento local (offset) a cada malla de colisión
    for (let i = 0; i < this.debugMeshColliders.length; i++) {
      const wire = this.debugMeshColliders[i];
      if (wire && !wire.isDisposed()) {
        wire.position.set(offX, offY, offZ);
      }
    }
  }

  private updatePrimitiveCollider(scene: Scene, mesh: AbstractMesh, entity: GameEntity, colType: string): void {
    mesh.computeWorldMatrix(true);
    const scaleX = Math.abs(mesh.scaling.x || 1);
    const scaleY = Math.abs(mesh.scaling.y || 1);
    const scaleZ = Math.abs(mesh.scaling.z || 1);

    const sX = (entity.collider?.sizeX ?? 0.5) * scaleX * 2;
    const sY = (entity.collider?.sizeY ?? 0.5) * scaleY * 2;
    const sZ = (entity.collider?.sizeZ ?? 0.5) * scaleZ * 2;

    const newKey = `${colType}_${sX.toFixed(3)}_${sY.toFixed(3)}_${sZ.toFixed(3)}`;

    if (this.debugCollider && this.currentColliderKey !== newKey) {
      this.disposePrimitiveCollider();
    }

    if (!this.debugCollider) {
      this.currentColliderKey = newKey;
      const mat = this.getOrCreateDebugMaterial(scene);

      if (colType === 'capsule') {
        const r = Math.max(sX, sZ) / 2;
        this.debugCollider = MeshBuilder.CreateCapsule('debugColliderBox', { radius: r, height: sY }, scene);
      } else if (colType === 'cylinder') {
        const diam = Math.max(sX, sZ);
        this.debugCollider = MeshBuilder.CreateCylinder('debugColliderBox', { diameter: diam, height: sY }, scene);
      } else if (colType === 'sphere') {
        this.debugCollider = MeshBuilder.CreateSphere('debugColliderBox', { diameterX: sX, diameterY: sY, diameterZ: sZ }, scene);
      } else {
        this.debugCollider = MeshBuilder.CreateBox('debugColliderBox', { width: sX, height: sY, depth: sZ }, scene);
      }

      this.debugCollider.material = mat;
      this.debugCollider.isPickable = false;
      this.debugCollider.checkCollisions = false;
      this.debugCollider.receiveShadows = false;
      this.debugCollider.alwaysSelectAsActiveMesh = true;
      this.debugCollider.renderingGroupId = 2;
      Tags.AddTagsTo(this.debugCollider, 'system_element editor_only debug_element ignore_raycast');
      this.debugCollider.scaling.set(1, 1, 1);
    }

    const offX = entity.collider?.offsetX || 0;
    const offY = entity.collider?.offsetY || 0;
    const offZ = entity.collider?.offsetZ || 0;

    this.sync(offX, offY, offZ, 0, 0, 0);

    if (mesh.rotationQuaternion) {
      this.debugCollider.rotationQuaternion = mesh.rotationQuaternion.clone();
    } else {
      this.debugCollider.rotation = mesh.rotation.clone();
    }
  }

  public sync(offsetX: number, offsetY: number, offsetZ: number, breathX: number, breathY: number, breathZ: number): void {
    if (this.attachedMesh && !this.attachedMesh.isDisposed()) {
      const localOffset = new Vector3(offsetX + breathX, offsetY + breathY, offsetZ + breathZ);
      this.attachedMesh.computeWorldMatrix(true);
      const worldPos = Vector3.TransformCoordinates(localOffset, this.attachedMesh.getWorldMatrix());

      if (this.debugCollider && !this.debugCollider.isDisposed()) {
        this.debugCollider.position.copyFrom(worldPos);
      }
      if (this.debugColliderRoot && !this.debugColliderRoot.isDisposed()) {
        this.debugColliderRoot.position.copyFrom(worldPos);
      }

      for (let i = 0; i < this.debugMeshColliders.length; i++) {
        const wire = this.debugMeshColliders[i];
        if (wire && !wire.isDisposed()) {
          wire.position.set(offsetX + breathX, offsetY + breathY, offsetZ + breathZ);
        }
      }
    }
  }

  private disposePrimitiveCollider(): void {
    if (this.debugCollider) {
      this.debugCollider.dispose();
      this.debugCollider = null;
    }
    this.currentColliderKey = '';
  }

  private disposeMeshColliders(): void {
    for (let i = 0; i < this.debugMeshColliders.length; i++) {
      const m = this.debugMeshColliders[i];
      if (m && !m.isDisposed()) {
        m.dispose(false, true);
      }
    }
    this.debugMeshColliders = [];
    if (this.debugColliderRoot && !this.debugColliderRoot.isDisposed()) {
      this.debugColliderRoot.dispose();
      this.debugColliderRoot = null;
    }
    this.currentColliderKey = '';
  }

  public dispose(): void {
    this.disposePrimitiveCollider();
    this.disposeMeshColliders();
    if (this.debugMaterial) {
      this.debugMaterial.dispose();
      this.debugMaterial = null;
    }
    this.attachedMesh = null;
    this.currentColliderKey = '';
  }
}