
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpawnManagerService } from '../runtime/systems/spawn-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../entities/game.entity';
import { MeshBuilder, Vector3, NullEngine, Scene } from '@babylonjs/core';
import { TestBed } from '@angular/core/testing';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { GameStateService } from '../runtime/state/game-state.service';
import { GameContextService } from '../session/game-context.service';
import { CoreSceneLoaderService } from '../scene/utils/core-scene-loader.service';

describe('SpawnManagerService (Fase 1 - Role Resolving Update)', () => {
  let spawnManager: SpawnManagerService;
  let entityManager: EntityManagerService;
  let gameState: GameStateService;
  let context: GameContextService;
  let scene: Scene;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        SpawnManagerService,
        GameStateService,
        GameContextService,
        {
          provide: CoreSceneLoaderService,
          useValue: {
            instantiatePrefab: async () => {
              const mesh = MeshBuilder.CreateBox('mock', { size: 1 }, scene);
              const ent = new GameEntity('char_militar', 'Mock', 'model');
              ent.bindView(mesh);
              TestBed.inject(EntityManagerService).addEntity(ent);
              const map = new Map<string, any>();
              map.set('char_militar', mesh);
              return map;
            }
          }
        },
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
    gameState = TestBed.inject(GameStateService);
    context = TestBed.inject(GameContextService);
  });

  afterEach(() => {
    entityManager.clear();
    scene.dispose();
  });

  it('Debe resolver el jugador asimilando un Character 3D al Spawn Point según el NarrativeRole', async () => {
    // 1. Configuramos el Episodio con un rol militar
    context.setActiveEpisode({
        narrativeRoles: [{
            uid: 'role_militar',
            characterSceneObjectUid: 'char_militar',
            spawnSceneObjectUid: 'spawn_plaza',
            characterPrefab: { id: 1 }
        }]
    });

    // 2. Establecemos el Game State como si el usuario hubiera seleccionado "Militar"
    gameState.setPlayerRole('role_militar');

    // 4. Creamos el marcador del Spawn (ubicado en el centro, Ej: X:5)
    const spawnMesh = MeshBuilder.CreateBox('spawn_mesh', {size: 1}, scene);
    spawnMesh.position.set(5, 0, 5);
    const spawnEntity = new GameEntity('spawn_plaza', 'Spawn Principal', 'cube', 'spawn_point');
    spawnEntity.bindView(spawnMesh);
    
    // 🔥 FIX TEST: Forzamos la actualización posicional en el GameEntity para que lo reconozca
    spawnEntity.syncTransformFromView(); 
    entityManager.addEntity(spawnEntity);

    // 5. Ejecutamos el SpawnManager de forma asíncrona
    const result = await spawnManager.resolvePlayerForSession(null, false);
    
    // Validaciones:
    expect(result).toBeDefined();
    expect(result?.uid).toBe('char_militar'); // Se usó el modelo 3D
    expect(result?.rol).toBe('player'); // Fue ascendido a player
    expect(result?.view?.position.x).toBe(5); // Fue teletransportado a la X:5
    expect(result?.view?.position.z).toBe(5);
    
    // El spawn debió ser eliminado de la memoria y la escena
    expect(entityManager.getEntityByUid('spawn_plaza')).toBeUndefined();
  });
});