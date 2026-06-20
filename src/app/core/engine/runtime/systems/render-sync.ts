import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class RenderSync implements IUpdatable {
  public id = 'RenderSyncSystem';
  private entityManager = inject(EntityManagerService);

  postUpdate(dtMs: number): void {
    const entities = this.entityManager.getAllEntities();
    for (const entity of entities) {
      if (entity.isDirty) {
        entity.syncToView();
        entity.isDirty = false;
      }
    }
  }
}