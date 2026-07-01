
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EntityPersistenceMapperService } from '../scene/utils/entity-persistence-mapper.service';
import { GameEntity } from '../entities/game.entity';
import { TriggerEntityMapper } from '../scene/utils/mappers/trigger-entity.mapper';
import { LightEntityMapper } from '../scene/utils/mappers/light-entity.mapper';
import { MediaEntityMapper } from '../scene/utils/mappers/media-entity.mapper';
import { CharacterEntityMapper } from '../scene/utils/mappers/character-entity.mapper';
import { PrimitiveEntityMapper } from '../scene/utils/mappers/primitive-entity.mapper';
import { ModelEntityMapper } from '../scene/utils/mappers/model-entity.mapper';
import { CoreSceneUtilsService } from '../scene/utils/core-scene-utils.service';
import { SceneObjectDto } from '../models/api-dto.model';

describe('EntityPersistenceMapperService (Fase 7)', () => {
  let orquestador: EntityPersistenceMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EntityPersistenceMapperService,
        TriggerEntityMapper, LightEntityMapper, MediaEntityMapper,
        CharacterEntityMapper, PrimitiveEntityMapper, ModelEntityMapper,
        CoreSceneUtilsService
      ]
    });
    orquestador = TestBed.inject(EntityPersistenceMapperService);
  });

  it('1. Debe instanciar correctamente el Orquestador con todos los Mappers inyectados', () => {
    expect(orquestador).toBeDefined();
  });

  it('2. ModelEntityMapper no debe procesar a un personaje si es Character', () => {
    const mockCharacterDto: SceneObjectDto = { uid: '1', type: 'model', name: 'char', position: {x:0,y:0,z:0}, properties: { rol: 'player' } };
    const mapper = (orquestador as any).getStrategy('model', mockCharacterDto);
    expect(mapper).toBeInstanceOf(CharacterEntityMapper);
  });

  it('3. TriggerEntityMapper debe extraer y convertir triggers compuestos a un Array de múltiples DTOs', () => {
    const entity = new GameEntity('123', 'MyTrigger', 'trigger_compuesto', 'trigger');
    entity.trigger = { conditions: ['on_enter', 'on_exit'], isComposite: true } as any;

    const dtos = orquestador.extractToDtos(entity);
    
    expect(dtos.length).toBe(2);
    expect(dtos[0].uid).toBe('123_on_enter');
    expect(dtos[1].uid).toBe('123_on_exit');
    expect(dtos[0].properties.condition).toBe('on_enter');
    expect(dtos[1].properties.condition).toBe('on_exit');
  });

  it('4. LightEntityMapper debe encapsular y fusionar sus propiedades de luz directamente en extractToDtos', () => {
    const entity = new GameEntity('456', 'MyLight', 'light_point', 'light');
    entity.light = { lightColor: '#ff0000', intensity: 2.5 } as any;

    const dtos = orquestador.extractToDtos(entity);
    
    expect(dtos.length).toBe(1);
    expect(dtos[0].properties.lightColor).toBe('#ff0000');
    expect(dtos[0].properties.intensity).toBe(2.5);
  });
});
