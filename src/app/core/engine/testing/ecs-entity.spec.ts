
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEntity, CharacterConfigComponent } from '../entities/game.entity';
import { cloneDefaultPlayerConfig } from '../models/player-config.model';

describe('ECS FASE 2: GameEntity Persistence Tests', () => {
  let playerEntity: GameEntity;

  beforeEach(() => {
    playerEntity = new GameEntity('uuid-123', 'Player', 'model', 'player');
    playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEntity.playerConfig = cloneDefaultPlayerConfig();
  });

  it('1. Debe almacenar y recuperar PlayerRuntimeConfig sin reconstruirlo', () => {
    const initialConfig = playerEntity.playerConfig;
    expect(initialConfig).toBeDefined();

    // Comprobar que no es reconstruido dinámicamente en el getter
    expect(playerEntity.playerConfig).toBe(initialConfig);
  });

  it('2. Las mutaciones profundas deben persistir instantáneamente', () => {
    expect(playerEntity.playerConfig!.fog.enabled).toBe(false); // Default es false
    
    // Mutamos profundamente el componente
    playerEntity.playerConfig!.fog.enabled = true;
    playerEntity.playerConfig!.movement.walkSpeed = 999;

    // Verificamos de nuevo extrayéndolo desde el getter
    const updatedConfig = playerEntity.playerConfig;
    expect(updatedConfig!.fog.enabled).toBe(true);
    expect(updatedConfig!.movement.walkSpeed).toBe(999);
  });

  it('3. El Setter debe reemplazar el componente de raíz', () => {
    const newConfig = cloneDefaultPlayerConfig();
    newConfig.camera.fpsEyeLevel = 500;
    
    playerEntity.playerConfig = newConfig;

    expect(playerEntity.playerConfig!.camera.fpsEyeLevel).toBe(500);
    // El objeto retornado debe ser la misma referencia insertada
    expect(playerEntity.playerConfig).toBe(newConfig);
  });
});