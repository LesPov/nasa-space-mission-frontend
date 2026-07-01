
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { BaseEntityGizmoAdapter } from './adapters/base-entity-gizmo.adapter';
import { CameraGizmoAdapter } from './adapters/camera-gizmo.adapter';
import { ColliderGizmoAdapter } from './adapters/collider-gizmo.adapter';
import { FogGizmoAdapter } from './adapters/fog-gizmo.adapter';
import { GizmoAdapterRegistryService } from './adapters/gizmo-adapter-registry.service';
import { LightGizmoAdapter } from './adapters/light-gizmo.adapter';
 
describe('Gizmo Target Adapter System (Fase 8)', () => {
  let registry: GizmoAdapterRegistryService;
  let entity: GameEntity;

  beforeEach(() => {
    registry = new GizmoAdapterRegistryService();
    entity = new GameEntity('1', 'Test', 'light_point');
    entity.addComponent('playerConfig', { fog: { enabled: true } });
  });

  it('1. Debe registrar y resolver los adaptadores correctamente según subSelected', () => {
    const baseAdapter = registry.getAdapter(null, entity);
    expect(baseAdapter).toBeInstanceOf(BaseEntityGizmoAdapter);

    const colliderAdapter = registry.getAdapter('collider', entity);
    expect(colliderAdapter).toBeInstanceOf(ColliderGizmoAdapter);

    const cameraAdapter = registry.getAdapter('camera', entity);
    expect(cameraAdapter).toBeInstanceOf(CameraGizmoAdapter);

    const lightAdapter = registry.getAdapter('light', entity);
    expect(lightAdapter).toBeInstanceOf(LightGizmoAdapter);

    const fogAdapter = registry.getAdapter('fog', entity);
    expect(fogAdapter).toBeInstanceOf(FogGizmoAdapter);
  });

  it('2. BaseEntityGizmoAdapter debe actuar sobre el objeto raíz si no hay selección de subojeto', () => {
    const baseAdapter = new BaseEntityGizmoAdapter();
    expect(baseAdapter.supports(null, entity)).toBe(true);
    expect(baseAdapter.supports('collider', entity)).toBe(false);
  });
});