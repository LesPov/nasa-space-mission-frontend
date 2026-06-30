
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FogOrchestratorService } from '../runtime/systems/fog-orchestrator.service';
import { Color3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { WorldSettingsService } from '../world/world-settings.service';
import { FogRendererService } from '../runtime/systems/fog-renderer.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { GameContextService } from '../session/game-context.service';
import { EntityManagerService } from '../entities/entity-manager.service';

describe('FogOrchestratorService (Fase 4)', () => {
  let orchestrator: FogOrchestratorService;

  beforeEach(() => {
    // 🔥 Fix: Como el servicio usa la inyección de dependencias `inject()`, 
    // debe instanciarse mediante TestBed para proveerle sus tokens correctos.
    TestBed.configureTestingModule({
      providers: [
        FogOrchestratorService,
        { provide: SCENE_ACCESS_TOKEN, useValue: { getScene: () => ({ fogStart: 0, fogEnd: 100 }) } },
        { provide: WorldSettingsService, useValue: { settings: () => ({ visualMode: 'normal', clearColor: '#000000', clearColorBW: '#000000' }) } },
        { provide: FogRendererService, useValue: { dispose: vi.fn(), renderFogWalls: vi.fn() } },
        { provide: CameraOwnershipService, useValue: { getCamera: () => null } },
        { provide: GameContextService, useValue: { isTransitioning: () => false, mode: () => 'EDITOR', isPlaying: () => false, isFogDisabled: () => false, activePlayerEntity: () => null, cameraView: () => 'FPS' } },
        { provide: EntityManagerService, useValue: { getAllEntities: () => [] } }
      ]
    });
    orchestrator = TestBed.inject(FogOrchestratorService);
  });

  it('1. Debe instanciarse correctamente sin dependencias inyectadas directas en la prueba', () => {
    expect(orchestrator).toBeDefined();
    expect(orchestrator.id).toBe('FogOrchestratorSystem');
  });

  it('2. El parser hexadecimal a Color3 por referencia debe ser exacto', () => {
    const color = new Color3(0, 0, 0);
    // Para testear esto aisladamente llamamos al método privado mediante un casteo a "any"
    (orchestrator as any).hexToColor3('#ff0000', color);
    expect(color.r).toBe(1);
    expect(color.g).toBe(0);
    expect(color.b).toBe(0);

    (orchestrator as any).hexToColor3('#00ff00', color);
    expect(color.r).toBe(0);
    expect(color.g).toBe(1);
    expect(color.b).toBe(0);
  });
});