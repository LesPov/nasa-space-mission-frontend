// file: src/app/core/engine/scene/utils/core-scene-material.service.ts
import { Injectable } from '@angular/core';
import { Color3, Texture, RawTexture, Scene, AbstractMesh, Material, MultiMaterial } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class CoreSceneMaterialService {
  public static readonly MAX_SIMULTANEOUS_LIGHTS = 6;
  
  private bwTextureCache = new Map<string, Texture>();

  public clearCache(): void {
    this.bwTextureCache.forEach(t => {
      if (t) {
        try { t.dispose(); } catch (e) {}
      }
    });
    this.bwTextureCache.clear();
  }

  public asegurarMaterialUnico(mesh: AbstractMesh, uid: string): void {
    if (!mesh.material) return;
    
    if (!mesh.material.name.includes(uid)) {
      try {
        if (mesh.material.getClassName() === 'MultiMaterial') {
          const multiMat = mesh.material as MultiMaterial;
          const newMultiMat = multiMat.clone(multiMat.name + "_" + uid);
          if (newMultiMat.subMaterials) {
            newMultiMat.subMaterials = multiMat.subMaterials.map((subMat: Material | null) => {
              if (subMat && !subMat.name.includes(uid) && typeof (subMat as any).clone === 'function') {
                return (subMat as any).clone(subMat.name + "_" + uid);
              }
              return subMat;
            });
          }
          mesh.material = newMultiMat;
        } else if (typeof (mesh.material as any).clone === 'function') {
          mesh.material = (mesh.material as any).clone(mesh.material.name + "_" + uid);
        }
      } catch (e) {
        console.warn("[CoreSceneMaterialService] No se pudo clonar el material para hacerlo único:", e);
      }
    }
  }

  public asegurarMaterialUnicoParaParte(mesh: AbstractMesh, uid: string, partName: string): void {
    if (!mesh.material) return;
    
    const uniqueSuffix = `${uid}_${partName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (!mesh.material.name.includes(uniqueSuffix)) {
      try {
        if (mesh.material.getClassName() === 'MultiMaterial') {
          const multiMat = mesh.material as MultiMaterial;
          const newMultiMat = multiMat.clone(multiMat.name + "_" + uniqueSuffix);
          if (newMultiMat.subMaterials) {
            newMultiMat.subMaterials = multiMat.subMaterials.map((subMat: Material | null) => {
              if (subMat && !subMat.name.includes(uniqueSuffix) && typeof (subMat as any).clone === 'function') {
                return (subMat as any).clone(subMat.name + "_" + uniqueSuffix);
              }
              return subMat;
            });
          }
          mesh.material = newMultiMat;
        } else if (typeof (mesh.material as any).clone === 'function') {
          mesh.material = (mesh.material as any).clone(mesh.material.name + "_" + uniqueSuffix);
        }
      } catch (e) {
        console.warn("[CoreSceneMaterialService] No se pudo clonar el material para hacerlo único por parte:", e);
      }
    }
  }

  public async ajustarMaterialGLB(
    material: any, 
    isBW: boolean = false, 
    scene?: Scene, 
    ambientColorHex?: string, 
    colorHex?: string, 
    esEmisivo: boolean = false, 
    brilloIntensidad: number = 1.0,
    texturePath?: string,
    textureSource: 'original' | 'solid' | 'asset' = 'original'
  ): Promise<void> {
    if (!material) return;
    
    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      for (const subMat of material.subMaterials) {
        if (subMat) {
          await this.ajustarMaterialGLB(subMat, isBW, scene, ambientColorHex, colorHex, esEmisivo, brilloIntensidad, texturePath, textureSource);
        }
      }
      return;
    }
    
    if (material.maxSimultaneousLights !== CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS) {
      material.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
    }

    const c3Amb = ambientColorHex ? Color3.FromHexString(ambientColorHex) : new Color3(1, 1, 1);
    const c3Tint = colorHex ? Color3.FromHexString(colorHex) : new Color3(1, 1, 1);
    const brillo = Math.max(0, Math.min(10, brilloIntensidad));
    const isCustomTint = colorHex && colorHex.toLowerCase() !== '#ffffff';

    if (material.getClassName().includes('PBR')) {
      if (material.allowShaderHotSwapping !== true) material.allowShaderHotSwapping = true;
      if (!material.ambientColor || !material.ambientColor.equals(c3Amb)) {
        material.ambientColor = c3Amb.clone();
      }
      
      if (material.usePhysicalLightFalloff !== false) material.usePhysicalLightFalloff = false;
      if (material.metallic !== 0.1) material.metallic = 0.1;
      if (material.roughness !== 0.8) material.roughness = 0.8;
      if (material.environmentIntensity !== 0.5) material.environmentIntensity = 0.5;

      if (!material.metadata) material.metadata = {};
      if (material.metadata.originalAlbedoTexture === undefined) {
        material.metadata.originalAlbedoTexture = material.albedoTexture || null;
        material.metadata.originalAlbedoColor = material.albedoColor ? material.albedoColor.clone() : new Color3(0.8, 0.8, 0.8);
      }

      if (isCustomTint || textureSource === 'solid') {
        if (!material.albedoColor || !material.albedoColor.equals(c3Tint)) {
          material.albedoColor = c3Tint.clone();
        }
      } else {
        if (material.metadata.originalAlbedoColor) {
          if (!material.albedoColor || !material.albedoColor.equals(material.metadata.originalAlbedoColor)) {
            material.albedoColor.copyFrom(material.metadata.originalAlbedoColor);
          }
        }
      }

      const targetEmissive = esEmisivo 
        ? ((isCustomTint || textureSource === 'solid') ? c3Tint.scale(brillo) : (material.metadata.originalAlbedoColor || new Color3(1,1,1)).scale(brillo))
        : Color3.Black();

      if (!material.emissiveColor || !material.emissiveColor.equals(targetEmissive)) {
        material.emissiveColor = targetEmissive.clone();
      }

      if (textureSource === 'asset' && texturePath && scene) {
        let tex: any = new Texture('http://localhost:4000' + texturePath, scene);
        if (isBW) tex = await this.getOrCreateBwTexture(tex, scene);
        if (material.albedoTexture !== tex) {
          material.albedoTexture = tex;
        }
      } else if (textureSource === 'solid') {
        if (material.albedoTexture !== null) {
          material.albedoTexture = null;
        }
      } else {
        if (isBW && scene) {
          if (material.metadata.originalAlbedoTexture) {
            const bwTex = await this.getOrCreateBwTexture(material.metadata.originalAlbedoTexture, scene);
            if (material.albedoTexture !== bwTex) material.albedoTexture = bwTex;
          } else {
            if (material.albedoTexture !== null) material.albedoTexture = null;
          }
          if (material.albedoColor && material.albedoColor.r !== 0.8 && !isCustomTint) {
            material.albedoColor.copyFromFloats(0.8, 0.8, 0.8);
          }
        } else {
          if (material.albedoTexture !== material.metadata.originalAlbedoTexture) {
            material.albedoTexture = material.metadata.originalAlbedoTexture;
          }
        }
      }

    } else if (material.getClassName().includes('Standard')) {
      if (material.allowShaderHotSwapping !== true) material.allowShaderHotSwapping = true;
      if (!material.ambientColor || !material.ambientColor.equals(c3Amb)) {
        material.ambientColor = c3Amb.clone();
      }
      
      if (!material.metadata) material.metadata = {};
      if (material.metadata.originalDiffuseTexture === undefined) {
        material.metadata.originalDiffuseTexture = material.diffuseTexture || null;
        material.metadata.originalDiffuseColor = material.diffuseColor ? material.diffuseColor.clone() : new Color3(0.8, 0.8, 0.8);
      }

      if (isCustomTint || textureSource === 'solid') {
        if (!material.diffuseColor || !material.diffuseColor.equals(c3Tint)) {
          material.diffuseColor = c3Tint.clone();
        }
      } else {
        if (material.metadata.originalDiffuseColor) {
          if (!material.diffuseColor || !material.diffuseColor.equals(material.metadata.originalDiffuseColor)) {
            material.diffuseColor.copyFrom(material.metadata.originalDiffuseColor);
          }
        }
      }

      const targetEmissive = esEmisivo 
        ? ((isCustomTint || textureSource === 'solid') ? c3Tint.scale(brillo) : (material.metadata.originalDiffuseColor || new Color3(1,1,1)).scale(brillo))
        : Color3.Black();

      if (!material.emissiveColor || !material.emissiveColor.equals(targetEmissive)) {
        material.emissiveColor = targetEmissive.clone();
      }

      if (textureSource === 'asset' && texturePath && scene) {
        let tex: any = new Texture('http://localhost:4000' + texturePath, scene);
        if (isBW) tex = await this.getOrCreateBwTexture(tex, scene);
        if (material.diffuseTexture !== tex) {
          material.diffuseTexture = tex;
        }
      } else if (textureSource === 'solid') {
        if (material.diffuseTexture !== null) {
          material.diffuseTexture = null;
        }
      } else {
        if (isBW && scene) {
          if (material.metadata.originalDiffuseTexture) {
            const bwTex = await this.getOrCreateBwTexture(material.metadata.originalDiffuseTexture, scene);
            if (material.diffuseTexture !== bwTex) material.diffuseTexture = bwTex;
          } else {
            if (material.diffuseTexture !== null) material.diffuseTexture = null;
          }
          if (material.diffuseColor && material.diffuseColor.r !== 0.8 && !isCustomTint) {
            material.diffuseColor.copyFromFloats(0.8, 0.8, 0.8);
          }
        } else {
          if (material.diffuseTexture !== material.metadata.originalDiffuseTexture) {
            material.diffuseTexture = material.metadata.originalDiffuseTexture;
          }
        }
      }
    }
  }

  public async prewarmMaterials(scene: Scene, customMeshes?: AbstractMesh[]): Promise<void> {
    if (!scene) return;

    const meshes = customMeshes || scene.meshes;
    const materialsToWarm = new Set<Material>();

    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m || m.isDisposed()) continue;
      if (m.material) {
        if (m.material.getClassName() === 'MultiMaterial') {
          const multi = m.material as MultiMaterial;
          if (multi.subMaterials) {
            for (let j = 0; j < multi.subMaterials.length; j++) {
              const sm = multi.subMaterials[j];
              if (sm) materialsToWarm.add(sm);
            }
          }
        } else {
          materialsToWarm.add(m.material);
        }
      }
    }

    const compilePromises: Promise<any>[] = [];

    materialsToWarm.forEach(mat => {
      if ((mat as any).maxSimultaneousLights !== CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS) {
        (mat as any).maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
      }

      const sampleMesh = meshes.find(m => 
        m.material === mat || 
        (m.material?.getClassName() === 'MultiMaterial' && (m.material as MultiMaterial).subMaterials?.includes(mat))
      );

      if (sampleMesh && typeof (mat as any).forceCompilationAsync === 'function') {
        compilePromises.push(
          (mat as any).forceCompilationAsync(sampleMesh).catch(() => {})
        );
      }
    });

    if (compilePromises.length > 0) {
      await Promise.all(compilePromises);
    }
  }

  private async getOrCreateBwTexture(originalTexture: Texture, scene: Scene): Promise<Texture> {
    if (!originalTexture || !originalTexture.name) return originalTexture;
    
    const cacheKey = originalTexture.name + "_bw_" + scene.uid;
    if (this.bwTextureCache.has(cacheKey)) {
      return this.bwTextureCache.get(cacheKey)!;
    }

    if (!originalTexture.isReady()) {
      await new Promise<void>((resolve) => {
        originalTexture.onLoadObservable.addOnce(() => resolve());
      });
    }

    try {
      const size = originalTexture.getSize();
      const pixels = await originalTexture.readPixels() as Uint8Array;
      
      if (!pixels) return originalTexture;

      const newPixels = new Uint8Array(pixels.length);
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i+1];
        const b = pixels[i+2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        newPixels[i] = gray;
        newPixels[i+1] = gray;
        newPixels[i+2] = gray;
        newPixels[i+3] = pixels[i+3]; 
      }

      const invertY = originalTexture.invertY ?? false;
      const rawTex = RawTexture.CreateRGBATexture(newPixels, size.width, size.height, scene, false, invertY, originalTexture.samplingMode ?? Texture.BILINEAR_SAMPLINGMODE);
      
      rawTex.uScale = originalTexture.uScale;
      rawTex.vScale = originalTexture.vScale;
      rawTex.uOffset = originalTexture.uOffset;
      rawTex.vOffset = originalTexture.vOffset;
      rawTex.wrapU = originalTexture.wrapU;
      rawTex.wrapV = originalTexture.wrapV;
      rawTex.coordinatesIndex = originalTexture.coordinatesIndex;
      rawTex.coordinatesMode = originalTexture.coordinatesMode;
      rawTex.uAng = originalTexture.uAng;
      rawTex.vAng = originalTexture.vAng;
      rawTex.wAng = originalTexture.wAng;

      rawTex.name = cacheKey;
      this.bwTextureCache.set(cacheKey, rawTex);
      
      return rawTex;
    } catch (e) {
      return originalTexture; 
    }
  }
}