import { TestBed } from "@angular/core/testing";
import { Scene, NullEngine, MeshBuilder, Vector3 } from "@babylonjs/core";
import { EntityManagerService } from "../../../../../../core/engine/entities/entity-manager.service";
import { GameEntity } from "../../../../../../core/engine/entities/game.entity";
import { DynamicLightingSystem } from "../../../../../../core/engine/runtime/systems/lighting/dynamic-lighting.system";
import { LightAllocationService } from "../../../../../../core/engine/runtime/systems/lighting/light-allocation.service";
import { LightDistanceService } from "../../../../../../core/engine/runtime/systems/lighting/light-distance.service";
import { SCENE_ACCESS_TOKEN } from "../../../../../../core/engine/scene/scene-access.token";
import { GameContextService } from "../../../../../../core/engine/session/game-context.service";
import { SpatialRelevanceHubService } from "../../../../../../core/engine/spatial/spatial-relevance-hub.service";
import { SpatialStreamingGroupService } from "../../../../../../core/engine/spatial/spatial-streaming-group.service";
import { EngineProfilerService } from "../../../../../../core/engine/telemetry/engine-profiler.service";

 
describe('FASE 5 — Activación Espacial Predictiva por Zonas', () => {
  let spatialGroups: SpatialStreamingGroupService;
  let entityManager: EntityManagerService;
  let lightAllocation: LightAllocationService;
  let lightDistance: LightDistanceService;
  let lightingSystem: DynamicLightingSystem;
  let scene: Scene;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);

    TestBed.configureTestingModule({
      providers: [
        SpatialStreamingGroupService,
        EntityManagerService,
        SpatialRelevanceHubService,
        EngineProfilerService,
        LightAllocationService,
        LightDistanceService,
        DynamicLightingSystem,
        GameContextService,
        {
          provide: SCENE_ACCESS_TOKEN,
          useValue: { getScene: () => scene, getEngine: () => engine }
        }
      ]
    });

    spatialGroups = TestBed.inject(SpatialStreamingGroupService);
    entityManager = TestBed.inject(EntityManagerService);
    lightAllocation = TestBed.inject(LightAllocationService);
    lightDistance = TestBed.inject(LightDistanceService);
    lightingSystem = TestBed.inject(DynamicLightingSystem);
  });

  it('TEST A: Detección de Grupo Espacial Actual y Grupos Vecinos Topológicos', () => {
    // Sala A (X: 0, Z: 0) y Pasillo B contiguo (X: 0, Z: 50)
    const roomA = new GameEntity('room_a', 'Sala_A', 'model');
    const meshA = MeshBuilder.CreateBox('m_a', { width: 30, height: 6, depth: 30 }, scene);
    meshA.position.set(0, 3, 0);
    roomA.bindView(meshA);
    entityManager.addEntity(roomA);

    const corridorB = new GameEntity('corridor_b', 'Pasillo_B', 'model');
    const meshB = MeshBuilder.CreateBox('m_b', { width: 8, height: 4, depth: 40 }, scene);
    meshB.position.set(0, 2, 45); // Contiguo, distancia entre cajas < 28m
    corridorB.bindView(meshB);
    entityManager.addEntity(corridorB);

    spatialGroups.buildGroups();

    const grpA = spatialGroups.getGroupForEntity('room_a');
    const grpB = spatialGroups.getGroupForEntity('corridor_b');

    expect(grpA).toBeDefined();
    expect(grpB).toBeDefined();
    expect(grpA!.neighborGroupIds.has(grpB!.id)).toBe(true);
    expect(grpB!.neighborGroupIds.has(grpA!.id)).toBe(true);
  });

  it('TEST B: Look-Ahead Predictivo transiciona el Pasillo B a PREACTIVATING antes de cruzar la puerta', () => {
    const roomA = new GameEntity('room_a2', 'Sala_A2', 'model');
    const meshA = MeshBuilder.CreateBox('m_a2', { width: 30, height: 6, depth: 30 }, scene);
    meshA.position.set(0, 3, 0);
    roomA.bindView(meshA);
    entityManager.addEntity(roomA);

    const corridorB = new GameEntity('corridor_b2', 'Pasillo_B2', 'model');
    const meshB = MeshBuilder.CreateBox('m_b2', { width: 8, height: 4, depth: 40 }, scene);
    meshB.position.set(0, 2, 45);
    corridorB.bindView(meshB);
    entityManager.addEntity(corridorB);

    spatialGroups.buildGroups();

    // Jugador en el centro de Sala A avanzando hacia el norte (+Z) a 12 m/s
    const playerPos = new Vector3(0, 1, 5);
    const playerVel = new Vector3(0, 0, 12);

    spatialGroups.updateGroups(playerPos, playerVel);

    const grpA = spatialGroups.getGroupForEntity('room_a2');
    const grpB = spatialGroups.getGroupForEntity('corridor_b2');

    expect(grpA!.state).toBe('ACTIVE');
    expect(grpB!.directionDot).toBeGreaterThan(0.5);
    // El pasillo pasa a PREACTIVATING gracias a la proyección de avance sin esperar a que el jugador cruce
    expect(grpB!.state).toBe('PREACTIVATING');
    expect(spatialGroups.getPreactivatingGroupIds().has(grpB!.id)).toBe(true);
  });

  it('TEST C: Luz interior en Pasillo B se calienta anticipadamente durante PREACTIVATING', () => {
    const corridorB = new GameEntity('corridor_b3', 'Pasillo_B3', 'model');
    const meshB = MeshBuilder.CreateBox('m_b3', { width: 8, height: 4, depth: 40 }, scene);
    meshB.position.set(0, 2, 50);
    corridorB.bindView(meshB);
    entityManager.addEntity(corridorB);

    const lightEnt = new GameEntity('luz_corredor_b3', 'Luz_Corredor', 'light_point');
    lightEnt.light!.enabled = true;
    lightEnt.light!.containmentMode = 'INTERIOR';
    lightEnt.light!.interiorActivationMode = 'VOLUME';
    lightEnt.light!.preEntryEnabled = true;
    lightEnt.light!.preEntryDistance = 6.0;
    lightEnt.light!.containerEntityUid = corridorB.uid;
    lightEnt.transform.position = { x: 0, y: 3.5, z: 50 };
    const lMesh = MeshBuilder.CreateSphere('lm_3', { diameter: 0.5 }, scene);
    lightEnt.bindView(lMesh);
    entityManager.addEntity(lightEnt);

    spatialGroups.buildGroups();
    lightingSystem.prepareAllLights();

    const vl = lightingSystem.registerOrUpdateVirtualLight(lightEnt);

    // Jugador aproximándose a 20 metros de la entrada (fuera del volumen y fuera del umbral estricto de pre-entrada de 6m)
    // Con velocidad hacia adelante
    const playerPos = new Vector3(0, 1, 10);
    const playerVel = new Vector3(0, 0, 13);
    spatialGroups.updateGroups(playerPos, playerVel);

    lightDistance.evaluateDistanceAndHysteresis([vl], playerPos, 13);

    // Gracias al grupo en estado PREACTIVATING, la luz activa su flag _isInPrepareRange
    expect(vl._isInPrepareRange).toBe(true);

    lightAllocation.allocatePoolSlots([vl], playerPos, new Vector3(0, 0, 1), 13, null);

    // La luz interior obtiene puntuación favorable anticipada y asegura su slot antes de que el jugador llegue
    expect(vl.poolRank).toBe(1);
    const activeSlots = lightingSystem.getProfilerMetrics().slots.filter(s => s.assigned);
    expect(activeSlots.length).toBe(1);
  });
});