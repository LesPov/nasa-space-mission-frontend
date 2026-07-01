
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity } from '../../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class ModelEntityMapper extends BaseEntityMapper {
  supports(entityType: string, obj: any): boolean {
    const isModel = entityType === 'model';
    const isCharacterProps = !!obj?.properties?.characterConfig || ['player', 'npc', 'politico', 'militar'].includes(obj?.properties?.rol || obj?.rol || (obj instanceof GameEntity ? obj.rol : ''));
    return isModel && !isCharacterProps;
  }

  protected override getDefaultCollider(entity: GameEntity): any {
    return { type: 'mesh', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }
}