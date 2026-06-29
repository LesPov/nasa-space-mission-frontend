import { Injectable, inject } from '@angular/core';
import { 
  AbstractMesh, Color3, Mesh, MeshBuilder, Scene, StandardMaterial, 
  TransformNode, Vector3, Tags, Node, Light, Camera, Engine 
} from '@babylonjs/core';
import { CoreModelLoaderService } from '../../../core/engine/scene/utils/core-model-loader.service';

/**
 * SERVICIO DE RENDERIZADO DEL FANTASMA (GHOST)
 * Representa visualmente el Prefab sin físicas y calcula sus dimensiones
 * exactas para evitar que atraviese pisos y paredes.
 */
@Injectable({ providedIn: 'root' })
export class GhostRendererService {
  private modelLoader = inject(CoreModelLoaderService);

  private ghostRoot: TransformNode | null = null;
  private ghostMaterial: StandardMaterial | null = null;
  private currentScene: Scene | null = null;
  private currentAssetId: string | null = null;

  public async createGhost(assetData: any, scene: Scene): Promise<TransformNode | null> {
    this.destroyGhost();
    this.currentScene = scene;
    this.currentAssetId = assetData.id || assetData.name;

    this.ghostRoot = new TransformNode('ghost_root', scene);
    
    if (!this.ghostMaterial) {
      this.ghostMaterial = new StandardMaterial('ghost_hologram_mat', scene);
      this.ghostMaterial.alpha = 0.65;
      this.ghostMaterial.disableLighting = true; 
      this.ghostMaterial.emissiveColor = new Color3(0.2, 1.0, 0.2); 
      this.ghostMaterial.alphaMode = Engine.ALPHA_COMBINE;
      this.ghostMaterial.backFaceCulling = false; 
    }

    let meshes: AbstractMesh[] = [];

    if (assetData.isPrefab && assetData.type) {
      // 1. Primitivas
      let mesh: Mesh;
      switch (assetData.type) {
        case 'cube': mesh = MeshBuilder.CreateBox('ghost_cube', { size: 1 }, scene); break;
        case 'sphere': mesh = MeshBuilder.CreateSphere('ghost_sphere', { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder('ghost_cyl', { height: 1, diameter: 1 }, scene); break;
        case 'plane': mesh = MeshBuilder.CreatePlane('ghost_plane', { size: 1 }, scene); break;
        default: mesh = MeshBuilder.CreateBox('ghost_default', { size: 1 }, scene); break;
      }
      meshes.push(mesh);
    } 
    else if (assetData.path || assetData.properties?.path) {
      // 2. Modelos 3D GLB/GLTF
      const path = assetData.path || assetData.properties?.path;
      const fullPath = 'http://localhost:4000' + path;
      
      const container = await this.modelLoader.getCachedAssetContainer(fullPath, scene);
      if (!this.ghostRoot || this.currentAssetId !== (assetData.id || assetData.name)) return null;

      const instances = container.instantiateModelsToScene(name => `ghost_${name}`, false, { doNotInstantiate: true });
      meshes = instances.rootNodes as AbstractMesh[];
      
      instances.animationGroups.forEach(ag => { ag.stop(); ag.dispose(); });
    }

    meshes.forEach(m => m.parent = this.ghostRoot);
    this.processGhostHierarchy(this.ghostRoot);

    return this.ghostRoot;
  }

  private processGhostHierarchy(node: Node) {
    if (node instanceof AbstractMesh) {
      node.isPickable = false;
      node.checkCollisions = false;
      node.receiveShadows = false;
      node.applyFog = false;
      
      if (node.material || node instanceof Mesh) {
        node.material = this.ghostMaterial;
      }
      Tags.AddTagsTo(node, "system_element editor_only ghost_preview ignore_raycast");
    }
    if (node instanceof Light || node instanceof Camera) {
      node.dispose();
      return;
    }
    node.getChildren().forEach(child => this.processGhostHierarchy(child));
  }

  public setColor(color: 'green' | 'yellow' | 'blue' | 'red') {
    if (!this.ghostMaterial) return;
    switch (color) {
      case 'green':  this.ghostMaterial.emissiveColor = new Color3(0.2, 1.0, 0.2); break; 
      case 'yellow': this.ghostMaterial.emissiveColor = new Color3(1.0, 1.0, 0.2); break; 
      case 'blue':   this.ghostMaterial.emissiveColor = new Color3(0.2, 0.6, 1.0); break; 
      case 'red':    this.ghostMaterial.emissiveColor = new Color3(1.0, 0.2, 0.2); break; 
    }
  }

  public setTransform(position: Vector3, rotation: Vector3, scale: Vector3) {
    if (this.ghostRoot) {
      this.ghostRoot.position.copyFrom(position);
      this.ghostRoot.rotation.copyFrom(rotation);
      this.ghostRoot.scaling.copyFrom(scale);
    }
  }

  /**
   * MATEMÁTICA AVANZADA: Calcula el tamaño real del objeto teniendo en cuenta su rotación actual.
   * Esto es vital para que al rotar una calle o pared, reconozca sus nuevos bordes.
   */
  public getBoundingInfo(currentRotation: Vector3) {
    if (!this.ghostRoot) return null;
    
    const childMeshes = this.ghostRoot.getChildMeshes(false);
    if (childMeshes.length === 0) return null;

    // Guardamos estado
    const pos = this.ghostRoot.position.clone();
    const scl = this.ghostRoot.scaling.clone();

    // Centramos el objeto para medirlo limpio, pero APLICAMOS LA ROTACIÓN
    this.ghostRoot.position = Vector3.Zero();
    this.ghostRoot.rotation.copyFrom(currentRotation);
    this.ghostRoot.scaling = Vector3.One();
    this.ghostRoot.computeWorldMatrix(true);

    let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new Vector3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);

    childMeshes.forEach(m => {
      m.computeWorldMatrix(true);
      const vectors = m.getBoundingInfo().boundingBox.vectorsWorld;
      vectors.forEach(v => {
        min = Vector3.Minimize(min, v);
        max = Vector3.Maximize(max, v);
      });
    });

    // Restauramos estado
    this.ghostRoot.position = pos;
    this.ghostRoot.scaling = scl;
    this.ghostRoot.computeWorldMatrix(true);

    return { min, max, extends: max.subtract(min).scale(0.5) };
  }

  public destroyGhost() {
    if (this.ghostRoot) {
      this.ghostRoot.dispose(false, true);
      this.ghostRoot = null;
    }
    this.currentAssetId = null;
  }
}