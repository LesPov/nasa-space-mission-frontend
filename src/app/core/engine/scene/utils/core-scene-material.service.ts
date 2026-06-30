
import { Injectable } from '@angular/core';
import { Color3, Texture, RawTexture, Scene } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class CoreSceneMaterialService {
  
  private bwTextureCache = new Map<string, Texture>();

  public async ajustarMaterialGLB(material: any, isBW: boolean = false, scene?: Scene): Promise<void> {
    if (!material) return;
    
    // Si ya lo procesamos, saltarlo para evitar recompilar y GC
    if (material.metadata && material.metadata.isProcessedForLighting) return;
    
    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      for (const subMat of material.subMaterials) {
        await this.ajustarMaterialGLB(subMat, isBW, scene);
      }
      return;
    }
    
    // 🔥 OPTIMIZACIÓN LÍMITE LUCES: Lo limitamos a 4 luces por objeto (estándar óptimo de videojuegos)
    // Esto evita recompilaciones de shaders y destruye el lag de luces dinámicas en tiempo real.
    if (material.maxSimultaneousLights !== 4) {
        material.maxSimultaneousLights = 4;
    }
    
    if (material.getClassName().includes('PBR')) {
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