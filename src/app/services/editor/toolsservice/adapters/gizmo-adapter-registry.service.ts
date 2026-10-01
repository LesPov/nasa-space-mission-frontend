
import { Injectable } from '@angular/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { BaseEntityGizmoAdapter } from './base-entity-gizmo.adapter';
import { CameraGizmoAdapter } from './camera-gizmo.adapter';
import { ColliderGizmoAdapter } from './collider-gizmo.adapter';
import { FogGizmoAdapter } from './fog-gizmo.adapter';
import { PartGizmoAdapter } from './part-gizmo.adapter';

@Injectable({ providedIn: 'root' })
export class GizmoAdapterRegistryService {
  private adapters: IGizmoTargetAdapter[] = [];

  constructor() {
    this.adapters = [
      new PartGizmoAdapter(),
      new CameraGizmoAdapter(),
      new ColliderGizmoAdapter(),
      new FogGizmoAdapter(),
      new BaseEntityGizmoAdapter()
    ];
  }

  /**
   * Retorna el adaptador correspondiente para manipular la entidad con el Gizmo.
   * Al unificarse la arquitectura, las luces (y cualquier otra entidad con TransformComponent)
   * delegan su manipulación en el BaseEntityGizmoAdapter, eliminando la necesidad de lógica duplicada.
   */
  public getAdapter(subSelected: string | null, entity: GameEntity | null, mesh?: AbstractMesh | null): IGizmoTargetAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.supports(subSelected, entity, mesh)) {
        return adapter;
      }
    }
    return null;
  }
}