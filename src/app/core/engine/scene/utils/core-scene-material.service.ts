// file: src/app/core/engine/scene/utils/core-scene-material.service.ts
import { Injectable } from '@angular/core';
import { Color3, Texture, RawTexture, Scene, AbstractMesh, Material, MultiMaterial, Mesh } from '@babylonjs/core';

export interface MaterialWarmupReport {
  success: boolean;
  totalMaterials: number;
  compiledVariants: number;
  failedCount: number;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class CoreSceneMaterialService {
  public static readonly MAX_SIMULTANEOUS_LIGHTS = 10;
  
  private bwTextureCache = new Map<string, Texture>();

  public clearCache(): void {
    this.bwTextureCache.forEach(t => {
      if (t) {
        try { t.dispose(); } catch (e) {}
      }
    });
    this.bwTextureCache.clear();
  }

  private isMaterialDisposed(mat: any): boolean {
    if (!mat) return true;
    if (typeof mat.isDisposed === 'function') {
      return mat.isDisposed();
    }
    return mat.isDisposed === true || mat._isDisposed === true;
  }

  private cloneMetadataSafely(source: any, target: any): void {
    if (!source || !target) return;
    if (source.metadata) {
      target.metadata = {
        ...source.metadata,
        originalAlbedoColor: source.metadata.originalAlbedoColor ? source.metadata.originalAlbedoColor.clone() : undefined,
        originalDiffuseColor: source.metadata.originalDiffuseColor ? source.metadata.originalDiffuseColor.clone() : undefined,
        originalAmbientColor: source.metadata.originalAmbientColor ? source.metadata.originalAmbientColor.clone() : undefined,
        originalEmissiveColor: source.metadata.originalEmissiveColor ? source.metadata.originalEmissiveColor.clone() : undefined,
        originalSpecularColor: source.metadata.originalSpecularColor ? source.metadata.originalSpecularColor.clone() : undefined
      };
    }
  }

  public asegurarMaterialUnico(mesh: AbstractMesh, uid: string): Material | null {
    if (!mesh.material) return null;
    
    const targetName = `${mesh.material.name}_${uid}`;
    if (mesh.material.name.endsWith(`_${uid}`)) {
      return mesh.material;
    }

    const scene = mesh.getScene();
    if (scene) {
      const existing = scene.getMaterialByName(targetName);
      if (existing && !this.isMaterialDisposed(existing)) {
        mesh.material = existing;
        return existing;
      }
    }

    try {
      if (mesh.material.getClassName() === 'MultiMaterial') {
        const multiMat = mesh.material as MultiMaterial;
        const newMultiMat = multiMat.clone(targetName);
        if (newMultiMat.subMaterials) {
          newMultiMat.subMaterials = multiMat.subMaterials.map((subMat: Material | null) => {
            if (subMat && !this.isMaterialDisposed(subMat) && typeof (subMat as any).clone === 'function') {
              const subTargetName = `${subMat.name}_${uid}`;
              const existingSub = scene?.getMaterialByName(subTargetName);
              if (existingSub && !this.isMaterialDisposed(existingSub)) return existingSub;

              const cloned = (subMat as any).clone(subTargetName);
              cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
              this.cloneMetadataSafely(subMat, cloned);
              return cloned;
            }
            return subMat;
          });
        }
        mesh.material = newMultiMat;
        return newMultiMat;
      } else if (typeof (mesh.material as any).clone === 'function') {
        const cloned = (mesh.material as any).clone(targetName);
        cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
        this.cloneMetadataSafely(mesh.material, cloned);
        mesh.material = cloned;
        return cloned;
      }
    } catch (e) {
      console.warn("[CoreSceneMaterialService] No se pudo clonar el material para hacerlo único:", e);
    }
    return mesh.material;
  }

  public asegurarMaterialUnicoParaParte(mesh: AbstractMesh, uid: string, partName: string): Material | null {
    if (!mesh.material) return null;
    
    const cleanPart = partName.replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueSuffix = `${uid}_${cleanPart}`;
    const targetName = `${mesh.material.name}_${uniqueSuffix}`;

    if (mesh.material.name.includes(uniqueSuffix)) {
      return mesh.material;
    }

    const scene = mesh.getScene();
    if (scene) {
      const existing = scene.getMaterialByName(targetName);
      if (existing && !this.isMaterialDisposed(existing)) {
        mesh.material = existing;
        return existing;
      }
    }

    try {
      if (mesh.material.getClassName() === 'MultiMaterial') {
        const multiMat = mesh.material as MultiMaterial;
        const newMultiMat = multiMat.clone(targetName);
        if (newMultiMat.subMaterials) {
          newMultiMat.subMaterials = multiMat.subMaterials.map((subMat: Material | null) => {
            if (subMat && !this.isMaterialDisposed(subMat) && typeof (subMat as any).clone === 'function') {
              const subTargetName = `${subMat.name}_${uniqueSuffix}`;
              const existingSub = scene?.getMaterialByName(subTargetName);
              if (existingSub && !this.isMaterialDisposed(existingSub)) return existingSub;

              const cloned = (subMat as any).clone(subTargetName);
              cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
              this.cloneMetadataSafely(subMat, cloned);
              return cloned;
            }
            return subMat;
          });
        }
        mesh.material = newMultiMat;
        return newMultiMat;
      } else if (typeof (mesh.material as any).clone === 'function') {
        const cloned = (mesh.material as any).clone(targetName);
        cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
        this.cloneMetadataSafely(mesh.material, cloned);
        mesh.material = cloned;
        return cloned;
      }
    } catch (e) {
      console.warn("[CoreSceneMaterialService] No se pudo clonar el material para hacerlo único por parte:", e);
    }
    return mesh.material;
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
    textureSource: 'original' | 'solid' | 'asset' = 'original',
    isExplicitOverride: boolean = false
  ): Promise<void> {
    if (!material || this.isMaterialDisposed(material)) return;
    
    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      for (const subMat of material.subMaterials) {
        if (subMat && !this.isMaterialDisposed(subMat)) {
          await this.ajustarMaterialGLB(
            subMat, isBW, scene, ambientColorHex, colorHex, 
            esEmisivo, brilloIntensidad, texturePath, textureSource, isExplicitOverride
          );
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

    if (material.getClassName().includes('PBR')) {
      if (material.allowShaderHotSwapping !== true) material.allowShaderHotSwapping = true;

      // Habilitar iluminación por ambas caras para que las paredes y tuberías interiores de 1 sola cara se iluminen
      material.twoSidedLighting = true;
      material.backFaceCulling = false;

      // Desactivar atenuación física cuadrática inversa extrema para que el interior brille de forma uniforme
      material.usePhysicalLightFalloff = false;

      if (!material.metadata) material.metadata = {};
      if (material.metadata.pbrOriginalsCaptured !== true) {
        material.metadata.pbrOriginalsCaptured = true;
        material.metadata.originalAlbedoTexture = material.albedoTexture || null;
        material.metadata.originalAlbedoColor = material.albedoColor ? material.albedoColor.clone() : new Color3(1, 1, 1);
        material.metadata.originalMetallic = material.metallic ?? 0.0;
        material.metadata.originalRoughness = material.roughness ?? 0.5;
        material.metadata.originalMetallicTexture = material.metallicTexture || null;
        material.metadata.originalBumpTexture = material.bumpTexture || null;
        material.metadata.originalAmbientTexture = material.ambientTexture || null;
        material.metadata.originalEmissiveColor = material.emissiveColor ? material.emissiveColor.clone() : Color3.Black();
        material.metadata.originalEmissiveTexture = material.emissiveTexture || null;
        material.metadata.originalEnvironmentIntensity = material.environmentIntensity ?? 1.0;
      }

      // Evitar que roughness o metallic excesivos apaguen totalmente la luz difusa en interiores
      if (material.roughness !== undefined && material.roughness > 0.95) {
        material.roughness = 0.85;
      }

      // MANEJO DE TEXTURAS Y COLOR
      if (isExplicitOverride && textureSource === 'solid') {
        material.albedoTexture = null;
        material.albedoColor = c3Tint.clone();
      } else if (isExplicitOverride && textureSource === 'asset' && texturePath && scene) {
        let tex: any = new Texture('http://localhost:4000' + texturePath, scene);
        if (isBW) tex = await this.getOrCreateBwTexture(tex, scene);
        material.albedoTexture = tex;
        material.albedoColor = c3Tint.clone();
      } else {
        // Modo original con tint o color directo
        if (isBW && scene) {
          if (material.metadata.originalAlbedoTexture) {
            const bwTex = await this.getOrCreateBwTexture(material.metadata.originalAlbedoTexture, scene);
            material.albedoTexture = bwTex;
          } else {
            material.albedoTexture = null;
          }
        } else {
          material.albedoTexture = material.metadata.originalAlbedoTexture;
        }

        // Si el usuario seleccionó un color en el editor, aplicarlo como tinte sobre el albedo
        if (isExplicitOverride && colorHex) {
          material.albedoColor = c3Tint.clone();
        } else if (material.metadata.originalAlbedoColor) {
          material.albedoColor.copyFrom(material.metadata.originalAlbedoColor);
        }
      }

      // EMISIÓN Y BRILLO
      if (esEmisivo) {
        const emissiveBase = colorHex ? c3Tint : (material.metadata.originalAlbedoColor || Color3.White());
        material.emissiveColor = emissiveBase.scale(brillo);
      } else {
        if (material.metadata.originalEmissiveColor) {
          material.emissiveColor.copyFrom(material.metadata.originalEmissiveColor);
        } else {
          material.emissiveColor = Color3.Black();
        }
        if (material.metadata.originalEmissiveTexture !== undefined) {
          material.emissiveTexture = material.metadata.originalEmissiveTexture;
        }
      }

    } else if (material.getClassName().includes('Standard')) {
      if (material.allowShaderHotSwapping !== true) material.allowShaderHotSwapping = true;

      material.twoSidedLighting = true;
      material.backFaceCulling = false;

      if (!material.metadata) material.metadata = {};
      if (material.metadata.stdOriginalsCaptured !== true) {
        material.metadata.stdOriginalsCaptured = true;
        material.metadata.originalDiffuseTexture = material.diffuseTexture || null;
        material.metadata.originalDiffuseColor = material.diffuseColor ? material.diffuseColor.clone() : new Color3(1, 1, 1);
        material.metadata.originalAmbientColor = material.ambientColor ? material.ambientColor.clone() : Color3.Black();
        material.metadata.originalEmissiveColor = material.emissiveColor ? material.emissiveColor.clone() : Color3.Black();
        material.metadata.originalEmissiveTexture = material.emissiveTexture || null;
        material.metadata.originalSpecularColor = material.specularColor ? material.specularColor.clone() : new Color3(0, 0, 0);
      }

      if (isExplicitOverride && textureSource === 'solid') {
        material.diffuseTexture = null;
        material.diffuseColor = c3Tint.clone();
      } else if (isExplicitOverride && textureSource === 'asset' && texturePath && scene) {
        let tex: any = new Texture('http://localhost:4000' + texturePath, scene);
        if (isBW) tex = await this.getOrCreateBwTexture(tex, scene);
        material.diffuseTexture = tex;
        material.diffuseColor = c3Tint.clone();
      } else {
        if (isBW && scene) {
          if (material.metadata.originalDiffuseTexture) {
            const bwTex = await this.getOrCreateBwTexture(material.metadata.originalDiffuseTexture, scene);
            material.diffuseTexture = bwTex;
          } else {
            material.diffuseTexture = null;
          }
        } else {
          material.diffuseTexture = material.metadata.originalDiffuseTexture;
        }

        if (isExplicitOverride && colorHex) {
          material.diffuseColor = c3Tint.clone();
        } else if (material.metadata.originalDiffuseColor) {
          material.diffuseColor.copyFrom(material.metadata.originalDiffuseColor);
        }
      }

      if (esEmisivo) {
        const emissiveBase = colorHex ? c3Tint : (material.metadata.originalDiffuseColor || Color3.White());
        material.emissiveColor = emissiveBase.scale(brillo);
      } else {
        if (material.metadata.originalEmissiveColor) {
          material.emissiveColor.copyFrom(material.metadata.originalEmissiveColor);
        } else {
          material.emissiveColor = Color3.Black();
        }
        if (material.metadata.originalEmissiveTexture !== undefined) {
          material.emissiveTexture = material.metadata.originalEmissiveTexture;
        }
      }
    }
  }

  public isMaterialReadyForMesh(material: Material | null | undefined, mesh?: AbstractMesh | null): boolean {
    if (!material || this.isMaterialDisposed(material)) return true;

    if (material.getClassName() === 'MultiMaterial') {
      const multi = material as MultiMaterial;
      const subs = multi.subMaterials || [];
      if (subs.length === 0) return true;
      for (let i = 0; i < subs.length; i++) {
        const sm = subs[i];
        if (sm && !this.isMaterialReadyForMesh(sm, mesh)) return false;
      }
      return true;
    }

    if (mesh && !mesh.isDisposed()) {
      const subMesh = mesh.subMeshes && mesh.subMeshes.length > 0 ? mesh.subMeshes[0] : null;
      if (subMesh && typeof (material as any).isReadyForSubMesh === 'function') {
        return (material as any).isReadyForSubMesh(mesh, subMesh, false);
      }
      if (typeof material.isReady === 'function') {
        return material.isReady(mesh, false);
      }
    }

    if (typeof (material as any).getEffect === 'function') {
      const effect = (material as any).getEffect();
      if (effect) {
        return effect.isReady();
      }
    }

    if (typeof material.isReady === 'function') {
      return material.isReady(undefined, false);
    }

    return true;
  }

  public async prewarmMaterials(scene: Scene, customMeshes?: AbstractMesh[]): Promise<MaterialWarmupReport> {
    const tStart = performance.now();
    if (!scene) {
      return { success: false, totalMaterials: 0, compiledVariants: 0, failedCount: 0, durationMs: 0 };
    }

    const wasFogEnabled = scene.fogEnabled;
    const prevFogMode = scene.fogMode;
    scene.fogEnabled = true;
    if (scene.fogMode === Scene.FOGMODE_NONE) {
      scene.fogMode = Scene.FOGMODE_LINEAR;
    }

    const meshes = customMeshes || scene.meshes;
    const compileTasks: Array<{ mat: Material; mesh: AbstractMesh }> = [];
    const seenPairs = new Set<string>();
    const uniqueMaterials = new Set<Material>();

    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m || m.isDisposed() || !m.material) continue;

      const mat = m.material;
      const isSkinned = (m instanceof Mesh) && (m.skeleton !== null && m.skeleton !== undefined);
      const meshKey = `${mat.uniqueId}_${isSkinned ? 'skinned' : 'static'}_${m.receiveShadows ? 'shadows' : 'noshadows'}`;

      if (seenPairs.has(meshKey)) continue;
      seenPairs.add(meshKey);

      if (mat.getClassName() === 'MultiMaterial') {
        const multi = mat as MultiMaterial;
        const subs = multi.subMaterials || [];
        for (let j = 0; j < subs.length; j++) {
          const sm = subs[j];
          if (sm && !this.isMaterialDisposed(sm)) {
            (sm as any).maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
            uniqueMaterials.add(sm);
            if (!this.isMaterialReadyForMesh(sm, m)) {
              compileTasks.push({ mat: sm, mesh: m });
            }
          }
        }
      } else {
        (mat as any).maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
        uniqueMaterials.add(mat);
        if (!this.isMaterialReadyForMesh(mat, m)) {
          compileTasks.push({ mat, mesh: m });
        }
      }
    }

    let compiledVariants = 0;
    let failedCount = 0;
    const MAX_PARALLEL_BATCH = 15;
    const TASK_TIMEOUT_MS = 600;

    for (let i = 0; i < compileTasks.length; i += MAX_PARALLEL_BATCH) {
      const batch = compileTasks.slice(i, i + MAX_PARALLEL_BATCH);
      const batchPromises = batch.map(task => {
        if (typeof (task.mat as any).forceCompilationAsync === 'function') {
          const compilePromise = (task.mat as any).forceCompilationAsync(task.mesh).then(() => {
            compiledVariants++;
          }).catch(() => {
            failedCount++;
          });

          const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, TASK_TIMEOUT_MS));
          return Promise.race([compilePromise, timeoutPromise]);
        }
        return Promise.resolve();
      });

      await Promise.all(batchPromises);
    }

    const duration = performance.now() - tStart;
    return {
      success: failedCount === 0,
      totalMaterials: uniqueMaterials.size,
      compiledVariants,
      failedCount,
      durationMs: parseFloat(duration.toFixed(2))
    };
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