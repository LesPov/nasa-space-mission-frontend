// file: src/app/core/engine/testing/light-reactivation-occlusion.spec.ts
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
import { DynamicLightingSystem } from '../runtime/systems/lighting/dynamic-lighting.system';
import { LightAllocationService } from '../runtime/systems/lighting/light-allocation.service';
import { LightPoolService } from '../runtime/systems/lighting/light-pool.service';
import { LightDistanceService } from '../runtime/systems/lighting/light-distance.service';
import { LightShadowService } from '../runtime/systems/lighting/light-shadow.service';
import { LocalRenderingSystem } from '../runtime/systems/local-rendering.system';
import { SpatialRelevanceHubService } from '../spatial/spatial-relevance-hub.service';
import { SpatialStreamingGroupService } from '../spatial/spatial-streaming-group.service';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { GameContextService } from '../session/game-context.service';
import { EngineProfilerService } from '../telemetry/engine-profiler.service';
import { PerformanceIncidentService } from '../telemetry/performance-incident.service';
import { GameEventBusService } from '../events/game-event-bus.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowLODManager } from '../runtime/shadows/shadow-lod-manager.service';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { ShadowQualityService } from '../runtime/shadows/shadow-quality.service';

describe('PRUEBA DE ACEPTACIÓN — Reactivación de Luz, Sombras y Oclusión tras Culling/Desactivación', () => {
  let lightingSystem: DynamicLightingSystem;
  let lightAllocation: LightAllocationService;
  let lightPool: LightPoolService;
  let lightDistance: LightDistanceService;
  let lightShadows: LightShadowService;
  let localRendering: LocalRenderingSystem;
  let entityManager: EntityManagerService;
  let spatialHub: SpatialRelevanceHubService;
  let gameContext: GameContextService;
  let scene: Scene;

  beforeEach(() => {
    TestBed.resetTestingModule();
    const engine = new NullEngine();
    scene = new Scene(engine);

    const editorCam = new ArcRotateCamera('editorCam', 0, 0, 10, Vector3.Zero(), scene);
    const playerFpsCam = new UniversalCamera('playerFpsCam', Vector3.Zero(), scene);
    const playerTpsCam = new ArcRotateCamera('playerTpsCam', 0, 0, 10, Vector3.Zero(), scene);

    TestBed.configureTestingModule({
      providers: [
        DynamicLightingSystem,
        LightAllocationService,
        LightPoolService,
        LightDistanceService,
        LightShadowService,
        LightContainmentService,
        ShadowLODManager,
        ShadowCache,
        ShadowQualityService,
        LocalRenderingSystem,
        EntityManagerService,
        SpatialRelevanceHubService,
        SpatialStreamingGroupService,
        GameContextService,
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

    lightingSystem = TestBed.inject(DynamicLightingSystem);
    lightAllocation = TestBed.inject(LightAllocationService);
    lightPool = TestBed.inject(LightPoolService);
    lightDistance = TestBed.inject(LightDistanceService);
    lightShadows = TestBed.inject(LightShadowService);
    localRendering = TestBed.inject(LocalRenderingSystem);
    entityManager = TestBed.inject(EntityManagerService);
    spatialHub = TestBed.inject(SpatialRelevanceHubService);
    gameContext = TestBed.inject(GameContextService);

    gameContext.setupContext('PLAYER_PREVIEW');
  });

  it('Ciclo completo: Activación inicial -> Alejarse a Culling/Desactivación -> Volver a acercarse restaura casters y oclusión', () => {
    // 1. Crear el modelo del pasillo con sus paredes
    const corridor = new GameEntity('corridor_model_main', 'Pasillo_Estructural', 'model');
    const corridorMesh = MeshBuilder.CreateBox('c_mesh', { width: 8, height: 4, depth: 30 }, scene);
    corridorMesh.position.set(0, 2, 0);
    corridor.bindView(corridorMesh);
    entityManager.addEntity(corridor);

    // 2. Crear la luz interior hija del pasillo
    const lightEnt = new GameEntity('luz_pasillo_1', 'Luz_Pasillo', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.containmentMode = 'INTERIOR';
    lightEnt.light!.interiorActivationMode = 'VOLUME';
    lightEnt.light!.preEntryEnabled = true;
    lightEnt.light!.preEntryDistance = 8.0;
    lightEnt.light!.containerEntityUid = corridor.uid;
    lightEnt.light!.affectDescendantsOnly = false; // Permitir que la luz escape naturalmente por las puertas
    lightEnt.light!.castShadows = true;
    lightEnt.transform.position = { x: 0, y: 3.5, z: 0 };

    const lMesh = MeshBuilder.CreateSphere('lm1', { diameter: 0.3 }, scene);
    lMesh.parent = corridorMesh;
    lightEnt.bindView(lMesh);
    entityManager.addEntity(lightEnt);

    // 3. Crear el jugador
    const playerEntity = new GameEntity('player_tester', 'Player', 'model', 'player');
    const pMesh = MeshBuilder.CreateCapsule('pMesh', { radius: 0.4, height: 1.8 }, scene);
    pMesh.position.set(0, 1, 0);
    playerEntity.bindView(pMesh);
    playerEntity.playerConfig = {
      culling: { enabled: true, cullDistance: 60, fadeMargin: 20 }
    } as any;
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    spatialHub.start();
    lightingSystem.prepareAllLights();
    localRendering.start();
    localRendering.reconcileAllEntitiesImmediate(pMesh.position);

    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // FASE 1: Jugador en el centro del pasillo (Activación Inicial)
    lightDistance.evaluateDistanceAndHysteresis([vl], pMesh.position, 0);
    lightAllocation.allocatePoolSlots([vl], pMesh.position, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    const slotInitial = lightPool.findSlotByUid(lightEnt.uid);
    expect(slotInitial).toBeDefined();
    expect(slotInitial!.currentIntensity).toBeGreaterThan(0);
    expect(slotInitial!.sg).toBeDefined();

    const initialRenderList = slotInitial!.sg!.getShadowMap()?.renderList;
    expect(initialRenderList).toBeDefined();
    expect(initialRenderList!.length).toBeGreaterThan(0);
    expect(initialRenderList!).toContain(corridorMesh);

    // FASE 2: Jugador se aleja a 100m (Provoca Culling y Desactivación de Luz)
    pMesh.position.set(0, 1, 100);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 60; f++) {
      localRendering.update(16.66);
      lightDistance.evaluateDistanceAndHysteresis([vl], pMesh.position, 0);
      lightAllocation.allocatePoolSlots([vl], pMesh.position, Vector3.Zero(), 0, null);
      lightingSystem.update(16.66);
    }

    // La luz debe haberse desactivado
    expect(vl.targetMultiplier).toBe(0.0);
    expect(vl.currentMultiplier).toBe(0.0);

    // FASE 3: Jugador vuelve al pasillo (Reactivación)
    pMesh.position.set(0, 1, 0);
    spatialHub.preUpdate(16.66);

    for (let f = 0; f < 30; f++) {
      localRendering.update(16.66);
      lightDistance.evaluateDistanceAndHysteresis([vl], pMesh.position, 0);
      lightAllocation.allocatePoolSlots([vl], pMesh.position, Vector3.Zero(), 0, null);
      lightingSystem.update(16.66);
    }

    // VERIFICACIÓN DEL RESULTADO:
    const slotReactivated = lightPool.findSlotByUid(lightEnt.uid);
    expect(slotReactivated).toBeDefined();
    expect(slotReactivated!.currentIntensity).toBeGreaterThan(0.9);

    // Las paredes del pasillo volvieron a ser casters válidos en la renderList del ShadowGenerator
    const reactivatedRenderList = slotReactivated!.sg!.getShadowMap()?.renderList;
    expect(reactivatedRenderList).toBeDefined();
    expect(reactivatedRenderList!.length).toBeGreaterThan(0);
    expect(reactivatedRenderList!).toContain(corridorMesh);

    // Las paredes no deben haber quedado deshabilitadas
    expect(corridorMesh.isEnabled()).toBe(true);
    expect(corridorMesh.isVisible).toBe(true);

    // Al estar affectDescendantsOnly en false, includedOnlyMeshes queda libre para iluminar el exterior
    const lightObj = slotReactivated!.light as any;
    expect(lightObj.includedOnlyMeshes.length).toBe(0);
  });
});