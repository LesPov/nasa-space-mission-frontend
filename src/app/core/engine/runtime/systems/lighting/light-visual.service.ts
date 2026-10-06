
import { Injectable } from '@angular/core';
import { Color3, Tags, AbstractMesh } from '@babylonjs/core';
import { VirtualLight } from './lighting-types';

@Injectable({ providedIn: 'root' })
export class LightVisualService {

  private isMaterialDisposed(mat: any): boolean {
    if (!mat) return true;
    if (typeof mat.isDisposed === 'function') {
      return mat.isDisposed();
    }
    return mat.isDisposed === true || mat._isDisposed === true;
  }

  /**
   * Actualiza el resplandor visual (emissive materials) de las mallas 3D asociadas a una luz virtual,
   * calculando la intensidad real afectada por el multiplicador de distancia/fading actual.
   * Respeta los partOverrides del usuario para no forzar a negro texturas o brillos configurados.
   */
  public updateVisualGlow(vl: VirtualLight, lightComp: any, baseColor: Color3, disableLocalLights: boolean): void {
      if (!vl.entity.view) return;
      
      const visual = vl.entity.view.getChildMeshes(false).find((m: AbstractMesh) => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
      if (visual && visual.material && !this.isMaterialDisposed(visual.material)) {
          const vMat = visual.material as any;
          if (vMat.emissiveColor?.copyFrom) vMat.emissiveColor.copyFrom(baseColor);
          if (vMat.diffuseColor?.copyFrom) vMat.diffuseColor.copyFrom(baseColor);
      }

      let emissiveScale = ((lightComp?.intensity ?? 5) / 5) * vl.currentMultiplier;
      if (disableLocalLights || !lightComp?.enabled) emissiveScale = 0;

      const r = baseColor.r * emissiveScale; 
      const g = baseColor.g * emissiveScale; 
      const b = baseColor.b * emissiveScale;

      const applyEmissive = (mat: any) => {
        if (!mat || this.isMaterialDisposed(mat)) return;

        // Soporte recursivo para MultiMaterial
        if (mat.subMaterials && Array.isArray(mat.subMaterials)) {
          for (let k = 0; k < mat.subMaterials.length; k++) {
            applyEmissive(mat.subMaterials[k]);
          }
          return;
        }

        // Si el material tiene textura o es parte de un modelo con partOverrides no-emisivos, no aplastarlo
        if (mat.emissiveColor && typeof mat.emissiveColor.set === 'function') {
          mat.emissiveColor.set(r, g, b);
        }
      };

      for (let j = 0; j < vl.materials.length; j++) {
        applyEmissive(vl.materials[j]);
      }
  }
}