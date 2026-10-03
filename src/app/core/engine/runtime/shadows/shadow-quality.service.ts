// RUTA: src/app/core/engine/runtime/shadows/shadow-quality.service.ts
// ACCIÓN: MODIFICAR

import { Injectable } from '@angular/core';
import { ShadowGenerator } from '@babylonjs/core';

export type ShadowQualityTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ShadowConfig {
  resolution: number;
  filteringQuality: number;
  cascades?: number;
}

@Injectable({ providedIn: 'root' })
export class ShadowQualityService {
  private currentTier: ShadowQualityTier = 'HIGH';

  public getQualityTier(): ShadowQualityTier {
    return this.currentTier;
  }

  public setQualityTier(tier: ShadowQualityTier): void {
    this.currentTier = tier;
  }

  public getDirectionalConfig(): ShadowConfig {
    switch (this.currentTier) {
      case 'LOW':
        return { resolution: 1024, cascades: 2, filteringQuality: ShadowGenerator.QUALITY_LOW };
      case 'MEDIUM':
        return { resolution: 2048, cascades: 3, filteringQuality: ShadowGenerator.QUALITY_MEDIUM };
      case 'HIGH':
      default:
        return { resolution: 2048, cascades: 4, filteringQuality: ShadowGenerator.QUALITY_HIGH };
    }
  }

  public getSpotConfig(): ShadowConfig {
    switch (this.currentTier) {
      case 'LOW':
        return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_LOW };
      case 'MEDIUM':
        return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_MEDIUM };
      case 'HIGH':
      default:
        return { resolution: 2048, filteringQuality: ShadowGenerator.QUALITY_HIGH };
    }
  }

  public getPointConfig(): ShadowConfig {
    switch (this.currentTier) {
      case 'LOW':
        return { resolution: 512, filteringQuality: ShadowGenerator.QUALITY_LOW };
      case 'MEDIUM':
        return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_MEDIUM };
      case 'HIGH':
      default:
        // 1024x1024 por cara cúbica con filtrado QUALITY_HIGH elimina el pixelado a distancia
        return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_HIGH };
    }
  }
}