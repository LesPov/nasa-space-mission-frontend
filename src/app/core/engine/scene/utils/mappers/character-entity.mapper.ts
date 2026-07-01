
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity, CharacterConfigComponent } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../../models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class CharacterEntityMapper extends BaseEntityMapper {
  supports(entityType: string, obj: any): boolean {
    const isModel = entityType === 'model';
    const isCharacterProps = !!obj?.properties?.characterConfig || ['player', 'npc', 'politico', 'militar'].includes(obj?.properties?.rol || obj?.rol || (obj instanceof GameEntity ? obj.rol : ''));
    return isModel && isCharacterProps;
  }

  protected override getDefaultCollider(entity: GameEntity): any {
    return { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 };
  }

  override applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    super.applyDbToEntity(obj, entity);
    const props = obj.properties || {} as SceneObjectPropertiesDto;

    if (props.characterConfig) {
      entity.characterConfig = new CharacterConfigComponent(
        props.characterConfig.characterType,
        props.characterConfig.isPlayable,
        props.characterConfig.faction
      );
    }
  }

  override extractEntityProperties(entity: GameEntity): Partial<SceneObjectPropertiesDto> {
    const base = super.extractEntityProperties(entity);
    return {
      ...base,
      characterConfig: entity.characterConfig ? { ...entity.characterConfig } : undefined
    };
  }
}