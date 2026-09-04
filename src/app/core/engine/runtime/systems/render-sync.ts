import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { TransformTelemetryService } from '../../telemetry/transform-telemetry.service';

@Injectable({ providedIn: 'root' })
export class RenderSync implements IUpdatable {
  public id = 'RenderSyncSystem';
  private entityManager = inject(EntityManagerService);

  postUpdate(dtMs: number): void {
    const telemetry = TransformTelemetryService.instance;
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      if (entities[i].isDirty) {
        
        if (telemetry && telemetry.enabled) {
           telemetry.logEvent(entities[i].uid, entities[i].rol, 'RenderSync', 'isDirty', 'READ', true, false);
        }

        entities[i].syncToView();
        entities[i].isDirty = false;
      }
    }
  }
}