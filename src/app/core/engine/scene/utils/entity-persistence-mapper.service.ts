
import { Injectable, inject } from '@angular/core';
import { GameEntity } from '../../entities/game.entity';
import { SceneObjectDto, TriggerDto } from '../../models/api-dto.model';
import { EntityMapperStrategy } from './mappers/entity-mapper-strategy.interface';
import { CharacterEntityMapper } from './mappers/character-entity.mapper';
import { LightEntityMapper } from './mappers/light-entity.mapper';
import { MediaEntityMapper } from './mappers/media-entity.mapper';
import { TriggerEntityMapper } from './mappers/trigger-entity.mapper';
import { PrimitiveEntityMapper } from './mappers/primitive-entity.mapper';
import { ModelEntityMapper } from './mappers/model-entity.mapper';

@Injectable({ providedIn: 'root' })
export class EntityPersistenceMapperService {
  private mappers: EntityMapperStrategy[] = [];

  constructor() {
    this.mappers = [
      inject(TriggerEntityMapper),
      inject(LightEntityMapper),
      inject(MediaEntityMapper),
      inject(CharacterEntityMapper),
      inject(PrimitiveEntityMapper),
      inject(ModelEntityMapper)
    ];
  }

  private getStrategy(entityType: string, obj?: any): EntityMapperStrategy {
    const strategy = this.mappers.find(m => m.supports(entityType, obj));
    if (!strategy) {
      console.warn(`[EntityPersistenceMapper] Ninguna estrategia encontrada para: ${entityType}. Se usará ModelEntityMapper por defecto.`);
      return this.mappers.find(m => m instanceof ModelEntityMapper)!;
    }
    return strategy;
  }

  public applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    this.getStrategy(entity.type, obj).applyDbToEntity(obj, entity);
  }

  public extractEntityProperties(entity: GameEntity): any {
    return this.getStrategy(entity.type).extractEntityProperties(entity);
  }

  public extractToDtos(entity: GameEntity): any[] {
    return this.getStrategy(entity.type).extractToDtos(entity);
  }
}