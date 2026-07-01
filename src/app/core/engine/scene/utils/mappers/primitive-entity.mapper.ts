
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity } from '../../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class PrimitiveEntityMapper extends BaseEntityMapper {
  private supportedTypes = ['cube', 'sphere', 'cylinder', 'plane', 'bubble'];

  supports(entityType: string): boolean {
    return this.supportedTypes.includes(entityType);
  }

  protected override getDefaultCollider(entity: GameEntity): any {
    return { type: (entity.type === 'sphere' || entity.type === 'bubble') ? 'sphere' : (entity.type === 'cylinder' ? 'capsule' : 'box'), sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }
}