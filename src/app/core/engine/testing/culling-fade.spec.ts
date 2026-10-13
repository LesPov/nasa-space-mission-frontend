// file: src/app/core/engine/testing/culling-fade.spec.ts
import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

import { setupBrowserMocks } from './mocks/browser.mock';
setupBrowserMocks();

if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

import { describe, it, expect, beforeEach } from 'vitest';
import { Scene, NullEngine, MeshBuilder, Vector3, ArcRotateCamera, UniversalCamera } from '@babylonjs/core';
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
import { LightDistanceService } from '../runtime/systems/lighting/light-distance.service';
import { DynamicLightingSystem } from '../runtime/systems/lighting/dynamic-lighting.system';
import { LightAllocationService } from '../runtime/systems/lighting/light-allocation.service';
import { LightPoolService } from '../runtime/systems/lighting/light-pool.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowLODManager } from '../runtime/shadows/shadow-lod-manager.service';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { ShadowQualityService } from '../runtime/shadows/shadow-quality.service';

describe('VALIDACIÓN FASE 0.1 — Estabilidad Visual en Editor y Progresión de Luz', () => {
  let localRendering: LocalRenderingSystem;
  let entityManager: EntityManagerService;
  let spatialHub: SpatialRelevanceHubService;
  let gameContext: GameContextService;
  let distanceService: LightDistanceService;
  let lightingSystem: DynamicLightingSystem;
  let scene: Scene;
  let editorCam: ArcRotateCamera;
  let playerFpsCam: UniversalCamera;
  let playerTpsCam: ArcRotateCamera;

  beforeEach(() => {
    TestBed.resetTestingModule();
    const engine = new NullEngine();
    scene = new Scene(engine);

    editorCam = new ArcRotateCamera('editorCam', 0, 0, 10, Vector3.Zero(), scene);
    playerFpsCam = new UniversalCamera('playerFpsCam', Vector3.Zero(), scene);
    playerTpsCam = new ArcRotateCamera('playerTpsCam', 0, 0, 10, Vector3.Zero(), scene);

    TestBed.configureTestingModule({
      providers: [
        LocalRenderingSystem,
        EntityManagerService,
        SpatialRelevanceHubService,
        SpatialStreamingGroupService,
        GameContextService,
        LightShadowService,
        LightDistanceService,
        DynamicLightingSystem,
        LightAllocationService,
        LightPoolService,
        LightContainmentService,
        ShadowLODManager,
        ShadowCache,
        ShadowQualityService,
        EngineProfilerService,
        PerformanceIncidentService,
        GameEventBusService,
        {
          provide: SCENE_ACCESS_TOKEN,
          useValue: { 
            getScene: () => scene, 
            getEngine: () => engine,
            getEditorCamera: () => editorCam,
            getPlayerCameraFPS: () => playerFpsCam,
            getPlayerCameraTPS: () => playerTpsCam,
            getRenderingPipeline: () => null,
            getCurrentFps: () => 60,
            setVisualMode: () => {},
            forceResize: () => {}
          }
        }
      ]
    });

    localRendering = TestBed.inject(LocalRenderingSystem);
    entityManager = TestBed.inject(EntityManagerService);
    spatialHub = TestBed.inject(SpatialRelevanceHubService);
    gameContext = TestBed.inject(GameContextService);
    distanceService = TestBed.inject(LightDistanceService);
    lightingSystem = TestBed.inject(DynamicLightingSystem);
  });

  it('TEST A (MODO EDITOR): Mover al jugador LEJOS no oculta modelos ni altera visibilidad', () => {
    gameContext.setupContext('EDITOR', { submode: 'EDITING' });

    const modelEntity = new GameEntity('prop_corridor_test', 'pasillo1_109', 'model');
    modelEntity.visual.disableCulling = false;
    const mesh = MeshBuilder.CreateBox('c_mesh', { width: 10, height: 4, depth: 30 }, scene);
    mesh.position.set(0, 2, 0);
    modelEntity.bindView(mesh);
    entityManager.addEntity(modelEntity);

    const playerEntity = new GameEntity('player_ed', 'Player', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('p_ed_mesh', { size: 1 }, scene);
    playerMesh.position.set(0, 1, 0);
    playerEntity.bindView(playerMesh);
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    spatialHub.rebuildRegistry();
    localRendering.start();

    // Mover al jugador a 500 metros
    playerMesh.position.set(0, 1, 500);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 30; f++) {
      localRendering.update(16.66);
    }

    // En Modo Editor la malla debe permanecer 100% visible
    expect(mesh.visibility).toBe(1.0);
    expect(mesh.isVisible).toBe(true);
    expect(mesh.isEnabled()).toBe(true);
    expect(modelEntity.isCulled).toBe(false);
  });

  it('TEST B (MODO TEST_LIVE): El culling y fade progresivo siguen funcionando correctamente', () => {
    gameContext.setupContext('PLAYER_PREVIEW');

    const modelEntity = new GameEntity('corridor_section_live', 'pasillo1_109', 'model');
    modelEntity.visual.disableCulling = false;
    const mesh = MeshBuilder.CreateBox('c_mesh_live', { width: 10, height: 4, depth: 30 }, scene);
    mesh.position.set(0, 2, 0);
    modelEntity.bindView(mesh);
    entityManager.addEntity(modelEntity);

    const playerEntity = new GameEntity('player_live', 'Player', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('p_live_mesh', { size: 1 }, scene);
    playerMesh.position.set(0, 1, 0);
    playerEntity.bindView(playerMesh);
    // Configuración exacta de culling: corte a 100m con fade desde 60m
    playerEntity.playerConfig = {
      culling: { enabled: true, cullDistance: 100, fadeMargin: 40 }
    } as any;
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    spatialHub.rebuildRegistry();
    localRendering.start();
    localRendering.reconcileAllEntitiesImmediate(new Vector3(0, 1, 0));

    expect(mesh.visibility).toBe(1.0);
    expect(modelEntity.isCulled).toBe(false);

    // Mover al jugador a 80m (dentro de la franja de fade: 60m a 100m)
    playerMesh.position.set(0, 1, 80);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 10; f++) {
      localRendering.update(16.66);
    }

    // Debe estar en FADING_OUT con visibilidad reducida
    expect(mesh.visibility).toBeLessThan(1.0);
    expect(mesh.visibility).toBeGreaterThan(0.0);
    expect(mesh.isVisible).toBe(true);

    // Mover al jugador a 200m (más allá de cullDistance = 100m)
    playerMesh.position.set(0, 1, 200);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 25; f++) {
      localRendering.update(16.66);
    }

    const metrics = localRendering.getMetrics();
    expect(mesh.visibility).toBe(0.0);
    expect(mesh.isVisible).toBe(false);
    expect(modelEntity.isCulled).toBe(true);
    expect(metrics.hardCulledObjects).toBe(1);
  });

  it('TEST C (LUCES): La activación espacial responde al jugador comenzando progresivamente desde 0.0001', () => {
    const lightEntity = new GameEntity('luz_omnidireccional_test', 'luzomnidirecional', 'light_point');
    lightEntity.light!.enabled = true;
    lightEntity.light!.containmentMode = 'GLOBAL';
    lightEntity.light!.activationDistance = 25;
    lightEntity.light!.deactivationDistance = 35;
    lightEntity.transform.position = { x: 0, y: 3, z: 0 };
    const lMesh = MeshBuilder.CreateSphere('lm_test', { diameter: 0.5 }, scene);
    lightEntity.bindView(lMesh);
    entityManager.addEntity(lightEntity);

    const playerEntity = new GameEntity('player_light_test', 'Player', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('p_lm', { size: 1 }, scene);
    playerEntity.bindView(playerMesh);
    entityManager.addEntity(playerEntity);

    spatialHub.rebuildRegistry();
    lightingSystem.prepareAllLights();
    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEntity);

    // Jugador fuera de rango (40m)
    playerMesh.position.set(0, 1, 40);
    distanceService.evaluateDistanceAndHysteresis([vl], playerMesh.position, 0);
    expect(vl.targetMultiplier).toBe(0.0);

    // Jugador entra en el rango de fade-in (34m, entre 35m y 25m)
    playerMesh.position.set(0, 1, 34);
    distanceService.evaluateDistanceAndHysteresis([vl], playerMesh.position, 0);

    // Debe comenzar en un multiplicador positivo >= 0.0001 y menor a 1.0
    expect(vl.targetMultiplier).toBeGreaterThanOrEqual(0.0001);
    expect(vl.targetMultiplier).toBeLessThan(0.5);

    // Jugador se acerca al rango pleno (15m, < 25m)
    playerMesh.position.set(0, 1, 15);
    distanceService.evaluateDistanceAndHysteresis([vl], playerMesh.position, 0);
    expect(vl.targetMultiplier).toBe(1.0);
  });
});