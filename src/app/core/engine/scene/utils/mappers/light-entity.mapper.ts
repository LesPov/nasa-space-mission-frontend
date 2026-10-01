
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
      
      // --- Retrocompatibilidad temporal para mapas antiguos que guardaron la posición de la luz en properties ---
      if ((props as any).lightPosX !== undefined) {
         entity.transform.position.x = (props as any).lightPosX;
         entity.transform.position.y = (props as any).lightPosY ?? 0;
         entity.transform.position.z = (props as any).lightPosZ ?? 0;
         entity.transform.rotation.x = ((props as any).lightRotX ?? 0) * Math.PI / 180;
         entity.transform.rotation.y = ((props as any).lightRotY ?? 0) * Math.PI / 180;
         entity.transform.rotation.z = ((props as any).lightRotZ ?? 0) * Math.PI / 180;
         entity.transform.rotationQuaternion = null;
      }

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