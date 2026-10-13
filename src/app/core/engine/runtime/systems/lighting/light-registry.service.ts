// file: src/app/core/engine/runtime/systems/lighting/light-registry.service.ts
import { Injectable, inject } from '@angular/core';
import { Color3, AbstractMesh, Tags, Vector3 } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity } from '../../../entities/game.entity';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { VirtualLight } from './lighting-types';

@Injectable({ providedIn: 'root' })
export class LightRegistryService {
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);

  private virtualLights: VirtualLight[] = [];

  public getVirtualLights(): VirtualLight[] {
    return this.virtualLights;
  }

  public getVirtualLightByUid(uid: string): VirtualLight | undefined {
    return this.virtualLights.find(v => v.entity.uid === uid);
  }

  public refreshVirtualLightsRegistry(): void {
    const lightEntities = this.entityManager.getAllEntities().filter(e => e.type.startsWith('light_'));
    this.virtualLights = this.virtualLights.filter(vl => lightEntities.some(e => e.uid === vl.entity.uid));
    for (const e of lightEntities) {
      this.registerOrUpdateVirtualLight(e);
    }
  }

  public registerOrUpdateVirtualLight(e: GameEntity): VirtualLight {
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const hexColor = e.light ? (isBW ? e.light.lightColorBW : e.light.lightColor) : '#ffffff';
    const baseColor = Color3.FromHexString(hexColor || '#ffffff');

    const mats: any[] = [];

    // SOLO asociar materiales que pertenezcan estrictamente a la entidad de la luz (foco o bombilla visual)
    // NUNCA contaminar los materiales del modelo padre (ej: pasillo, paredes, techos)
    if (e.view) {
      const isVisualMesh = Tags.MatchesQuery(e.view, 'light_visual') || (e.view as any).metadata?.isLightVisual;
      if (e.view.material && !isVisualMesh && e.visual?.assetId) {
        this.ensureUniqueMaterial(e.view, e.uid);
        mats.push(e.view.material);
      }

      // Si tiene una esfera visual o bombilla dedicada a la luz:
      const visualBulb = e.view.getChildMeshes(false).find(
        (m: AbstractMesh) => Tags.MatchesQuery(m, 'light_visual') || (m as any).metadata?.isLightVisual
      );
      if (visualBulb && visualBulb.material && !mats.includes(visualBulb.material)) {
        mats.push(visualBulb.material);
      }

      // Si la luz tiene un nodo anclado específico:
      if (e.light?.attachedNodeName) {
        const attachedNode = e.view.getDescendants(false).find((n: any) => n.name === e.light!.attachedNodeName);
        if (attachedNode && (attachedNode as AbstractMesh).material) {
          const m = attachedNode as AbstractMesh;
          this.ensureUniqueMaterial(m, e.uid);
          if (!mats.includes(m.material)) mats.push(m.material);
        }
      }
    }

    const isInteriorMode = e.light?.containmentMode === 'INTERIOR';
    const existing = this.virtualLights.find(v => v.entity.uid === e.uid);

    if (!existing) {
      const newVl: VirtualLight = {
        entity: e,
        materials: mats,
        baseColor,
        currentMultiplier: 0.0,
        targetMultiplier: 0.0,
        distSq: 0,
        isLightInRange: false,
        isShadowInRange: false,
        lastEvaluatedDistance: 0,
        centerDistance: 0,
        boundsDistance: 0,
        effectiveDistance: 0,
        _lastRenderedMultiplier: -1,
        _isInPrepareRange: false,
        _sortScore: 0,
        lifecycleStage: 'INACTIVE',
        decisionText: 'INICIAL',
        isWarmedUp: false,
        isInterior: isInteriorMode,
        interiorActivationMode: e.light?.interiorActivationMode || 'VOLUME',
        insideVolume: false,
        inPreEntryZone: false
      };
      this.virtualLights.push(newVl);
      return newVl;
    }

    existing.entity = e;
    existing.baseColor = baseColor;
    existing.materials = mats;
    existing.isInterior = isInteriorMode;
    existing.interiorActivationMode = e.light?.interiorActivationMode || 'VOLUME';
    return existing;
  }

  private ensureUniqueMaterial(mesh: AbstractMesh, uid: string): void {
    if (!mesh.material) return;
    if (!mesh.material.name.includes(uid)) {
      try {
        if (typeof (mesh.material as any).clone === 'function') {
          const oldMeta = mesh.material.metadata ? structuredClone(mesh.material.metadata) : {};
          const clonedMat = (mesh.material as any).clone(`${mesh.material.name}_${uid}`);
          clonedMat.metadata = oldMeta;
          mesh.material = clonedMat;
        }
      } catch (err) {
        console.warn(`[LightRegistry] No se pudo clonar material para ${mesh.name}:`, err);
      }
    }
  }

  public clear(): void { 
    this.virtualLights = [];
  }
}