// file: src/app/core/engine/testing/culling-fade.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Scene, NullEngine, MeshBuilder, Vector3 } from '@babylonjs/core';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameEntity } from '../entities/game.entity';
import { LocalRenderingSystem } from '../runtime/systems/local-rendering.system';
import { SpatialRelevanceHubService } from '../spatial/spatial-relevance-hub.service';
import { SpatialStreamingGroupService } from '../spatial/spatial-streaming-group.service';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { GameContextService } from '../session/game-context.service';
import { LightShadowService } from '../runtime/systems/lighting/light-shadow.service';
import { EngineProfilerService } from '../telemetry/engine-profiler.service';
import { PerformanceIncidentService } from '../telemetry/performance-incident.service';
import { GameEventBusService } from '../events/game-event-bus.service';

describe('VALIDACIÓN FORENSE CULLING + FADE (Pasillos y Mallas Estructurales)', () => {
  let localRendering: LocalRenderingSystem;
  let entityManager: EntityManagerService;
  let spatialHub: SpatialRelevanceHubService;
  let spatialGroups: SpatialStreamingGroupService;
  let gameContext: GameContextService;
  let scene: Scene;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);

    TestBed.configureTestingModule({
      providers: [
        LocalRenderingSystem,
        EntityManagerService,
        SpatialRelevanceHubService,
        SpatialStreamingGroupService,
        GameContextService,
        LightShadowService,
        EngineProfilerService,
        PerformanceIncidentService,
        GameEventBusService,
        {
          provide: SCENE_ACCESS_TOKEN,
          useValue: { getScene: () => scene, getEngine: () => engine }
        }
      ]
    });

    localRendering = TestBed.inject(LocalRenderingSystem);
    entityManager = TestBed.inject(EntityManagerService);
    spatialHub = TestBed.inject(SpatialRelevanceHubService);
    spatialGroups = TestBed.inject(SpatialStreamingGroupService);
    gameContext = TestBed.inject(GameContextService);

    gameContext.setupContext('PLAYER_PREVIEW');
  });

  it('TEST 1: Objeto de pasillo con disableCulling=false se atenúa progresivamente (Fade Out) al alejarse', () => {
    const corridorEntity = new GameEntity('corridor_section_1', 'pasillo_tramo_central', 'model');
    corridorEntity.visual.disableCulling = false; // El usuario NO quiere ignorar culling
    const mesh = MeshBuilder.CreateBox('c_mesh', { width: 10, height: 4, depth: 30 }, scene);
    mesh.position.set(0, 2, 0);
    corridorEntity.bindView(mesh);
    entityManager.addEntity(corridorEntity);

    const playerEntity = new GameEntity('player_1', 'Player', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('p_mesh', { size: 1 }, scene);
    playerMesh.position.set(0, 1, 0);
    playerEntity.bindView(playerMesh);
    playerEntity.playerConfig = {
      culling: { enabled: true, cullDistance: 100, fadeMargin: 40 }
    } as any;
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    spatialHub.rebuildRegistry();
    localRendering.start();
    localRendering.reconcileAllEntitiesImmediate(new Vector3(0, 1, 0));

    expect(mesh.visibility).toBe(1.0);
    expect(corridorEntity.isCulled).toBe(false);

    // El jugador se aleja a 80m (dentro del rango de fade: 60m a 100m)
    playerMesh.position.set(0, 1, 80);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 10; f++) {
      localRendering.update(16.66);
    }

    const metrics = localRendering.getMetrics();
    expect(mesh.visibility).toBeLessThan(1.0);
    expect(mesh.visibility).toBeGreaterThan(0.0);
    expect(metrics.fadingObjects).toBe(1);
    expect(corridorEntity.isCulled).toBe(false);

    // El jugador supera los 100m -> pasa a HARD_CULLED con opacidad 0
    playerMesh.position.set(0, 1, 120);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 25; f++) {
      localRendering.update(16.66);
    }

    const finalMetrics = localRendering.getMetrics();
    expect(mesh.visibility).toBe(0.0);
    expect(mesh.isVisible).toBe(false);
    expect(corridorEntity.isCulled).toBe(true);
    expect(finalMetrics.hardCulledObjects).toBe(1);
  });

  it('TEST 2: Objeto marcado con disableCulling=true permanece inmune sin importar la distancia', () => {
    const immuneEntity = new GameEntity('immune_landmark', 'torre_referencia', 'model');
    immuneEntity.visual.disableCulling = true; // Inmunidad explícita
    const mesh = MeshBuilder.CreateBox('imm_mesh', { size: 5 }, scene);
    mesh.position.set(0, 2, 0);
    immuneEntity.bindView(mesh);
    entityManager.addEntity(immuneEntity);

    const playerEntity = new GameEntity('player_2', 'Player', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('p_mesh2', { size: 1 }, scene);
    playerMesh.position.set(0, 1, 0);
    playerEntity.bindView(playerMesh);
    playerEntity.playerConfig = {
      culling: { enabled: true, cullDistance: 100, fadeMargin: 40 }
    } as any;
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    spatialHub.rebuildRegistry();
    localRendering.start();

    // Jugador a 300m
    playerMesh.position.set(0, 1, 300);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 20; f++) {
      localRendering.update(16.66);
    }

    expect(mesh.visibility).toBe(1.0);
    expect(mesh.isVisible).toBe(true);
    expect(immuneEntity.isCulled).toBe(false);
  });

  it('TEST 3: Al acercarse nuevamente (Restoring), la opacidad sube progresivamente de 0 a 1', () => {
    const corridorEntity = new GameEntity('corridor_section_restore', 'pasillo_retorno', 'model');
    corridorEntity.visual.disableCulling = false;
    const mesh = MeshBuilder.CreateBox('c_mesh_ret', { size: 10 }, scene);
    mesh.position.set(0, 2, 0);
    corridorEntity.bindView(mesh);
    entityManager.addEntity(corridorEntity);

    const playerEntity = new GameEntity('player_3', 'Player', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('p_mesh3', { size: 1 }, scene);
    playerMesh.position.set(0, 1, 200); // Comienza lejos (culled)
    playerEntity.bindView(playerMesh);
    playerEntity.playerConfig = {
      culling: { enabled: true, cullDistance: 100, fadeMargin: 40 }
    } as any;
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    spatialHub.rebuildRegistry();
    localRendering.start();
    localRendering.reconcileAllEntitiesImmediate(new Vector3(0, 1, 200));

    expect(corridorEntity.isCulled).toBe(true);
    expect(mesh.visibility).toBe(0.0);

    // El jugador se aproxima a 75m (zona de restoring)
    playerMesh.position.set(0, 1, 75);
    spatialHub.preUpdate(16.66);

    localRendering.update(16.66);
    expect(corridorEntity.isCulled).toBe(false);
    expect(mesh.isEnabled()).toBe(true);
    expect(mesh.isVisible).toBe(true);

    // Varios frames para verificar que la opacidad crece suavemente
    const vis1 = mesh.visibility;
    localRendering.update(16.66);
    const vis2 = mesh.visibility;

    expect(vis2).toBeGreaterThanOrEqual(vis1);

    // El jugador llega a 20m -> totalmente restaurado al 100%
    playerMesh.position.set(0, 1, 20);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 30; f++) {
      localRendering.update(16.66);
    }

    expect(mesh.visibility).toBe(1.0);
    expect(localRendering.getMetrics().visibleObjects).toBe(1);
  });
});