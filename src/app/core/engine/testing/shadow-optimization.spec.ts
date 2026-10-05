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
import { SpatialStreamingGroupService } from '../spatial/spatial-streaming-group.service';

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
  let spatialGroups: SpatialStreamingGroupService;
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
        SpatialStreamingGroupService,
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
    spatialGroups = TestBed.inject(SpatialStreamingGroupService);
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
    expect(vl.isLightInRange).toBe(true);

    allocationService.allocatePoolSlots([vl], pPosRun, runDir, runSpeed, null);

    const poolSlots = lightingSystem.getProfilerMetrics().slots;
    const assignedSlot = poolSlots.find(s => s.assigned);
    expect(assignedSlot).toBeDefined();

    lightingSystem.update(16.66);
    expect(vl.currentMultiplier).toBeGreaterThan(0.0);
    expect(vl.currentMultiplier).toBeLessThan(1.0);
  });

  it('TEST B: Descalificación de luz interior en el allocation cuando Player está verdaderamente en OUTSIDE lejos de la retención', () => {
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

    // Jugador a 50m lateralmente (lejos del pasillo y fuera de cualquier zona de keep-alive)
    const farOutsidePos = new Vector3(50, 1, 0);
    distanceService.evaluateDistanceAndHysteresis([vl], farOutsidePos, 0);
    expect(vl.spatialState).toBe('OUTSIDE');

    allocationService.allocatePoolSlots([vl], farOutsidePos, Vector3.Zero(), 0, null);

    expect(vl.rejectionReason).toBe('OUTSIDE_INTERIOR_VOLUME');
    expect(vl.poolRank).toBe(0);
    const assignedSlot = lightingSystem.getProfilerMetrics().slots.find(s => s.assigned);
    expect(assignedSlot).toBeUndefined();
  });

  it('TEST C: Luz interior en pasillo anterior permanece activa y en PRE_EXIT al girar hacia un pasillo contiguo', () => {
    // Pasillo A (centro en 0, 0) y Pasillo B contiguo girado
    const corridorA = new GameEntity('corridor_a', 'Pasillo_A', 'model');
    const meshA = MeshBuilder.CreateBox('c_mesh_a', { width: 8, height: 4, depth: 20 }, scene);
    meshA.position.set(0, 2, 0);
    corridorA.bindView(meshA);
    entityManager.addEntity(corridorA);

    const lightA = new GameEntity('luz_pasillo_a', 'Luz_A', 'light_point');
    lightA.light!.enabled = true;
    lightA.light!.containmentMode = 'INTERIOR';
    lightA.light!.interiorActivationMode = 'VOLUME';
    lightA.light!.preEntryEnabled = true;
    lightA.light!.preEntryDistance = 6.0;
    lightA.light!.containerEntityUid = corridorA.uid;
    lightA.transform.position = { x: 0, y: 3, z: 0 };
    const lMeshA = MeshBuilder.CreateSphere('lm_a', { diameter: 0.5 }, scene);
    lightA.bindView(lMeshA);
    entityManager.addEntity(lightA);

    spatialGroups.buildGroups();
    spatialHub.start();
    lightingSystem.prepareAllLights();
    const vlA = lightingSystem.registerOrUpdateVirtualLight(lightA);

    // 1. Jugador inicialmente en el centro del Pasillo A
    const posInsideA = new Vector3(0, 1, 0);
    spatialHub.preUpdate(16.66);
    distanceService.evaluateDistanceAndHysteresis([vlA], posInsideA, 0);
    allocationService.allocatePoolSlots([vlA], posInsideA, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    expect(vlA.spatialState).toBe('INSIDE');
    expect(vlA.targetMultiplier).toBe(1.0);
    expect(vlA.isLightInRange).toBe(true);

    // 2. Jugador sale del pasillo A doblando la esquina (Z = 16m, a 6m de la puerta en Z=10m)
    // Con la nueva zona de retención asimétrica, no debe pasar a OUTSIDE ni apagarse
    const posTurnB = new Vector3(6, 1, 14);
    spatialHub.preUpdate(16.66);
    distanceService.evaluateDistanceAndHysteresis([vlA], posTurnB, 4.0);

    expect(vlA.spatialState).toBe('PRE_EXIT');
    expect(vlA.isLightInRange).toBe(true);
    expect(vlA.targetMultiplier).toBeGreaterThan(0.5);

    allocationService.allocatePoolSlots([vlA], posTurnB, new Vector3(1, 0, 0), 4.0, null);

    const activeSlots = lightingSystem.getProfilerMetrics().slots.filter(s => s.assigned);
    expect(activeSlots.length).toBe(1);
  });

  it('TEST D (FASE D): SpatialRelevanceHub centraliza las distancias y responde en O(1) con auto-registro bajo demanda', () => {
    spatialHub.start();

    const entTest = new GameEntity('ent_test_hub', 'Entidad_Test', 'model');
    const meshTest = MeshBuilder.CreateBox('mesh_test_hub', { size: 2 }, scene);
    meshTest.position.set(0, 1, 20);
    entTest.bindView(meshTest);
    entityManager.addEntity(entTest);

    const distSq = spatialHub.getDistanceSquaredToPlayer('ent_test_hub');
    expect(Number.isFinite(distSq)).toBe(true);

    const initialHits = spatialHub.getMetrics().cacheHits;
    const distExact = spatialHub.getDistanceToPlayer('ent_test_hub');
    expect(distExact).toBeCloseTo(20.0, 0);
    expect(spatialHub.getMetrics().cacheHits).toBeGreaterThan(initialHits);
  });
});