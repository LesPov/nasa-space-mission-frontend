
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpawnManagerService } from '../runtime/systems/spawn-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../entities/game.entity';
import { MeshBuilder, Vector3, NullEngine, Scene } from '@babylonjs/core';
import { TestBed } from '@angular/core/testing';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';

describe('SpawnManagerService (Fase 5)', () => {
  let spawnManager: SpawnManagerService;
  let entityManager: EntityManagerService;
  let scene: Scene;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        SpawnManagerService,
        {
          provide: SCENE_ACCESS_TOKEN,
          useValue: {
            getScene: () => scene,
            getEditorCamera: () => ({ getTarget: () => new Vector3(0,0,0) })
          }
        }
      ]
    });

    entityManager = TestBed.inject(EntityManagerService);
    spawnManager = TestBed.inject(SpawnManagerService);
  });

  afterEach(() => {
    entityManager.clear();
    scene.dispose();
  });

  it('1. Debe retornar jugador temporal si no hay jugador ni spawn_point en el mapa (En Preview)', () => {
    const result = spawnManager.resolvePlayerForSession(null, true);
    expect(result).toBeDefined();
    expect(result?.view?.name).toBe('TempPlayer_TestLive');
  });

  it('2. Debe ascender un spawn_point a jugador real en modo Runtime', () => {
    const spawnMesh = MeshBuilder.CreateBox('spawn', {size: 1}, scene);
    const spawnEntity = new GameEntity('123', 'Spawn', 'cube', 'spawn_point');
    spawnEntity.bindView(spawnMesh);
    entityManager.addEntity(spawnEntity);

    const result = spawnManager.resolvePlayerForSession(null, false);
    
    expect(result).toBeDefined();
    expect(result?.uid).toBe('123');
    expect(result?.hasComponent('characterConfig')).toBe(true);
    expect(result?.rol).toBe('player');
    expect(result?.isPersistent).toBe(true);
  });

  it('3. Debe instanciar una malla temporal sobre el spawn en modo Editor TestLive', () => {
    const spawnMesh = MeshBuilder.CreateBox('spawn', {size: 1}, scene);
    const spawnEntity = new GameEntity('123', 'Spawn', 'cube', 'spawn_point');
    spawnEntity.bindView(spawnMesh);
    entityManager.addEntity(spawnEntity);

    const result = spawnManager.resolvePlayerForSession(null, true);
    
    expect(result).toBeDefined();
    expect(result?.uid).not.toBe('123'); // Es uno nuevo
    expect(result?.rol).toBe('player');
    expect(result?.view?.name).toBe('TempPlayer_TestLive');
  });

  it('4. Si existe un jugador configurado, en Runtime, lo fuerza a viajar al spawn point si hay uno', () => {
    const playerMesh = MeshBuilder.CreateCapsule('player', {height: 1.8}, scene);
    const playerEntity = new GameEntity('player', 'Jugador', 'model', 'player');
    playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEntity.bindView(playerMesh);
    entityManager.addEntity(playerEntity);

    const spawnMesh = MeshBuilder.CreateBox('spawn', {size: 1}, scene);
    spawnMesh.position.set(10, 0, 10);
    const spawnEntity = new GameEntity('spawn', 'Spawn', 'cube', 'spawn_point');
    spawnEntity.bindView(spawnMesh);
    entityManager.addEntity(spawnEntity);

    const result = spawnManager.resolvePlayerForSession(null, false); // isPreview = false
    
    expect(result).toBe(playerEntity);
    expect(result?.view?.position.x).toBe(10);
    expect(result?.view?.position.z).toBe(10);
    expect(entityManager.getEntityByUid('spawn')).toBeUndefined(); // El spawn debió eliminarse
  });

  it('5. En modo TestLive, NO debe forzar al jugador a viajar al spawn point', () => {
    const playerMesh = MeshBuilder.CreateCapsule('player', {height: 1.8}, scene);
    playerMesh.position.set(5, 0, 5); // Posicionado manualmente en 5,0,5

    const playerEntity = new GameEntity('player', 'Jugador', 'model', 'player');
    playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEntity.bindView(playerMesh);
    entityManager.addEntity(playerEntity);

    const spawnMesh = MeshBuilder.CreateBox('spawn', {size: 1}, scene);
    spawnMesh.position.set(10, 0, 10); // Hay un spawn en 10,0,10
    const spawnEntity = new GameEntity('spawn', 'Spawn', 'cube', 'spawn_point');
    spawnEntity.bindView(spawnMesh);
    entityManager.addEntity(spawnEntity);

    const result = spawnManager.resolvePlayerForSession(null, true); // isPreview = true
    
    expect(result).toBe(playerEntity);
    expect(result?.view?.position.x).toBe(5); // Se queda en 5, no viaja a 10
    expect(result?.view?.position.z).toBe(5);
    expect(entityManager.getEntityByUid('spawn')).toBeDefined(); // El spawn no debe eliminarse porque no se consumió
  });
});