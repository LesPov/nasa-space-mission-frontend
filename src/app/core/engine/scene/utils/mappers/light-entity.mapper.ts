
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../../models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class LightEntityMapper extends BaseEntityMapper {
  supports(entityType: string): boolean {
    return entityType.startsWith('light_');
  }

  protected override getDefaultCollider(entity: GameEntity): any {
    return { type: 'sphere', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }

  override applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    super.applyDbToEntity(obj, entity);
    const props = obj.properties || {} as SceneObjectPropertiesDto;

    if (entity.light) {
      entity.light.lightColor = props.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.lightColorBW = props.lightColorBW?.substring(0, 7) || entity.light.lightColor;
      entity.light.intensity = props.intensity ?? 1.0;
      entity.light.range = props.range ?? 50;
      entity.light.angle = props.angle ?? 60;
      entity.light.lightPosX = props.lightPosX ?? 0;
      entity.light.lightPosY = props.lightPosY ?? 0;
      entity.light.lightPosZ = props.lightPosZ ?? 0;
      entity.light.attachedNodePath = props.attachedNodePath || '';
      entity.light.attachedNodeName = props.attachedNodeName || '';
      entity.light.renderIntensity = entity.light.intensity;
      entity.light.enabled = props.isEnabled ?? true;
      entity.light.castShadows = (props as any).castShadows ?? true;
    }
  }

  override extractEntityProperties(entity: GameEntity): Partial<SceneObjectPropertiesDto> {
    const base = super.extractEntityProperties(entity);
    return {
      ...base,
      ...(entity.light ? entity.light : {})
    };
  }
}