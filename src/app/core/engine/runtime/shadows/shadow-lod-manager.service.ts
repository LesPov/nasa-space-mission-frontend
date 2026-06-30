
import { Injectable } from '@angular/core';
 import { Vector3 } from '@babylonjs/core';
import { ShadowLOD, ShadowProfile } from './shadow.model';

@Injectable({ providedIn: 'root' })
export class ShadowLODManager {
  public calculateLOD(meshPos: Vector3, cameraPos: Vector3, profile: ShadowProfile): ShadowLOD {
    const distToCam = Vector3.Distance(meshPos, cameraPos);
    
    if (distToCam < profile.lod1Distance) {
      return ShadowLOD.LOD0_ACTIVE_SHADOWS;
    } else if (distToCam < profile.lod2Distance) {
      return ShadowLOD.LOD1_NO_SHADOWS;
    } else if (distToCam < profile.lod3Distance) {
      return ShadowLOD.LOD2_LIGHTING_ONLY;
    } else {
      return ShadowLOD.LOD3_NO_PHYSICAL_LIGHT;
    }
  }
}