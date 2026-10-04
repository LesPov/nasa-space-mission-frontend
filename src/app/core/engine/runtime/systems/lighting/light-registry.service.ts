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

    if (e.view) {
      const isVisualMesh = Tags.MatchesQuery(e.view, 'light_visual') || (e.view as any).metadata?.isLightVisual;
      if (e.view.material && !isVisualMesh) {
        this.ensureUniqueMaterial(e.view, e.uid);
        mats.push(e.view.material);
      }

      e.view.computeWorldMatrix(true);
      const lightWorldPos = e.view.getAbsolutePosition();

      let searchRoot: any = e.view;
      if (e.parentId) {
        const parentEnt = this.entityManager.getEntityByUid(e.parentId);
        if (parentEnt && parentEnt.view) {
          searchRoot = parentEnt.view;
        }
      } else if (e.view.parent) {
        searchRoot = e.view.parent;
      }

      if (e.light?.attachedNodeName) {
        const attachedNode = searchRoot.getDescendants(false).find((n: any) => n.name === e.light!.attachedNodeName);
        if (attachedNode && (attachedNode as AbstractMesh).material) {
          const m = attachedNode as AbstractMesh;
          this.ensureUniqueMaterial(m, e.uid);
          if (!mats.includes(m.material)) mats.push(m.material);
        }
      } else {
        searchRoot.getChildMeshes(false).forEach((m: AbstractMesh) => {
          if (Tags.MatchesQuery(m, 'light_visual') || (m as any).metadata?.isLightVisual) return;
          if (!m.material) return;

          const nL = m.name.toLowerCase();
          const mL = m.material.name.toLowerCase();
          const isLampMesh = (
            nL.includes('bulb') ||
            nL.includes('light') ||
            nL.includes('emit') ||
            mL.includes('bulb') ||
            mL.includes('light') ||
            mL.includes('emit')
          );

          if (isLampMesh) {
            m.computeWorldMatrix(true);
            const distToMesh = Vector3.Distance(m.getAbsolutePosition(), lightWorldPos);
            if (distToMesh <= 3.5) {
              this.ensureUniqueMaterial(m, e.uid);
              if (!mats.includes(m.material)) {
                mats.push(m.material);
              }
            }
          }
        });
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
          mesh.material = (mesh.material as any).clone(`${mesh.material.name}_${uid}`);
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