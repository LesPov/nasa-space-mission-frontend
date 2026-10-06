
// file: src/app/core/engine/runtime/shadows/shadow-lod-manager.service.ts
import { Injectable } from '@angular/core';
import { RenderTargetTexture } from '@babylonjs/core';
import { ShadowTier } from '../systems/lighting/lighting-types';
 
@Injectable({ providedIn: 'root' })
export class ShadowLODManager {
  /**
   * Calcula el refreshRate inteligente de BabylonJS considerando movimiento y distancia.
   * 0 = RENDER_ONCE (Sombra congelada en VRAM, coste 0 GPU).
   * 1 = Cada frame (60 FPS).
   * 2 = Cada 2 frames (30 FPS).
   * 3 = Cada 3 frames (20 FPS).
   */
  public getRefreshRate(
    distToCam: number, 
    hasDynamicCasters: boolean, 
    isDynamicLight: boolean, 
    tier: ShadowTier = 'HIGH',
    isMoving: boolean = true
  ): number {
    
    // 1. Congelación Absoluta: Sin elementos dinámicos
    if (!hasDynamicCasters && !isDynamicLight) {
      return RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }

    // 2. SMART FREEZE (Kinetic Freeze): La luz y los actores existen, pero nadie se mueve
    if (!isMoving && !isDynamicLight) {
      return RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }

    // 3. Modos activos escalonados por distancia y calidad
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