
 
import { Injectable } from '@angular/core';
import { RenderTargetTexture } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class ShadowLODManager {
  /**
   * Calcula el refreshRate de Babylon.
   * 0 = RENDER_ONCE (Sombra congelada en VRAM, coste 0 tras el primer frame).
   * 1 = Actualiza cada frame (60 FPS).
   * 2 = Actualiza cada 2 frames (30 FPS).
   * 3 = Actualiza cada 3 frames (20 FPS).
   */
  public getRefreshRate(distToCam: number, hasDynamicCasters: boolean, isDynamicLight: boolean): number {
    // Si tanto la luz como todos los objetos que proyectan sombra son estáticos, congelamos la sombra.
    if (!hasDynamicCasters && !isDynamicLight) {
      return RenderTargetTexture.REFRESHRATE_RENDER_ONCE; // 0
    }

    // Si tiene elementos dinámicos (Jugador, NPCs o la propia luz se mueve), escalamos por distancia.
    if (distToCam < 20) {
      return 1; // Prioridad máxima
    } else if (distToCam < 45) {
      return 2; // Media distancia
    } else {
      return 3; // Lejanía
    }
  }
}