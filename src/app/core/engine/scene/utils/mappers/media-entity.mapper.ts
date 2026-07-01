
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../../models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class MediaEntityMapper extends BaseEntityMapper {
  supports(entityType: string): boolean {
    return entityType === 'video_plane' || entityType === 'image_plane';
  }
  
  protected override getDefaultCollider(entity: GameEntity): any {
    return { type: 'box', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }

  override applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    super.applyDbToEntity(obj, entity);
    const props = obj.properties || {} as SceneObjectPropertiesDto;

    if (entity.media) {
      entity.media.videoUrl = entity.type === 'video_plane' ? (entity.visual.path || '') : '';
      entity.media.imageUrl = entity.type === 'image_plane' ? (entity.visual.path || '') : '';
      entity.media.profundidadProyeccion = props.profundidadProyeccion ?? 10;
      entity.media.anguloProyeccion = props.anguloProyeccion ?? 0;
      entity.media.proyeccionAncho = props.proyeccionAncho ?? 2;
      entity.media.proyeccionAlto = props.proyeccionAlto ?? 2;
      entity.media.proyeccionRepeticiones = props.proyeccionRepeticiones ?? 1;
      entity.media.proyeccionEspaciado = props.proyeccionEspaciado ?? 2;
      entity.media.proyeccionEje = props.proyeccionEje || 'Y';
      entity.media.fadeDistance = this.utilsSvc.normalizarNumero(props.fadeDistance, 0);
    }
  }

  override extractEntityProperties(entity: GameEntity): Partial<SceneObjectPropertiesDto> {
    const base = super.extractEntityProperties(entity);
    return {
      ...base,
      ...entity.media 
    };
  }
}