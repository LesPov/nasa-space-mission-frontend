import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { SpatialSchedulerService } from './spatial-scheduler.service';
 
@Injectable({ providedIn: 'root' })
export class CullingService implements IUpdatable {
  public id = 'CullingService';
  
  private entityManager = inject(EntityManagerService);
  private ownership = inject(CameraOwnershipService);
  private spatialScheduler = inject(SpatialSchedulerService);
  
  // Implementación de histéresis para prevenir popping
  private readonly CULL_OUT_DISTANCE = 130.0;
  private readonly CULL_IN_DISTANCE = 110.0;
  private readonly CULL_OUT_DIST_SQ = this.CULL_OUT_DISTANCE * this.CULL_OUT_DISTANCE;
  private readonly CULL_IN_DIST_SQ = this.CULL_IN_DISTANCE * this.CULL_IN_DISTANCE;
  
  private _isActive = false;

  public start(): void {
    this._isActive = true;
  }

  public stop(): void {
    this._isActive = false;
    this.entityManager.getAllEntities().forEach(e => {
        if (e.isCulled) {
            e.isCulled = false;
            if (e.view) e.view.setEnabled(true);
        }
    });
  }

  public update(dtMs: number): void {
    if (!this._isActive) return;

    const camera = this.ownership.getCamera();
    if (!camera) return;

    const camPos = camera.globalPosition;

    if (this.spatialScheduler.shouldEvaluate(camPos, dtMs)) {
      const entities = this.entityManager.getAllEntities();
      
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.view || e.type === 'player') continue; 

        const pos = e.view.getAbsolutePosition();
        const distSq = Vector3.DistanceSquared(camPos, pos);

        // Lógica de histéresis
        if (e.isCulled) {
            if (distSq < this.CULL_IN_DIST_SQ) {
                e.isCulled = false;
                e.view.setEnabled(true);
            }
        } else {
            if (distSq > this.CULL_OUT_DIST_SQ) {
                e.isCulled = true;
                e.view.setEnabled(false); 
            }
        }
      }
    }
  }
}