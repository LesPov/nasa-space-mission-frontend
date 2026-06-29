
import { Injectable, inject } from '@angular/core';
import { Scene, Mesh, StandardMaterial, Color3, AbstractMesh, Tags } from '@babylonjs/core';
import { CoreModelLoaderService } from '../../../core/engine/scene/utils/core-model-loader.service';
import { CorePrimitiveLoaderService } from '../../../core/engine/scene/utils/core-primitive-loader.service';

@Injectable({ providedIn: 'root' })
export class PrefabGhostService {
  private modelLoader = inject(CoreModelLoaderService);
  private primitiveLoader = inject(CorePrimitiveLoaderService);
  
  public ghostMesh: Mesh | null = null;
  private validMaterial: StandardMaterial | null = null;
  private invalidMaterial: StandardMaterial | null = null;
  private snapMaterial: StandardMaterial | null = null;

  public async createGhost(prefabData: any, scene: Scene): Promise<Mesh | null> {
    this.disposeGhost();

    this.validMaterial = new StandardMaterial("ghostValidMat", scene);
    this.validMaterial.diffuseColor = new Color3(0, 1, 0);
    this.validMaterial.emissiveColor = new Color3(0, 0.5, 0);
    this.validMaterial.alpha = 0.5;
    this.validMaterial.disableLighting = true;

    this.invalidMaterial = new StandardMaterial("ghostInvalidMat", scene);
    this.invalidMaterial.diffuseColor = new Color3(1, 0, 0);
    this.invalidMaterial.emissiveColor = new Color3(0.5, 0, 0);
    this.invalidMaterial.alpha = 0.5;
    this.invalidMaterial.disableLighting = true;

    this.snapMaterial = new StandardMaterial("ghostSnapMat", scene);
    this.snapMaterial.diffuseColor = new Color3(0, 0.5, 1);
    this.snapMaterial.emissiveColor = new Color3(0, 0.5, 1);
    this.snapMaterial.alpha = 0.6;
    this.snapMaterial.disableLighting = true;

    const mallasCreadas = new Map<string, Mesh>();
    
    const mockData = JSON.parse(JSON.stringify(prefabData));
    mockData.uid = 'ghost_' + window.crypto.randomUUID();
    mockData.name = 'GhostMesh';
    
    if (!mockData.position) mockData.position = { x: 0, y: 0, z: 0 };
    if (!mockData.rotation) mockData.rotation = { x: 0, y: 0, z: 0 };
    if (!mockData.scale) mockData.scale = { x: 1, y: 1, z: 1 };

    const isModel = mockData.type === 'model' || (mockData.type?.startsWith('light_') && mockData.assetId);

    if (isModel) {
        await this.modelLoader.cargarModeloAsync(mockData, mallasCreadas);
    } else {
        this.primitiveLoader.cargarPrimitiva(mockData, mallasCreadas);
    }

    this.ghostMesh = mallasCreadas.get(mockData.uid) || null;

    if (this.ghostMesh) {
        this.setupGhostHierarchy(this.ghostMesh);
    }

    return this.ghostMesh;
  }

  private setupGhostHierarchy(mesh: Mesh): void {
    Tags.AddTagsTo(mesh, "system_element editor_only ignore_raycast ghost");
    mesh.isPickable = false;
    mesh.checkCollisions = false;

    const applyMat = (m: AbstractMesh) => {
        if (m instanceof Mesh) {
            m.material = this.validMaterial;
            m.isPickable = false;
            m.checkCollisions = false;
            Tags.AddTagsTo(m, "system_element editor_only ignore_raycast ghost");
        }
    };

    applyMat(mesh);
    mesh.getChildMeshes(false).forEach(child => applyMat(child));
  }

  public setValidity(state: 'valid' | 'invalid' | 'snap'): void {
    if (!this.ghostMesh) return;
    let mat = this.validMaterial;
    if (state === 'invalid') mat = this.invalidMaterial;
    if (state === 'snap') mat = this.snapMaterial;
    
    this.ghostMesh.material = mat;
    this.ghostMesh.getChildMeshes(false).forEach(m => {
        if (m instanceof Mesh) m.material = mat;
    });
  }

  public disposeGhost(): void {
    if (this.ghostMesh) {
        this.ghostMesh.dispose();
        this.ghostMesh = null;
    }
    if (this.validMaterial) { this.validMaterial.dispose(); this.validMaterial = null; }
    if (this.invalidMaterial) { this.invalidMaterial.dispose(); this.invalidMaterial = null; }
    if (this.snapMaterial) { this.snapMaterial.dispose(); this.snapMaterial = null; }
  }
}