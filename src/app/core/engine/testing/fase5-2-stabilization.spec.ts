
// file: src/app/core/engine/testing/fase5-2-stabilization.spec.ts
import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

import { setupBrowserMocks } from './mocks/browser.mock';
setupBrowserMocks();

if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Scene, NullEngine, MeshBuilder, Vector3, Color3, ArcRotateCamera, UniversalCamera } from '@babylonjs/core';
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
import { LIGHT_SPATIAL_CONSTANTS } from '../runtime/systems/lighting/lighting-types';
import { LightContainmentService } from '../runtime/systems/lighting/light-containment.service';
import { ShadowLODManager } from '../runtime/shadows/shadow-lod-manager.service';
import { ShadowCache } from '../runtime/shadows/shadow-cache.service';
import { ShadowQualityService } from '../runtime/shadows/shadow-quality.service';

describe('FASE 0.2 — Estabilización de Pool Físico y Shaders (BUG-02)', () => {
  let lightingSystem: DynamicLightingSystem;
  let lightAllocation: LightAllocationService;
  let lightPool: LightPoolService;
  let lightDistance: LightDistanceService;
  let localRendering: LocalRenderingSystem;
  let entityManager: EntityManagerService;
  let spatialHub: SpatialRelevanceHubService;
  let gameContext: GameContextService;
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
    localRendering = TestBed.inject(LocalRenderingSystem);
    entityManager = TestBed.inject(EntityManagerService);
    spatialHub = TestBed.inject(SpatialRelevanceHubService);
    gameContext = TestBed.inject(GameContextService);

    gameContext.setupContext('PLAYER_PREVIEW');
  });

  it('TEST 1: Inmutabilidad de setEnabled — Las luces físicas del pool NO se apagan con setEnabled(false) en transiciones normales', () => {
    const l1 = new GameEntity('light_trans_1', 'Luz_1', 'light_point');
    l1.light!.enabled = true;
    l1.light!.activationDistance = 15;
    l1.light!.deactivationDistance = 25;
    l1.transform.position = { x: 0, y: 3, z: 0 };
    const m1 = MeshBuilder.CreateSphere('m1', { diameter: 0.5 }, scene);
    l1.bindView(m1);
    entityManager.addEntity(l1);

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const poolSlots = lightPool.getAllSlots();
    expect(poolSlots.length).toBeGreaterThan(0);

    // Instrumentar espías en cada luz física del pool para asegurar que setEnabled(false) NO sea invocado en runtime
    const disableSpies = poolSlots.map(s => vi.spyOn(s.light, 'setEnabled'));

    const vl = lightingSystem.registerOrUpdateVirtualLight(l1);

    // 1. Jugador cerca (10m) -> Luz asignada y activa
    const playerPos = new Vector3(0, 1, 10);
    lightDistance.evaluateDistanceAndHysteresis([vl], playerPos, 0);
    lightAllocation.allocatePoolSlots([vl], playerPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    const assignedSlot = poolSlots.find(s => s.assignedEntityUid === l1.uid);
    expect(assignedSlot).toBeDefined();
    expect(assignedSlot!.currentIntensity).toBeGreaterThan(0);
    expect(assignedSlot!.light.isEnabled()).toBe(true);

    // 2. Jugador se aleja completamente a 150m -> Provoca desasignación y liberación del slot
    const farPlayerPos = new Vector3(0, 1, 150);
    lightDistance.evaluateDistanceAndHysteresis([vl], farPlayerPos, 0);
    lightAllocation.allocatePoolSlots([vl], farPlayerPos, Vector3.Zero(), 0, null);
    
    // Simular el desvanecimiento y la transición completa
    for (let f = 0; f < 80; f++) {
      lightingSystem.update(16.66);
      lightAllocation.allocatePoolSlots([vl], farPlayerPos, Vector3.Zero(), 0, null);
    }

    // VERIFICACIÓN CLAVE BUG-02:
    // En ningún momento de la transición ni al liberarse se llamó a setEnabled(false)
    for (const spy of disableSpies) {
      const callsWithFalse = spy.mock.calls.filter(args => args[0] === false);
      expect(callsWithFalse.length).toBe(0);
    }

    // La luz física en el slot liberado debe estar en modo Idle Standby:
    expect(assignedSlot!.light.isEnabled()).toBe(true);
    expect(assignedSlot!.currentIntensity).toBe(0);
    expect(assignedSlot!.light.intensity).toBe(LIGHT_SPATIAL_CONSTANTS.PHYSICAL_IDLE_MIN_INTENSITY);
    expect(assignedSlot!.light.diffuse.equals(Color3.Black())).toBe(true);
  });

  it('TEST 2: Aislamiento Visual del Slot Libre — No ilumina el escenario ni consume ciclos de sombras', () => {
    const l1 = new GameEntity('light_isolated_1', 'Luz_Iso', 'light_point');
    l1.light!.enabled = true;
    l1.light!.castShadows = true;
    l1.transform.position = { x: 0, y: 3, z: 0 };
    const m1 = MeshBuilder.CreateSphere('m_iso', { diameter: 0.5 }, scene);
    l1.bindView(m1);
    entityManager.addEntity(l1);

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const vl = lightingSystem.registerOrUpdateVirtualLight(l1);
    const playerPos = new Vector3(0, 1, 5);
    lightDistance.evaluateDistanceAndHysteresis([vl], playerPos, 0);
    lightAllocation.allocatePoolSlots([vl], playerPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    const slot = lightPool.findSlotByUid(l1.uid);
    expect(slot).toBeDefined();

    // Liberación forzada del slot
    lightPool.forceHardRelease(slot!);

    // Verificaciones:
    expect(slot!.assignedEntityUid).toBeNull();
    expect(slot!.currentIntensity).toBe(0);
    expect(slot!.light.intensity).toBe(LIGHT_SPATIAL_CONSTANTS.PHYSICAL_IDLE_MIN_INTENSITY);
    expect(slot!.light.diffuse.equals(Color3.Black())).toBe(true);
    expect(slot!.light.specular.equals(Color3.Black())).toBe(true);
    expect(slot!.light.position.y).toBe(-99999);
    
    if (slot!.sg) {
      const sm = slot!.sg.getShadowMap();
      expect(sm?.refreshRate).toBe(0);
      expect(sm?.renderList?.length).toBe(0);
    }
  });

  it('TEST 3: Liberación Definitiva al Destruir el Pool — disposePools sí apaga y libera los recursos', () => {
    spatialHub.start();
    lightingSystem.prepareAllLights();

    const slots = lightPool.getAllSlots();
    expect(slots.length).toBeGreaterThan(0);

    const disableSpies = slots.map(s => vi.spyOn(s.light, 'setEnabled'));

    // Destrucción total
    lightPool.disposePools();

    // En disposePools(), setEnabled(false) SÍ es invocado legítimamente para destruir la escena
    for (const spy of disableSpies) {
      expect(spy).toHaveBeenCalledWith(false);
    }
    expect(lightPool.isInitialized).toBe(false);
    expect(lightPool.getAllSlots().length).toBe(0);
  });

  it('TEST 4: Idempotencia y Exclusividad de Slots — Una entidad no tiene dos slots asignados simultáneamente', () => {
    const l1 = new GameEntity('light_unique_1', 'Luz_Unica', 'light_point');
    l1.light!.enabled = true;
    l1.light!.activationDistance = 20;
    l1.light!.deactivationDistance = 30;
    l1.transform.position = { x: 0, y: 3, z: 0 };
    const m1 = MeshBuilder.CreateSphere('m_u1', { diameter: 0.5 }, scene);
    l1.bindView(m1);
    entityManager.addEntity(l1);

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const vl = lightingSystem.registerOrUpdateVirtualLight(l1);
    const playerPos = new Vector3(0, 1, 5);

    // Asignar en Frame 1
    lightDistance.evaluateDistanceAndHysteresis([vl], playerPos, 0);
    lightAllocation.allocatePoolSlots([vl], playerPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    // Reasignar en Frame 2 con la misma posición
    lightDistance.evaluateDistanceAndHysteresis([vl], playerPos, 0);
    lightAllocation.allocatePoolSlots([vl], playerPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    const allSlots = lightPool.getAllSlots();
    const assignedSlots = allSlots.filter(s => s.assignedEntityUid === l1.uid);
    expect(assignedSlots.length).toBe(1);
  });

  it('TEST 5: Neutralización de Componentes Difuso y Especular en finalIntensity = 0', () => {
    const l1 = new GameEntity('light_black_test', 'Luz_Black', 'light_point');
    l1.light!.enabled = true;
    l1.light!.lightColor = '#ff0000'; // Rojo brillante
    l1.transform.position = { x: 0, y: 3, z: 0 };
    const m1 = MeshBuilder.CreateSphere('m_b1', { diameter: 0.5 }, scene);
    l1.bindView(m1);
    entityManager.addEntity(l1);

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const vl = lightingSystem.registerOrUpdateVirtualLight(l1);
    const slot = lightPool.findSlotByUid(l1.uid) || lightPool.getAllSlots()[0];
    slot.assignedEntityUid = l1.uid;

    // Forzar intensidad final a 0 en la luz
    vl.currentMultiplier = 0.0;
    lightingSystem.updateAssignedLightIntensity(l1.uid, 0.0);

    expect(slot.currentIntensity).toBe(0);
    expect(slot.light.intensity).toBe(LIGHT_SPATIAL_CONSTANTS.PHYSICAL_IDLE_MIN_INTENSITY);
    expect(slot.light.diffuse.r).toBe(0);
    expect(slot.light.diffuse.g).toBe(0);
    expect(slot.light.diffuse.b).toBe(0);
    expect(slot.light.specular.r).toBe(0);
    expect(slot.light.specular.g).toBe(0);
    expect(slot.light.specular.b).toBe(0);
    expect(slot.light.isEnabled()).toBe(true);
  });

  it('TEST 6: Reclamación limpia desde HandoverSlot sin fugas de receptores anteriores', () => {
    const corridor = new GameEntity('corridor_ho', 'Corridor_HO', 'model');
    const cMesh = MeshBuilder.CreateBox('cMesh_ho', { width: 10, height: 4, depth: 30 }, scene);
    cMesh.position.set(0, 2, 0);
    corridor.bindView(cMesh);
    entityManager.addEntity(corridor);

    const l1 = new GameEntity('light_ho_test', 'Luz_HO', 'light_point');
    l1.light!.enabled = true;
    l1.light!.containmentMode = 'INTERIOR';
    l1.light!.containerEntityUid = corridor.uid;
    l1.light!.affectDescendantsOnly = true;
    l1.transform.position = { x: 0, y: 3, z: 0 };
    const m1 = MeshBuilder.CreateSphere('m_ho', { diameter: 0.5 }, scene);
    l1.bindView(m1);
    entityManager.addEntity(l1);

    spatialHub.start();
    lightingSystem.prepareAllLights();

    const vl = lightingSystem.registerOrUpdateVirtualLight(l1);
    const nearPos = new Vector3(0, 1, 5);
    lightDistance.evaluateDistanceAndHysteresis([vl], nearPos, 0);
    lightAllocation.allocatePoolSlots([vl], nearPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    // Moverse momentáneamente fuera para activar transición
    const farPos = new Vector3(0, 1, 45);
    lightDistance.evaluateDistanceAndHysteresis([vl], farPos, 0);
    lightAllocation.allocatePoolSlots([vl], farPos, Vector3.Zero(), 0, null);

    // Volver de inmediato a nearPos antes de que se extinga el tiempo
    lightDistance.evaluateDistanceAndHysteresis([vl], nearPos, 0);
    lightAllocation.allocatePoolSlots([vl], nearPos, Vector3.Zero(), 0, null);
    lightingSystem.update(16.66);

    const activeSlots = lightPool.getAllSlots().filter(s => s.assignedEntityUid === l1.uid);
    expect(activeSlots.length).toBe(1);
    expect(activeSlots[0].light.isEnabled()).toBe(true);
  });
});
  