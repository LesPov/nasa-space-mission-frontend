
import { Injectable } from '@angular/core';
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { BaseEntityGizmoAdapter } from './base-entity-gizmo.adapter';
import { ColliderGizmoAdapter } from './collider-gizmo.adapter';
import { CameraGizmoAdapter } from './camera-gizmo.adapter';
import { LightGizmoAdapter } from './light-gizmo.adapter';
import { FogGizmoAdapter } from './fog-gizmo.adapter';
import { GameEntity } from '../../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class GizmoAdapterRegistryService {
  private adapters: IGizmoTargetAdapter[] = [];

  constructor() {
    this.registerAdapter(new BaseEntityGizmoAdapter());
    this.registerAdapter(new ColliderGizmoAdapter());
    this.registerAdapter(new CameraGizmoAdapter());
    this.registerAdapter(new LightGizmoAdapter());
    this.registerAdapter(new FogGizmoAdapter());
  }

  public registerAdapter(adapter: IGizmoTargetAdapter): void {
    this.adapters.push(adapter);
  }

  public getAdapter(subSelected: string | null, entity: GameEntity | null): IGizmoTargetAdapter | null {
    // Al recorrer de manera inversa priorizamos adaptadores nuevos o sobreescritos
    for (let i = this.adapters.length - 1; i >= 0; i--) {
      if (this.adapters[i].supports(subSelected, entity)) {
        return this.adapters[i];
      }
    }
    return null;
  }
}