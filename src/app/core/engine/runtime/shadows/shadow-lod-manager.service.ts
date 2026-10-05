
// file: src/app/core/engine/runtime/systems/lighting/shadow-lod-manager.service.ts
import { Injectable } from '@angular/core';
import { RenderTargetTexture } from '@babylonjs/core';
import { ShadowTier } from '../systems/lighting/lighting-types';
 
@Injectable({ providedIn: 'root' })
export class ShadowLODManager {
  /**
   * Calcula el refreshRate de Babylon.js considerando el Tier asignado y distancia.
   * 0 = RENDER_ONCE (Sombra congelada en VRAM, coste 0 tras el primer frame).
   * 1 = Cada frame (60 FPS) para Tier HIGH.
   * 2 = Cada 2 frames (30 FPS) para Tier MEDIUM.
   * 3 = Cada 3 frames (20 FPS) para Tier LOW.
   */
  public getRefreshRate(
    distToCam: number, 
    hasDynamicCasters: boolean, 
    isDynamicLight: boolean, 
    tier: ShadowTier = 'HIGH'
  ): number {
    // Si la luz y los objetos son estáticos, congelar
    if (!hasDynamicCasters && !isDynamicLight) {
      return RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }

    if (tier === 'HIGH') {
      return distToCam < 25 ? 1 : 2;
    } else if (tier === 'MEDIUM') {
      return distToCam < 30 ? 2 : 3;
    } else {
      // Tier LOW
      return 3;
    }
  }
}