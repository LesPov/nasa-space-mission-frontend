// file: src/app/core/engine/runtime/systems/lighting/light-visual.service.ts
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
   * Actualiza el resplandor visual exclusivamente de la bombilla de la luz o de la propia entidad de luz.
   * NUNCA muta mallas estructurales de modelos padre (como pasillos, techos o paredes).
   */
  public updateVisualGlow(vl: VirtualLight, lightComp: any, baseColor: Color3, disableLocalLights: boolean): void {
    if (!vl.entity.view) return;

    // 1. Resplandor de la esfera visual de la luz (marcador 3D)
    const visual = vl.entity.view.getChildMeshes(false).find(
      (m: AbstractMesh) => Tags.MatchesQuery(m, 'light_visual') || (m as any).metadata?.isLightVisual
    );
    if (visual && visual.material && !this.isMaterialDisposed(visual.material)) {
      const vMat = visual.material as any;
      if (vMat.emissiveColor?.copyFrom) vMat.emissiveColor.copyFrom(baseColor);
      if (vMat.diffuseColor?.copyFrom) vMat.diffuseColor.copyFrom(baseColor);
    }

    // 2. Si la entidad tiene un modelo 3D propio (foco/lámpara), ajustar su material emisivo
    // SOLO si la entidad es de tipo light y no un modelo de escenario
    if (!vl.entity.type.startsWith('light_')) return;

    let emissiveScale = ((lightComp?.intensity ?? 5) / 5) * vl.currentMultiplier;
    if (disableLocalLights || !lightComp?.enabled) emissiveScale = 0;

    const r = baseColor.r * emissiveScale; 
    const g = baseColor.g * emissiveScale; 
    const b = baseColor.b * emissiveScale;

    for (let j = 0; j < vl.materials.length; j++) {
      const mat = vl.materials[j];
      if (!mat || this.isMaterialDisposed(mat)) continue;

      // Solo aplicar emisivo a materiales explícitamente marcados como focos o bombillas
      const isBulbMat = mat.name.toLowerCase().includes('bulb') ||
                        mat.name.toLowerCase().includes('light_visual') ||
                        mat.name.toLowerCase().includes('mat_visual');

      if (isBulbMat && mat.emissiveColor && typeof mat.emissiveColor.set === 'function') {
        mat.emissiveColor.set(r, g, b);
      }
    }
  }
}