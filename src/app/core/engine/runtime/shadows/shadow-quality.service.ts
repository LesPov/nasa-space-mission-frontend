
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
// Nivel de calidad actual. En el futuro puede conectarse al menú de opciones del usuario
private currentTier: ShadowQualityTier = 'MEDIUM';
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
case 'HIGH':
return { resolution: 2048, cascades: 4, filteringQuality: ShadowGenerator.QUALITY_HIGH };
case 'MEDIUM':
default:
return { resolution: 2048, cascades: 3, filteringQuality: ShadowGenerator.QUALITY_MEDIUM };
}
}
public getSpotConfig(): ShadowConfig {
switch (this.currentTier) {
case 'LOW':
return { resolution: 512, filteringQuality: ShadowGenerator.QUALITY_LOW };
case 'HIGH':
return { resolution: 2048, filteringQuality: ShadowGenerator.QUALITY_HIGH };
case 'MEDIUM':
default:
return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_MEDIUM };
}
}
public getPointConfig(): ShadowConfig {
switch (this.currentTier) {
case 'LOW':
return { resolution: 512, filteringQuality: ShadowGenerator.QUALITY_LOW };
case 'HIGH':
// Mantenemos 1024 en HIGH para PointLights por ser mapas cúbicos de altísimo coste (VRAM * 6)
return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_HIGH };
case 'MEDIUM':
default:
return { resolution: 1024, filteringQuality: ShadowGenerator.QUALITY_MEDIUM };
}
}
}