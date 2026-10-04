
// file: src/app/core/engine/runtime/systems/lighting/runtime-reset.service.ts

import { Injectable, inject, signal } from '@angular/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { DynamicLightingSystem } from './dynamic-lighting.system';
import { ShadowOrchestratorService } from '../../shadows/shadow-orchestrator.service';
import { LocalRenderingSystem } from '../local-rendering.system';
import { LightPoolService } from './light-pool.service';
import { LightRegistryService } from './light-registry.service';
import { LightContainmentService } from './light-containment.service';
import { SpatialRelevanceHubService } from '../../../spatial/spatial-relevance-hub.service';
import { GameContextService } from '../../../session/game-context.service';
import { Vector3 } from '@babylonjs/core';

export interface SceneResetReport {
  timestamp: string;
  durationMs: number;
  clearedVirtualLights: number;
  clearedPhysicalSlots: number;
  clearedContainmentCaches: number;
  clearedCullingStates: number;
  resetPosition: { x: number; y: number; z: number };
  details: string;
}

@Injectable({ providedIn: 'root' })
export class RuntimeResetService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private dynamicLighting = inject(DynamicLightingSystem);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private localRendering = inject(LocalRenderingSystem);
  private lightPool = inject(LightPoolService);
  private lightRegistry = inject(LightRegistryService);
  private containmentSvc = inject(LightContainmentService);
  private spatialHub = inject(SpatialRelevanceHubService);
  private context = inject(GameContextService);

  public readonly lastReport = signal<SceneResetReport | null>(null);
  public readonly status = signal<'IDLE' | 'RESETTING' | 'DONE'>('IDLE');

  /**
   * Ejecuta un reinicio síncrono y limpio del estado de iluminación y renderizado,
   * sin destruir texturas ni descargar modelos GLB de la memoria VRAM.
   */
  public async resetRuntimeEnvironment(): Promise<SceneResetReport> {
    this.status.set('RESETTING');
    const tStart = performance.now();
    const scene = this.motor3d.getScene();

    const initialVirtualCount = this.lightRegistry.getVirtualLights().length;
    const initialSlotCount = this.lightPool.getAllSlots().filter(s => s.assignedEntityUid !== null).length;

    // 1. Limpieza de slots físicos
    this.lightPool.resetPools();

    // 2. Limpieza de cachés de contención y sombras
    this.containmentSvc.clearAllCache();

    // 3. Reset del Spatial Relevance Hub
    this.spatialHub.clear();
    this.spatialHub.rebuildRegistry();

    // 4. Posición de referencia limpia
    const refPos = this.dynamicLighting.getReferencePosition('AUTO');

    // 5. Reinicio de Culling y Visibilidad
    this.localRendering.stop();
    this.localRendering.reconcileAllEntitiesImmediate(refPos);

    // 6. Preparación y asignación del Top 3
    this.dynamicLighting.prepareAllLights();
    this.dynamicLighting.forceWarmup(refPos);
    this.shadowOrchestrator.reconcileShadows();

    // 7. Pase de renderizado de estabilización
    if (scene) {
      scene.render();
    }

    const tDuration = performance.now() - tStart;
    const report: SceneResetReport = {
      timestamp: new Date().toLocaleTimeString(),
      durationMs: parseFloat(tDuration.toFixed(1)),
      clearedVirtualLights: initialVirtualCount,
      clearedPhysicalSlots: initialSlotCount,
      clearedContainmentCaches: this.containmentSvc.metrics.cacheHits + this.containmentSvc.metrics.cacheMisses,
      clearedCullingStates: this.localRendering.getMetrics().hardCulledObjects + this.localRendering.getMetrics().visibleObjects,
      resetPosition: { x: parseFloat(refPos.x.toFixed(1)), y: parseFloat(refPos.y.toFixed(1)), z: parseFloat(refPos.z.toFixed(1)) },
      details: 'Slots físicos purgados, scoring recalculado y sombras reasociadas.'
    };

    this.lastReport.set(report);
    this.status.set('DONE');

    console.log(`[RuntimeResetService] ✅ Entorno reseteado exitosamente en ${report.durationMs}ms. Posición: (${report.resetPosition.x}, ${report.resetPosition.y}, ${report.resetPosition.z})`);

    setTimeout(() => this.status.set('IDLE'), 2000);
    return report;
  }
}