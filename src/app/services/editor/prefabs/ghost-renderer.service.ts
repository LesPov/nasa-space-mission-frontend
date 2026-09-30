import { Injectable, inject } from '@angular/core';
import { 
  AbstractMesh, Color3, Mesh, MeshBuilder, Scene, StandardMaterial, 
  TransformNode, Vector3, Tags, Node, Light, Camera, Engine, Quaternion, LinesMesh 
} from '@babylonjs/core';
import { CoreModelLoaderService } from '../../../core/engine/scene/utils/core-model-loader.service';

@Injectable({ providedIn: 'root' })
export class GhostRendererService {
  private modelLoader = inject(CoreModelLoaderService);

  private ghostRoot: TransformNode | null = null;
  private ghostMaterial: StandardMaterial | null = null;
  private currentScene: Scene | null = null;
  private currentAssetId: string | null = null;

  // Meshes de Debug visual para el Placement
  private debugTargetMarker: Mesh | null = null;
  private debugGhostMarker: Mesh | null = null;
  private debugLine: Mesh | null = null;

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
    const path = assetData.path || assetData.properties?.path || assetData.asset?.path;

    if (path) {
      const fullPath = 'http://localhost:4000' + path;
      
      const container = await this.modelLoader.getCachedAssetContainer(fullPath, scene);
      if (!this.ghostRoot || this.currentAssetId !== (assetData.id || assetData.name)) return null;

      const instances = container.instantiateModelsToScene(name => `ghost_${name}`, false, { doNotInstantiate: true });
      meshes = instances.rootNodes as AbstractMesh[];
      
      instances.animationGroups.forEach(ag => { ag.stop(); ag.dispose(); });
    }
    else {
      let mesh: Mesh;
      switch (assetData.type) {
        case 'cube': 
        case 'trigger':
        case 'trigger_compuesto':
        case 'image_plane':
        case 'video_plane':
          mesh = MeshBuilder.CreateBox('ghost_cube', { size: 1 }, scene); break;
        case 'sphere': 
        case 'bubble':
        case 'light_point':
        case 'light_spot':
        case 'light_directional':
          mesh = MeshBuilder.CreateSphere('ghost_sphere', { diameter: 1 }, scene); break;
        case 'cylinder': 
          mesh = MeshBuilder.CreateCylinder('ghost_cyl', { height: 1, diameter: 1 }, scene); break;
        case 'plane': 
          mesh = MeshBuilder.CreatePlane('ghost_plane', { size: 1 }, scene); break;
        default: 
          mesh = MeshBuilder.CreateBox('ghost_default', { size: 1 }, scene); break;
      }
      meshes.push(mesh);
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
      
      if (this.ghostRoot.rotationQuaternion) {
          this.ghostRoot.rotationQuaternion = Quaternion.FromEulerAngles(rotation.x, rotation.y, rotation.z);
      } else {
          this.ghostRoot.rotation.copyFrom(rotation);
      }
      
      this.ghostRoot.scaling.copyFrom(scale);
    }
  }

  /**
   * 🔥 VITAL: Extrae la geometría matemática del prefab eliminando la influencia
   * de la rotación actual para crear conectores puros en espacio Local.
   */
  public getLocalBoundingBox(): { min: Vector3, max: Vector3 } | null {
    if (!this.ghostRoot) return null;
    
    let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new Vector3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);
    let hasValidMesh = false;

    const childMeshes = this.ghostRoot.getChildMeshes(false);
    if (childMeshes.length === 0) return null;

    // Respaldar transformaciones actuales
    const pos = this.ghostRoot.position.clone();
    const rot = this.ghostRoot.rotationQuaternion ? this.ghostRoot.rotationQuaternion.clone() : null;
    const scl = this.ghostRoot.scaling.clone();

    // Resetear al origen para análisis puro
    this.ghostRoot.position = Vector3.Zero();
    if (this.ghostRoot.rotationQuaternion) {
        this.ghostRoot.rotationQuaternion.copyFromFloats(0,0,0,1);
    } else {
        this.ghostRoot.rotation.copyFromFloats(0,0,0);
    }
    this.ghostRoot.scaling = Vector3.One();
    this.ghostRoot.computeWorldMatrix(true);

    const invWorld = this.ghostRoot.getWorldMatrix().clone().invert();

    childMeshes.forEach(m => {
      if (!m.isVisible) return; 
      if (m.getTotalVertices() === 0) return;
      if (Tags.MatchesQuery(m, "proxy_collider")) return;

      m.computeWorldMatrix(true);
      const vectorsWorld = m.getBoundingInfo().boundingBox.vectorsWorld;
      vectorsWorld.forEach(vw => {
        const vLocal = Vector3.TransformCoordinates(vw, invWorld);
        min = Vector3.Minimize(min, vLocal);
        max = Vector3.Maximize(max, vLocal);
      });
      hasValidMesh = true;
    });

    // Restaurar transformaciones reales
    this.ghostRoot.position.copyFrom(pos);
    if (rot) {
        this.ghostRoot.rotationQuaternion = rot;
    }
    this.ghostRoot.scaling.copyFrom(scl);
    this.ghostRoot.computeWorldMatrix(true);

    if (!hasValidMesh) return { min: Vector3.Zero(), max: Vector3.Zero() };
    return { min, max };
  }

  /**
   * 🔥 DEBUG VISUAL: Muestra explícitamente los puntos de conexión al usar ALT
   */
  public updateDebugVisuals(show: boolean, targetPos?: Vector3, ghostPos?: Vector3) {
    if (!this.currentScene) return;

    if (!show || !targetPos || !ghostPos) {
       if (this.debugTargetMarker) this.debugTargetMarker.isVisible = false;
       if (this.debugGhostMarker) this.debugGhostMarker.isVisible = false;
       if (this.debugLine) this.debugLine.isVisible = false;
       return;
    }

    if (!this.debugTargetMarker) {
        this.debugTargetMarker = MeshBuilder.CreateSphere('debug_target', { diameter: 0.15 }, this.currentScene);
        const tMat = new StandardMaterial('debug_target_mat', this.currentScene);
        tMat.emissiveColor = new Color3(1, 0, 0); tMat.disableLighting = true;
        this.debugTargetMarker.material = tMat;
        Tags.AddTagsTo(this.debugTargetMarker, "system_element editor_only debug_element ignore_raycast");

        this.debugGhostMarker = MeshBuilder.CreateSphere('debug_ghost', { diameter: 0.15 }, this.currentScene);
        const gMat = new StandardMaterial('debug_ghost_mat', this.currentScene);
        gMat.emissiveColor = new Color3(0, 0.5, 1); gMat.disableLighting = true;
        this.debugGhostMarker.material = gMat;
        Tags.AddTagsTo(this.debugGhostMarker, "system_element editor_only debug_element ignore_raycast");
    }

    if (this.debugLine) this.debugLine.dispose();
    this.debugLine = MeshBuilder.CreateLines('debug_line', { points: [targetPos, ghostPos] }, this.currentScene);
    (this.debugLine as LinesMesh).color = new Color3(1, 1, 0);
    Tags.AddTagsTo(this.debugLine, "system_element editor_only debug_element ignore_raycast");

    if (!this.debugTargetMarker || !this.debugGhostMarker) return;

    this.debugTargetMarker.position.copyFrom(targetPos);
    this.debugGhostMarker.position.copyFrom(ghostPos);
    this.debugTargetMarker.isVisible = true;
    this.debugGhostMarker.isVisible = true;
  }

  public destroyGhost() {
    this.updateDebugVisuals(false);
    if (this.ghostRoot) {
      this.ghostRoot.dispose(false, true);
      this.ghostRoot = null;
    }
    if (this.ghostMaterial) {
      this.ghostMaterial.dispose();
      this.ghostMaterial = null;
    }
    if (this.debugTargetMarker) { this.debugTargetMarker.dispose(); this.debugTargetMarker = null; }
    if (this.debugGhostMarker) { this.debugGhostMarker.dispose(); this.debugGhostMarker = null; }
    if (this.debugLine) { this.debugLine.dispose(); this.debugLine = null; }

    this.currentAssetId = null;
    this.currentScene = null;
  }
}