import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CoreSceneMaterialService {
  
  public ajustarMaterialGLB(material: any): void {
    if (!material) return;
    
    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      material.subMaterials.forEach((subMat: any) => this.ajustarMaterialGLB(subMat));
      return;
    }
    
    // OPTIMIZACIÓN: De 16 a 4 luces por píxel. Acelera drásticamente la compilación y ejecución de shaders
    material.maxSimultaneousLights = 4;
    
    if (material.getClassName().includes('PBR')) {
      material.usePhysicalLightFalloff = false;
      material.metallic = 0.1;
      material.roughness = 0.8;
      material.environmentIntensity = 0.5;
    }
  }
}