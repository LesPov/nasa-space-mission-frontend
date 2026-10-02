
import { Injectable } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';

@Injectable({ providedIn: 'root' })
export class LightSyncSystem implements IUpdatable {
  public id = 'LightSyncSystem';

  public update(dtMs: number): void {
      // 🔥 REFACTORIZACIÓN ARQUITECTÓNICA TRIPLE A: 
      // Este servicio original ha sido neutralizado para evitar el doble-rendereo, la sobre-escritura 
      // de intensidades y el "Fighting" entre sistemas de luces que trababan el GL_UNIFORM.
      // Toda la responsabilidad espacial ha sido absorbida y protegida por 
      // el nuevo DynamicLightingSystem (Pool System).
      return;
  }
}