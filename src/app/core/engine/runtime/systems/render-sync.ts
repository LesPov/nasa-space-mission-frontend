
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class RenderSync implements IUpdatable {
  public id = 'RenderSyncSystem';
  private entityManager = inject(EntityManagerService);

  postUpdate(dtMs: number): void {
    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
      if (entities[i].isDirty) {
        entities[i].syncToView();
        entities[i].isDirty = false;
      }
    }
  }
}