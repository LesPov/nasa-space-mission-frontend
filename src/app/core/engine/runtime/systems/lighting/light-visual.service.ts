import { Injectable } from '@angular/core';
import { Color3, StandardMaterial, Tags, AbstractMesh } from '@babylonjs/core';
import { VirtualLight } from './lighting-types';

@Injectable({ providedIn: 'root' })
export class LightVisualService {

  /**
   * Actualiza el resplandor visual (emissive materials) de las mallas 3D asociadas a una luz virtual,
   * calculando la intensidad real afectada por el multiplicador de distancia/fading actual.
   */
  public updateVisualGlow(vl: VirtualLight, lightComp: any, baseColor: Color3, disableLocalLights: boolean): void {
      if (!vl.entity.view) return;
      
      const visual = vl.entity.view.getChildMeshes(false).find((m: AbstractMesh) => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
      if (visual && visual.material && visual.material instanceof StandardMaterial) {
          visual.material.emissiveColor.copyFrom(baseColor);
          visual.material.diffuseColor.copyFrom(baseColor);
      }

      let emissiveScale = (lightComp.intensity / 5) * vl.currentMultiplier;
      if (disableLocalLights || !lightComp.enabled) emissiveScale = 0;

      const r = baseColor.r * emissiveScale; 
      const g = baseColor.g * emissiveScale; 
      const b = baseColor.b * emissiveScale;

      for (let j = 0; j < vl.materials.length; j++) {
          const mat = vl.materials[j];
          if (mat && !mat.isDisposed()) {
              if (mat.emissiveColor) mat.emissiveColor.set(r, g, b);
          }
      }
  }
}