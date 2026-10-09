// file: src/app/core/engine/scene/utils/core-scene-material.service.ts
import { Injectable } from '@angular/core';
import { Color3, Texture, RawTexture, Scene, AbstractMesh, Material, MultiMaterial, Mesh, Tags } from '@babylonjs/core';

export interface MaterialWarmupReport {
  success: boolean;
  totalMaterials: number;
  compiledVariants: number;
  failedCount: number;
  durationMs: number;
}

interface MaterialAuthoringSnapshot {
  albedoTexture?: Texture | null;
  diffuseTexture?: Texture | null;
  opacityTexture?: Texture | null;
  emissiveTexture?: Texture | null;
  bumpTexture?: Texture | null;
  albedoColor?: Color3;
  diffuseColor?: Color3;
  emissiveColor?: Color3;
  alpha?: number;
}

@Injectable({ providedIn: 'root' })
export class CoreSceneMaterialService {
  public static readonly MAX_SIMULTANEOUS_LIGHTS = 8;
  
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

  private isTextureDisposed(texture: Texture | null | undefined): boolean {
    return !texture || (typeof (texture as any).isDisposed === 'function' && (texture as any).isDisposed());
  }

  /**
   * Captura el estado autoral inmutable del material antes de que cualquier sistema de runtime lo mute.
   * Si ya existe un snapshot capturado para este material, no se sobrescribe.
   */
  public capturarEstadoAutoral(material: any): void {
    if (!material || this.isMaterialDisposed(material)) return;

    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      for (const sub of material.subMaterials) {
        if (sub) this.capturarEstadoAutoral(sub);
      }
      return;
    }

    if (!material.metadata) material.metadata = {};
    if (material.metadata.__authoringSnapshot) return;

    const snapshot: MaterialAuthoringSnapshot = {};

    if (material.getClassName().includes('PBR')) {
      snapshot.albedoTexture = material.albedoTexture || null;
      snapshot.emissiveTexture = material.emissiveTexture || null;
      snapshot.bumpTexture = material.bumpTexture || null;
      snapshot.albedoColor = material.albedoColor ? material.albedoColor.clone() : new Color3(1, 1, 1);
      snapshot.emissiveColor = material.emissiveColor ? material.emissiveColor.clone() : Color3.Black();
      snapshot.alpha = material.alpha ?? 1.0;
    } else if (material.getClassName().includes('Standard')) {
      snapshot.diffuseTexture = material.diffuseTexture || null;
      snapshot.opacityTexture = material.opacityTexture || null;
      snapshot.emissiveTexture = material.emissiveTexture || null;
      snapshot.bumpTexture = material.bumpTexture || null;
      snapshot.diffuseColor = material.diffuseColor ? material.diffuseColor.clone() : new Color3(1, 1, 1);
      snapshot.emissiveColor = material.emissiveColor ? material.emissiveColor.clone() : Color3.Black();
      snapshot.alpha = material.alpha ?? 1.0;
    }

    material.metadata.__authoringSnapshot = snapshot;
  }

  /**
   * Restaura con fidelidad absoluta los punteros a texturas y colores originales capturados para el Editor.
   * Evita destruir texturas compartidas en el proceso.
   */
  public restaurarEstadoAutoral(material: any): void {
    if (!material || this.isMaterialDisposed(material)) return;

    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      for (const sub of material.subMaterials) {
        if (sub) this.restaurarEstadoAutoral(sub);
      }
      return;
    }

    const snapshot = material.metadata?.__authoringSnapshot as MaterialAuthoringSnapshot | undefined;
    if (!snapshot) return;

    if (material.getClassName().includes('PBR')) {
      if (snapshot.albedoTexture && !this.isTextureDisposed(snapshot.albedoTexture)) {
        material.albedoTexture = snapshot.albedoTexture;
      }
      if (snapshot.emissiveTexture && !this.isTextureDisposed(snapshot.emissiveTexture)) {
        material.emissiveTexture = snapshot.emissiveTexture;
      }
      if (snapshot.bumpTexture && !this.isTextureDisposed(snapshot.bumpTexture)) {
        material.bumpTexture = snapshot.bumpTexture;
      }
      material.albedoColor = snapshot.albedoColor ? snapshot.albedoColor.clone() : new Color3(1, 1, 1);
      material.emissiveColor = snapshot.emissiveColor ? snapshot.emissiveColor.clone() : Color3.Black();
      if (snapshot.alpha !== undefined) material.alpha = snapshot.alpha;
    } else if (material.getClassName().includes('Standard')) {
      if (snapshot.diffuseTexture && !this.isTextureDisposed(snapshot.diffuseTexture)) {
        material.diffuseTexture = snapshot.diffuseTexture;
      }
      if (snapshot.opacityTexture && !this.isTextureDisposed(snapshot.opacityTexture)) {
        material.opacityTexture = snapshot.opacityTexture;
      }
      if (snapshot.emissiveTexture && !this.isTextureDisposed(snapshot.emissiveTexture)) {
        material.emissiveTexture = snapshot.emissiveTexture;
      }
      if (snapshot.bumpTexture && !this.isTextureDisposed(snapshot.bumpTexture)) {
        material.bumpTexture = snapshot.bumpTexture;
      }
      material.diffuseColor = snapshot.diffuseColor ? snapshot.diffuseColor.clone() : new Color3(1, 1, 1);
      material.emissiveColor = snapshot.emissiveColor ? snapshot.emissiveColor.clone() : Color3.Black();
      if (snapshot.alpha !== undefined) material.alpha = snapshot.alpha;
    }
  }

  public asegurarMaterialUnico(mesh: AbstractMesh, uid: string): Material | null {
    if (!mesh.material) return null;
    
    this.capturarEstadoAutoral(mesh.material);

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
              this.capturarEstadoAutoral(subMat);
              const subTargetName = `${subMat.name}_${uid}`;
              const existingSub = scene?.getMaterialByName(subTargetName);
              if (existingSub && !this.isMaterialDisposed(existingSub)) return existingSub;

              const cloned = (subMat as any).clone(subTargetName);
              cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
              this.capturarEstadoAutoral(cloned);
              return cloned;
            }
            return subMat;
          });
        }
        mesh.material = newMultiMat;
        this.capturarEstadoAutoral(newMultiMat);
        return newMultiMat;
      } else if (typeof (mesh.material as any).clone === 'function') {
        const cloned = (mesh.material as any).clone(targetName);
        cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
        this.capturarEstadoAutoral(cloned);
        mesh.material = cloned;
        return cloned;
      }
    } catch (e) {
      console.warn("[CoreSceneMaterialService] Fallo al clonar material:", e);
    }
    return mesh.material;
  }

  public asegurarMaterialUnicoParaParte(mesh: AbstractMesh, uid: string, partName: string): Material | null {
    if (!mesh.material) return null;
    
    this.capturarEstadoAutoral(mesh.material);

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
              this.capturarEstadoAutoral(subMat);
              const subTargetName = `${subMat.name}_${uniqueSuffix}`;
              const existingSub = scene?.getMaterialByName(subTargetName);
              if (existingSub && !this.isMaterialDisposed(existingSub)) return existingSub;

              const cloned = (subMat as any).clone(subTargetName);
              cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
              this.capturarEstadoAutoral(cloned);
              return cloned;
            }
            return subMat;
          });
        }
        mesh.material = newMultiMat;
        this.capturarEstadoAutoral(newMultiMat);
        return newMultiMat;
      } else if (typeof (mesh.material as any).clone === 'function') {
        const cloned = (mesh.material as any).clone(targetName);
        cloned.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
        this.capturarEstadoAutoral(cloned);
        mesh.material = cloned;
        return cloned;
      }
    } catch (e) {
      console.warn("[CoreSceneMaterialService] Fallo al clonar material único para parte:", e);
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
    
    this.capturarEstadoAutoral(material);

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
    
    material.maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;

    const snapshot = material.metadata?.__authoringSnapshot as MaterialAuthoringSnapshot | undefined;

    if (!isExplicitOverride && !isBW && !esEmisivo) {
      if (snapshot) {
        this.restaurarEstadoAutoral(material);
      }
      return;
    }

    const c3Tint = colorHex ? Color3.FromHexString(colorHex) : new Color3(1, 1, 1);
    const brillo = Math.max(0, Math.min(10, brilloIntensidad));

    if (material.getClassName().includes('PBR')) {
      material.allowShaderHotSwapping = true;

      const baseAlbedoTex = snapshot?.albedoTexture ?? material.albedoTexture;
      const baseAlbedoColor = snapshot?.albedoColor ?? material.albedoColor ?? Color3.White();

      if (isExplicitOverride && textureSource === 'solid') {
        material.albedoTexture = null;
        material.albedoColor = c3Tint.clone();
      } else if (isExplicitOverride && textureSource === 'asset' && texturePath && scene) {
        let tex: any = new Texture('http://localhost:4000' + texturePath, scene);
        if (isBW) tex = await this.getOrCreateBwTexture(tex, scene);
        material.albedoTexture = tex;
        material.albedoColor = Color3.White();
      } else {
        if (isBW && scene && baseAlbedoTex) {
          material.albedoTexture = await this.getOrCreateBwTexture(baseAlbedoTex, scene);
        } else if (baseAlbedoTex && !this.isTextureDisposed(baseAlbedoTex)) {
          material.albedoTexture = baseAlbedoTex;
        }

        const isBlackColor = colorHex === '#000000' || (colorHex && c3Tint.r === 0 && c3Tint.g === 0 && c3Tint.b === 0);
        if (isExplicitOverride && colorHex && !isBlackColor) {
          material.albedoColor = c3Tint.clone();
        } else {
          material.albedoColor = Color3.White();
        }
      }

      if (esEmisivo) {
        const emissiveBase = (colorHex && colorHex !== '#000000') ? c3Tint : baseAlbedoColor;
        material.emissiveColor = emissiveBase.scale(brillo);
      } else if (snapshot?.emissiveColor) {
        material.emissiveColor.copyFrom(snapshot.emissiveColor);
      }

    } else if (material.getClassName().includes('Standard')) {
      material.allowShaderHotSwapping = true;

      const baseDiffTex = snapshot?.diffuseTexture ?? material.diffuseTexture;
      const baseDiffColor = snapshot?.diffuseColor ?? material.diffuseColor ?? Color3.White();

      if (isExplicitOverride && textureSource === 'solid') {
        material.diffuseTexture = null;
        material.diffuseColor = c3Tint.clone();
      } else if (isExplicitOverride && textureSource === 'asset' && texturePath && scene) {
        let tex: any = new Texture('http://localhost:4000' + texturePath, scene);
        if (isBW) tex = await this.getOrCreateBwTexture(tex, scene);
        material.diffuseTexture = tex;
        material.diffuseColor = Color3.White();
      } else {
        if (isBW && scene && baseDiffTex) {
          material.diffuseTexture = await this.getOrCreateBwTexture(baseDiffTex, scene);
        } else if (baseDiffTex && !this.isTextureDisposed(baseDiffTex)) {
          material.diffuseTexture = baseDiffTex;
        }

        const isBlackColor = colorHex === '#000000' || (colorHex && c3Tint.r === 0 && c3Tint.g === 0 && c3Tint.b === 0);
        if (isExplicitOverride && colorHex && !isBlackColor) {
          material.diffuseColor = c3Tint.clone();
        } else {
          material.diffuseColor = Color3.White();
        }
      }

      if (esEmisivo) {
        const emissiveBase = (colorHex && colorHex !== '#000000') ? c3Tint : baseDiffColor;
        material.emissiveColor = emissiveBase.scale(brillo);
      } else if (snapshot?.emissiveColor) {
        material.emissiveColor.copyFrom(snapshot.emissiveColor);
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

    const anyMat = material as any;
    const texturesToCheck: Array<Texture | null | undefined> = [
      anyMat.albedoTexture, anyMat.diffuseTexture, anyMat.opacityTexture,
      anyMat.emissiveTexture, anyMat.bumpTexture
    ];

    for (let t = 0; t < texturesToCheck.length; t++) {
      const tex = texturesToCheck[t];
      if (tex && typeof tex.isReady === 'function') {
        if (!tex.isReady()) return false;
      }
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

    const isNullEngine = scene.getEngine().getClassName() === 'NullEngine';
    const meshes = customMeshes || scene.meshes;
    const compileTasks: Array<{ mat: Material; mesh: AbstractMesh }> = [];
    const seenPairs = new Set<string>();
    const uniqueMaterials = new Set<Material>();

    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m || m.isDisposed() || !m.material) continue;

      if (Tags.MatchesQuery(m, "system_element || editor_only || proxy_collider || debug_element || invisible_floor")) {
        continue;
      }

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

    if (isNullEngine) {
      return {
        success: true,
        totalMaterials: uniqueMaterials.size,
        compiledVariants: 0,
        failedCount: 0,
        durationMs: 0.1
      };
    }

    let compiledVariants = 0;
    let failedCount = 0;
    const MAX_PARALLEL_BATCH = 12;

    for (let i = 0; i < compileTasks.length; i += MAX_PARALLEL_BATCH) {
      const batch = compileTasks.slice(i, i + MAX_PARALLEL_BATCH);
      
      const batchPromises = batch.map(task => {
        if (typeof (task.mat as any).forceCompilationAsync === 'function') {
          const compilePromise = (task.mat as any).forceCompilationAsync(task.mesh).then(() => {
            compiledVariants++;
          }).catch(() => {
            failedCount++;
          });

          const timeoutGuard = new Promise((resolve) => setTimeout(resolve, 2500));
          return Promise.race([compilePromise, timeoutGuard]);
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

      rawTex.name = cacheKey;
      this.bwTextureCache.set(cacheKey, rawTex);
      
      return rawTex;
    } catch (e) {
      return originalTexture; 
    }
  }
}