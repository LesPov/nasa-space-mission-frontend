
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FogOrchestratorService } from '../runtime/systems/fog-orchestrator.service';
import { Color3 } from '@babylonjs/core';

describe('FogOrchestratorService (Fase 4)', () => {
  let orchestrator: FogOrchestratorService;

  beforeEach(() => {
    orchestrator = new FogOrchestratorService();
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