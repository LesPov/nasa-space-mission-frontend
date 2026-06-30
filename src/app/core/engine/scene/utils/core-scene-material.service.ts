
import { Injectable } from '@angular/core';
import { Color3, Texture, RawTexture, Scene, AbstractMesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class CoreSceneMaterialService {
  
  private bwTextureCache = new Map<string, Texture>();

  public asegurarMaterialUnico(mesh: AbstractMesh, uid: string): void {
      if (!mesh.material) return;
      
      if (!mesh.material.name.includes(uid)) {
          try {
              if (mesh.material.getClassName() === 'MultiMaterial') {
                  const multiMat = mesh.material as any;
                  const newMultiMat = multiMat.clone(multiMat.name + "_" + uid);
                  if (newMultiMat.subMaterials) {
                      newMultiMat.subMaterials = multiMat.subMaterials.map((subMat: any) => {
                          if (subMat && !subMat.name.includes(uid) && typeof subMat.clone === 'function') {
                              return subMat.clone(subMat.name + "_" + uid);
                          }
                          return subMat;
                      });
                  }
                  mesh.material = newMultiMat;
              } else if (typeof (mesh.material as any).clone === 'function') {
                  mesh.material = (mesh.material as any).clone(mesh.material.name + "_" + uid);
              }
          } catch (e) {
              console.warn("No se pudo clonar el material para hacerlo único:", e);
          }
      }
  }

  public async ajustarMaterialGLB(material: any, isBW: boolean = false, scene?: Scene, ambientColorHex?: string): Promise<void> {
    if (!material) return;
    
    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      for (const subMat of material.subMaterials) {
        await this.ajustarMaterialGLB(subMat, isBW, scene, ambientColorHex);
      }
      return;
    }
    
    // 🔥 FIX: Aumentamos la recepción de luces simultáneas para permitir sombras y focos 
    // sin que objetos se apaguen cuando se les acercan varias luces.
    if (material.maxSimultaneousLights !== 6) {
        material.maxSimultaneousLights = 6;
    }

    const c3Amb = ambientColorHex ? Color3.FromHexString(ambientColorHex) : new Color3(1, 1, 1);
    
    if (material.getClassName().includes('PBR')) {
      material.ambientColor = c3Amb;
      
      if (material.usePhysicalLightFalloff !== false) material.usePhysicalLightFalloff = false;
      if (material.metallic !== 0.1) material.metallic = 0.1;
      if (material.roughness !== 0.8) material.roughness = 0.8;
      if (material.environmentIntensity !== 0.5) material.environmentIntensity = 0.5;

      if (!material.metadata) material.metadata = {};
      if (material.metadata.originalAlbedoTexture === undefined) {
         material.metadata.originalAlbedoTexture = material.albedoTexture || null;
         material.metadata.originalAlbedoColor = material.albedoColor ? material.albedoColor.clone() : new Color3(0.8, 0.8, 0.8);
      }

      if (isBW && scene) {
         if (material.metadata.originalAlbedoTexture) {
             const bwTex = await this.getOrCreateBwTexture(material.metadata.originalAlbedoTexture, scene);
             if (material.albedoTexture !== bwTex) material.albedoTexture = bwTex;
         }
         if (material.albedoColor.r !== 0.8) material.albedoColor.copyFromFloats(0.8, 0.8, 0.8);
      } else {
         if (material.albedoTexture !== material.metadata.originalAlbedoTexture) {
             material.albedoTexture = material.metadata.originalAlbedoTexture;
         }
         if (!material.albedoColor.equals(material.metadata.originalAlbedoColor)) {
             material.albedoColor.copyFrom(material.metadata.originalAlbedoColor);
         }
      }
    } else if (material.getClassName().includes('Standard')) {
      material.ambientColor = c3Amb;
      
      if (!material.metadata) material.metadata = {};
      
      if (material.metadata.originalDiffuseTexture === undefined) {
         material.metadata.originalDiffuseTexture = material.diffuseTexture || null;
         material.metadata.originalDiffuseColor = material.diffuseColor ? material.diffuseColor.clone() : new Color3(0.8, 0.8, 0.8);
      }

      if (isBW && scene) {
         if (material.metadata.originalDiffuseTexture) {
             const bwTex = await this.getOrCreateBwTexture(material.metadata.originalDiffuseTexture, scene);
             if (material.diffuseTexture !== bwTex) material.diffuseTexture = bwTex;
         }
         if (material.diffuseColor.r !== 0.8) material.diffuseColor.copyFromFloats(0.8, 0.8, 0.8);
      } else {
         if (material.diffuseTexture !== material.metadata.originalDiffuseTexture) {
             material.diffuseTexture = material.metadata.originalDiffuseTexture;
         }
         if (!material.diffuseColor.equals(material.metadata.originalDiffuseColor)) {
             material.diffuseColor.copyFrom(material.metadata.originalDiffuseColor);
         }
      }
    }
  }

  private async getOrCreateBwTexture(originalTexture: Texture, scene: Scene): Promise<Texture> {
      if (!originalTexture || !originalTexture.name) return originalTexture;
      
      const cacheKey = originalTexture.name + "_bw";
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