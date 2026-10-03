// file: src/app/core/engine/testing/shadow-optimization.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DynamicLightingSystem } from '../runtime/systems/lighting/dynamic-lighting.system';
import { ShadowOrchestratorService } from '../runtime/shadows/shadow-orchestrator.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { ShadowLODManager } from '../runtime/shadows/shadow-lod-manager.service';
import { GameEntity } from '../entities/game.entity';
import { MeshBuilder, NullEngine, Scene } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';

describe('Shadow Optimization & Dynamic Lighting Stability (Target 60 FPS)', () => {
  let lightingSystem: DynamicLightingSystem;
  let orchestrator: ShadowOrchestratorService;
  let entityManager: EntityManagerService;
  let lodManager: ShadowLODManager;
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
  });

  it('1. El CSM (Sun/Orchestrator) se mantiene aislado del pool de luces locales', () => {
    orchestrator.asignarObjetosASombrasDeLuces();
    const metrics = orchestrator.getProfilerMetrics();
    expect(metrics.activeGenerators).toBe(1);
    expect(metrics.csmCascades).toBeLessThanOrEqual(3);
  });

  it('2. El pool limita estrictamente a un máximo de 3 luces activas concurrentes', () => {
    // Registrar 4 luces como en un pasillo
    for (let i = 0; i < 4; i++) {
      const ent = new GameEntity(`luz_pasillo_${i}`, `Luz_${i}`, 'light_point');
      ent.light!.enabled = true;
      ent.light!.intensity = 1.0;
      ent.transform.position = { x: i * 5, y: 2, z: 0 };
      entityManager.addEntity(ent);
    }

    lightingSystem.prepareAllLights();
    const metrics = lightingSystem.getProfilerMetrics();

    expect(metrics.totalVirtual).toBe(4);
    expect(metrics.activePool).toBeLessThanOrEqual(3); // Cumple la regla absoluta de máximo 3 luces
  });

  it('3. LOD de sombras debe usar los divisores de frame correctos (0, 1, 2, 3)', () => {
    expect(lodManager.getRefreshRate(5, false, false)).toBe(0); // Congelada
    expect(lodManager.getRefreshRate(15, true, false)).toBe(1);  // Prioridad alta
    expect(lodManager.getRefreshRate(30, true, false)).toBe(2);  // Media
    expect(lodManager.getRefreshRate(50, true, false)).toBe(3);  // Lejana
  });
});