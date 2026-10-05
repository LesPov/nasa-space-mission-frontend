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

describe('FASE C — Corrección Definitiva: Geometría de Modelos 3D y Contención Real', () => {
  let lightingSystem: DynamicLightingSystem;
  let orchestrator: ShadowOrchestratorService;
  let entityManager: EntityManagerService;
  let lodManager: ShadowLODManager;
  let allocationService: LightAllocationService;
  let distanceService: LightDistanceService;
  let containmentSvc: LightContainmentService;
  let gameContext: GameContextService;
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
  });

  it('TEST A: El Player caminando por el exterior de un pasillo NO activa la luz interior', () => {
    // Pasillo rectangular de 10 x 4 x 60 en Z = -30 a +30
    const corridor = new GameEntity('corridor_model_test', 'Pasillo_A', 'model');
    const corridorMesh = MeshBuilder.CreateBox('c_mesh', { width: 10, height: 4, depth: 60 }, scene);
    corridorMesh.position.set(0, 2, 0);
    corridor.bindView(corridorMesh);
    entityManager.addEntity(corridor);

    const lightEnt = new GameEntity('luz_interior_1', 'Luz_1', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.containmentMode = 'INTERIOR';
    lightEnt.light!.interiorActivationMode = 'VOLUME';
    lightEnt.light!.preEntryEnabled = true;
    lightEnt.light!.preEntryDistance = 8.0;
    lightEnt.light!.containerEntityUid = corridor.uid;
    lightEnt.transform.position = { x: 0, y: 3, z: 0 };
    
    const lightMesh = MeshBuilder.CreateSphere('l_mesh', { diameter: 0.5 }, scene);
    lightEnt.bindView(lightMesh);
    entityManager.addEntity(lightEnt);

    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // Player al lado de la pared exterior (X = 8m, pared en X = 5m, Z = 0m).
    // Está dentro del AABB en Y y Z, pero fuera de la entrada (distancia a la abertura = 30m).
    const playerOutsidePos = new Vector3(8, 1, 0);
    distanceService.evaluateDistanceAndHysteresis([vl], playerOutsidePos, 0);

    expect(vl.insideVolume).toBe(false);
    expect(vl.spatialState).toBe('OUTSIDE');
    expect(vl.isLightInRange).toBe(false);
    expect(vl.targetMultiplier).toBe(0.0);
  });

  it('TEST B: La luz se activa al entrar realmente en la abertura del modelo (PRE_ENTRY y luego INSIDE)', () => {
    const corridor = new GameEntity('corridor_model_test2', 'Pasillo_B', 'model');
    const corridorMesh = MeshBuilder.CreateBox('c_mesh2', { width: 10, height: 4, depth: 60 }, scene);
    corridorMesh.position.set(0, 2, 0); // Abertura frontal en Z = 30m
    corridor.bindView(corridorMesh);
    entityManager.addEntity(corridor);

    const lightEnt = new GameEntity('luz_interior_2', 'Luz_2', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.castShadows = true;
    lightEnt.light!.containmentMode = 'INTERIOR';
    lightEnt.light!.interiorActivationMode = 'VOLUME';
    lightEnt.light!.preEntryEnabled = true;
    lightEnt.light!.preEntryDistance = 8.0;
    lightEnt.light!.linkShadowPreEntryToLightPreEntry = true;
    lightEnt.light!.containerEntityUid = corridor.uid;
    lightEnt.transform.position = { x: 0, y: 3, z: 0 };
    
    const lightMesh = MeshBuilder.CreateSphere('l_mesh2', { diameter: 0.5 }, scene);
    lightEnt.bindView(lightMesh);
    entityManager.addEntity(lightEnt);

    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // 1. A 5 metros de la abertura frontal (Z = 35m) -> PRE-ENTRY (8m threshold)
    distanceService.evaluateDistanceAndHysteresis([vl], new Vector3(0, 1, 35), 0);
    expect(vl.spatialState).toBe('PRE_ENTRY');
    expect(vl.isLightInRange).toBe(true);
    expect(vl.isShadowInRange).toBe(true);
    expect(vl.targetMultiplier).toBeGreaterThan(0.0);

    // 2. Adentro del pasillo (Z = 20m) -> INSIDE (100% brillo y sombra activa)
    distanceService.evaluateDistanceAndHysteresis([vl], new Vector3(0, 1, 20), 0);
    expect(vl.spatialState).toBe('INSIDE');
    expect(vl.isLightInRange).toBe(true);
    expect(vl.isShadowInRange).toBe(true);
    expect(vl.targetMultiplier).toBe(1.0);
  });

  it('TEST C: Un modelo de 60x60x60 no utiliza su centro para determinar preEntry', () => {
    const corridor = new GameEntity('corridor_model_test3', 'Pasillo_C', 'model');
    const corridorMesh = MeshBuilder.CreateBox('c_mesh3', { width: 10, height: 4, depth: 60 }, scene);
    corridorMesh.position.set(0, 2, 0); // Centro en (0, 2, 0)
    corridor.bindView(corridorMesh);
    entityManager.addEntity(corridor);

    const lightEnt = new GameEntity('luz_interior_3', 'Luz_3', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.containmentMode = 'INTERIOR';
    lightEnt.light!.interiorActivationMode = 'VOLUME';
    lightEnt.light!.preEntryEnabled = true;
    lightEnt.light!.preEntryDistance = 8.0;
    lightEnt.light!.containerEntityUid = corridor.uid;
    lightEnt.transform.position = { x: 0, y: 3, z: 0 };

    const lightMesh = MeshBuilder.CreateSphere('l_mesh3', { diameter: 0.5 }, scene);
    lightEnt.bindView(lightMesh);
    entityManager.addEntity(lightEnt);

    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // Player a 35m del centro (Z = 35m). Si usara el centro, 35 > 8 -> daría OUTSIDE.
    // Como usa la abertura frontal (Z = 30m), está a 5m de la entrada -> PRE_ENTRY correcto.
    distanceService.evaluateDistanceAndHysteresis([vl], new Vector3(0, 1, 35), 0);
    expect(vl.spatialState).toBe('PRE_ENTRY');
    expect(vl.distanceToBoundary).toBeCloseTo(5.0, 1);
  });

  it('TEST D: En modo EDITOR puro, las luces no realizan raycasts pesados por frame', () => {
    gameContext.setupContext('EDITOR', { submode: 'EDITING' });

    for (let i = 0; i < 3; i++) {
      const ent = new GameEntity(`luz_ed_${i}`, `LuzEd_${i}`, 'light_point');
      ent.light!.enabled = true;
      ent.transform.position = { x: i * 5, y: 2, z: 0 };
      const m = MeshBuilder.CreateBox(`b_${i}`, { size: 0.5 }, scene);
      ent.bindView(m);
      entityManager.addEntity(ent);
    }

    lightingSystem.prepareAllLights();
    const evalsBefore = containmentSvc.metrics.preciseEvaluations;

    // Simular 10 frames de update en modo Editor sin movimiento ni selección
    for (let f = 0; f < 10; f++) {
      lightingSystem.update(16.66);
    }

    const evalsAfter = containmentSvc.metrics.preciseEvaluations;
    // No se ejecutan raycasts repetitivos por frame en reposo en el editor
    expect(evalsAfter - evalsBefore).toBe(0);
  });

  it('TEST E: Descalificación de luz interior en el allocation cuando Player está en OUTSIDE', () => {
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

    lightingSystem.prepareAllLights();
    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // Player afuera en X = 15
    const outsidePos = new Vector3(15, 1, 0);
    distanceService.evaluateDistanceAndHysteresis([vl], outsidePos, 0);
    expect(vl.spatialState).toBe('OUTSIDE');

    allocationService.allocatePoolSlots([vl], outsidePos, Vector3.Zero(), 0, null);

    // La luz interior queda formalmente rechazada y no adquiere ningún slot físico
    expect(vl.rejectionReason).toBe('OUTSIDE_INTERIOR_VOLUME');
    expect(vl.poolRank).toBe(0);
    const assignedSlot = lightingSystem.getProfilerMetrics().slots.find(s => s.assigned);
    expect(assignedSlot).toBeUndefined();
  });
});