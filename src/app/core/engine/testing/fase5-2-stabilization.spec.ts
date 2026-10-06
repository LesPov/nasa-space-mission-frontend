
// file: src/app/core/engine/testing/fase5-2-stabilization.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Scene, NullEngine, MeshBuilder, Vector3 } from '@babylonjs/core';
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

describe('FASE 5.2 — Estabilización Visual, Light Pool 3+2 y Continuidad de Render', () => {
  let lightingSystem: DynamicLightingSystem;
  let lightAllocation: LightAllocationService;
  let lightPool: LightPoolService;
  let lightDistance: LightDistanceService;
  let localRendering: LocalRenderingSystem;
  let entityManager: EntityManagerService;
  let spatialHub: SpatialRelevanceHubService;
  let gameContext: GameContextService;
  let scene: Scene;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);

    TestBed.configureTestingModule({
      providers: [
        DynamicLightingSystem,
        LightAllocationService,
        LightPoolService,
        LightDistanceService,
        LightShadowService,
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
          useValue: { getScene: () => scene, getEngine: () => engine }
        }
      ]
    });

    lightingSystem = TestBed.inject(DynamicLightingSystem);
    lightAllocation = TestBed.inject(LightAllocationService);
    lightPool = TestBed.inject(LightPoolService);
    lightDistance = TestBed.inject(LightDistanceService);
    localRendering = TestBed.inject(LocalRenderingSystem);
    entityManager = TestBed.inject(EntityManagerService);
    spatialHub = TestBed.inject(SpatialRelevanceHubService);
    gameContext = TestBed.inject(GameContextService);

    gameContext.setupContext('PLAYER_PREVIEW');
  });

  it('TEST 1: Presupuesto Estricto — Nunca más de 3 luces físicas activas con 5 candidatas', () => {
    const lights: GameEntity[] = [];
    for (let i = 0; i < 5; i++) {
      const l = new GameEntity(`light_${i}`, `Luz_${i}`, 'light_point');
      l.light!.enabled = true;
      l.light!.activationDistance = 20;
      l.light!.deactivationDistance = 30;
      l.transform.position = { x: 0, y: 3, z: i * 5 };
      const m = MeshBuilder.CreateSphere(`m_l_${i}`, { diameter: 0.5 }, scene);
      l.bindView(m);
      entityManager.addEntity(l);
      lights.push(l);
    }

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const playerPos = new Vector3(0, 1, 0);
    const virtuals = lights.map(l => lightingSystem.registerOrUpdateVirtualLight(l));

    lightDistance.evaluateDistanceAndHysteresis(virtuals, playerPos, 0);
    lightAllocation.allocatePoolSlots(virtuals, playerPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    const metrics = lightingSystem.getFastMetrics();
    // Exigencia del contrato: Máximo 3 luces físicas activas simultáneas
    expect(metrics.activePool).toBeLessThanOrEqual(3);

    // Las candidatas 4 y 5 deben estar PREPARED pero sin slot físico activo
    expect(virtuals[0].poolRank).toBe(1);
    expect(virtuals[1].poolRank).toBe(2);
    expect(virtuals[2].poolRank).toBe(3);
    expect(virtuals[3].lifecycleStage).toBe('PREPARED');
    expect(virtuals[4].lifecycleStage).toBe('PREPARED');
  });

  it('TEST 2: Sombra Estratificada — La luz más cercana recibe Tier HIGH y las secundarias menor coste', () => {
    const lights: GameEntity[] = [];
    for (let i = 0; i < 3; i++) {
      const l = new GameEntity(`light_tier_${i}`, `Luz_Tier_${i}`, 'light_point');
      l.light!.enabled = true;
      l.light!.castShadows = true;
      l.light!.activationDistance = 30;
      l.light!.deactivationDistance = 40;
      l.transform.position = { x: 0, y: 3, z: (i + 1) * 8 }; // 8m, 16m, 24m
      const m = MeshBuilder.CreateSphere(`m_lt_${i}`, { diameter: 0.5 }, scene);
      l.bindView(m);
      entityManager.addEntity(l);
      lights.push(l);
    }

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const playerPos = new Vector3(0, 1, 0);
    const virtuals = lights.map(l => lightingSystem.registerOrUpdateVirtualLight(l));

    lightDistance.evaluateDistanceAndHysteresis(virtuals, playerPos, 0);
    lightAllocation.allocatePoolSlots(virtuals, playerPos, Vector3.Zero(), 0, null);

    expect(virtuals[0].shadowTier).toBe('HIGH');
    expect(virtuals[1].shadowTier).toBe('MEDIUM');
    expect(virtuals[2].shadowTier).toBe('LOW');
  });

  it('TEST 3: Continuidad Visual — Los cambios en las luces NO apagan mallas de la escena', () => {
    // 1. Crear un prop visible
    const prop = new GameEntity('prop_corridor_wall', 'Pared_Pasillo', 'model');
    const wallMesh = MeshBuilder.CreateBox('wall_mesh', { width: 1, height: 4, depth: 10 }, scene);
    wallMesh.position.set(2, 2, 0);
    prop.bindView(wallMesh);
    entityManager.addEntity(prop);

    // 2. Crear una luz que cambiará de estado
    const l1 = new GameEntity('light_switch', 'Luz_Conmutable', 'light_point');
    l1.light!.enabled = true;
    l1.light!.activationDistance = 15;
    l1.light!.deactivationDistance = 25;
    l1.transform.position = { x: 0, y: 3, z: 0 };
    const lm1 = MeshBuilder.CreateSphere('lm1', { diameter: 0.5 }, scene);
    l1.bindView(lm1);
    entityManager.addEntity(l1);

    spatialHub.start();
    localRendering.start();
    lightingSystem.prepareAllLights();
    localRendering.reconcileAllEntitiesImmediate(new Vector3(0, 1, 0));

    expect(wallMesh.isEnabled()).toBe(true);
    expect(wallMesh.isVisible).toBe(true);

    // 3. Forzar el apagado o liberación de la luz (Light transition)
    l1.light!.enabled = false;
    lightingSystem.syncLightImmediate(l1, true);

    // La malla del escenario debe permanecer 100% activa e intacta
    expect(wallMesh.isEnabled()).toBe(true);
    expect(wallMesh.isVisible).toBe(true);
  });
});