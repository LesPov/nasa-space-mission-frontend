
// file: src/app/core/engine/testing/shadow-optimization.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DynamicLightingSystem } from '../runtime/systems/lighting/dynamic-lighting.system';
import { ShadowOrchestratorService } from '../runtime/shadows/shadow-orchestrator.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { LightAllocationService } from '../runtime/systems/lighting/light-allocation.service';
import { LightDistanceService } from '../runtime/systems/lighting/light-distance.service';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { GameEntity } from '../entities/game.entity';
import { MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { ShadowLODManager } from '../runtime/shadows/shadow-lod-manager.service';
import { GameContextService } from '../session/game-context.service';
import { SpatialRelevanceHubService } from '../spatial/spatial-relevance-hub.service';

describe('FASE C y FASE D — Verificación Definitiva de Contención de Luces y Hub Espacial Centralizado', () => {
  let lightingSystem: DynamicLightingSystem;
  let orchestrator: ShadowOrchestratorService;
  let entityManager: EntityManagerService;
  let lodManager: ShadowLODManager;
  let allocationService: LightAllocationService;
  let distanceService: LightDistanceService;
  let containmentSvc: LightContainmentService;
  let gameContext: GameContextService;
  let spatialHub: SpatialRelevanceHubService;
  let scene: Scene;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);

    TestBed.configureTestingModule({
      providers: [
        DynamicLightingSystem,
        ShadowOrchestratorService,
        EntityManagerService,
        ShadowLODManager,
        LightAllocationService,
        LightDistanceService,
        LightContainmentService,
        SpatialRelevanceHubService,
        GameContextService,
        {
          provide: SCENE_ACCESS_TOKEN,
          useValue: { getScene: () => scene, getEngine: () => engine }
        }
      ]
    });

    lightingSystem = TestBed.inject(DynamicLightingSystem);
    orchestrator = TestBed.inject(ShadowOrchestratorService);
    entityManager = TestBed.inject(EntityManagerService);
    lodManager = TestBed.inject(ShadowLODManager);
    allocationService = TestBed.inject(LightAllocationService);
    distanceService = TestBed.inject(LightDistanceService);
    containmentSvc = TestBed.inject(LightContainmentService);
    gameContext = TestBed.inject(GameContextService);
    spatialHub = TestBed.inject(SpatialRelevanceHubService);
  });

  it('TEST A: El Player alejándose CORRIENDO mantiene la transición continua de fade sin saltar a cero bruscamente', () => {
    const lightEnt = new GameEntity('luz_radial_run', 'Luz_Radial', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.containmentMode = 'GLOBAL';
    lightEnt.light!.activationDistance = 20;
    lightEnt.light!.deactivationDistance = 30;
    lightEnt.transform.position = { x: 0, y: 3, z: 0 };
    
    const lMesh = MeshBuilder.CreateSphere('lm_run', { diameter: 0.5 }, scene);
    lightEnt.bindView(lMesh);
    entityManager.addEntity(lightEnt);

    spatialHub.start();
    lightingSystem.prepareAllLights();
    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // 1. Jugador inicialmente cerca (10m) -> 100% de intensidad
    const pPosNear = new Vector3(0, 1, 10);
    spatialHub.preUpdate(16.66);
    distanceService.evaluateDistanceAndHysteresis([vl], pPosNear, 0);
    allocationService.allocatePoolSlots([vl], pPosNear, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    expect(vl.targetMultiplier).toBe(1.0);
    expect(vl.currentMultiplier).toBeGreaterThan(0.9);
    expect(vl.isLightInRange).toBe(true);

    // 2. Jugador se aleja CORRIENDO a 14 m/s (en 1 frame pasa a Z = 32m, cruzando deactivationDistance = 30m)
    const pPosRun = new Vector3(0, 1, 32);
    const runDir = new Vector3(0, 0, 1);
    const runSpeed = 14.0;

    spatialHub.preUpdate(16.66);
    distanceService.evaluateDistanceAndHysteresis([vl], pPosRun, runSpeed);

    // La luz debe entrar en FADING_OUT, conservando su retención en el pool y no saltando a 0
    expect(vl.targetMultiplier).toBe(0.0);
    expect(vl.isLightInRange).toBe(true); // Retenida durante el desvanecimiento

    allocationService.allocatePoolSlots([vl], pPosRun, runDir, runSpeed, null);

    const poolSlots = lightingSystem.getProfilerMetrics().slots;
    const assignedSlot = poolSlots.find(s => s.assigned);
    expect(assignedSlot).toBeDefined();

    lightingSystem.update(16.66);
    expect(vl.currentMultiplier).toBeGreaterThan(0.0);
    expect(vl.currentMultiplier).toBeLessThan(1.0);
  });

  it('TEST B: Descalificación de luz interior en el allocation cuando Player está en OUTSIDE', () => {
    const corridor = new GameEntity('corridor_model_test_e', 'Pasillo_E', 'model');
    const corridorMesh = MeshBuilder.CreateBox('c_mesh_e', { width: 10, height: 4, depth: 60 }, scene);
    corridorMesh.position.set(0, 2, 0);
    corridor.bindView(corridorMesh);
    entityManager.addEntity(corridor);

    const lightEnt = new GameEntity('luz_interior_e', 'Luz_E', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.containmentMode = 'INTERIOR';
    lightEnt.light!.interiorActivationMode = 'VOLUME';
    lightEnt.light!.containerEntityUid = corridor.uid;
    lightEnt.transform.position = { x: 0, y: 3, z: 0 };

    const lightMesh = MeshBuilder.CreateSphere('l_mesh_e', { diameter: 0.5 }, scene);
    lightEnt.bindView(lightMesh);
    entityManager.addEntity(lightEnt);

    spatialHub.start();
    lightingSystem.prepareAllLights();
    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    const outsidePos = new Vector3(15, 1, 0);
    distanceService.evaluateDistanceAndHysteresis([vl], outsidePos, 0);
    expect(vl.spatialState).toBe('OUTSIDE');

    allocationService.allocatePoolSlots([vl], outsidePos, Vector3.Zero(), 0, null);

    expect(vl.rejectionReason).toBe('OUTSIDE_INTERIOR_VOLUME');
    expect(vl.poolRank).toBe(0);
    const assignedSlot = lightingSystem.getProfilerMetrics().slots.find(s => s.assigned);
    expect(assignedSlot).toBeUndefined();
  });

  it('TEST C (FASE D): SpatialRelevanceHub centraliza las distancias y responde en O(1) con auto-registro bajo demanda', () => {
    spatialHub.start();

    const entTest = new GameEntity('ent_test_hub', 'Entidad_Test', 'model');
    const meshTest = MeshBuilder.CreateBox('mesh_test_hub', { size: 2 }, scene);
    meshTest.position.set(0, 1, 20);
    entTest.bindView(meshTest);
    entityManager.addEntity(entTest);

    // Consulta de una entidad recién creada sin rebuild explícito (debe auto-registrarse sin undefined)
    const distSq = spatialHub.getDistanceSquaredToPlayer('ent_test_hub');
    expect(Number.isFinite(distSq)).toBe(true);

    // Consulta subsecuente debe ser un Cache Hit garantizado
    const initialHits = spatialHub.getMetrics().cacheHits;
    const distExact = spatialHub.getDistanceToPlayer('ent_test_hub');
    expect(distExact).toBeCloseTo(20.0, 0);
    expect(spatialHub.getMetrics().cacheHits).toBeGreaterThan(initialHits);
  });
});