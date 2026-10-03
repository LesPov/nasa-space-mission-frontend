
import { Injectable, inject } from '@angular/core';
import { Color3, AbstractMesh, Tags, Vector3, StandardMaterial } from '@babylonjs/core';
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
      // 1. Material propio si la entidad tiene su propio mesh de lámpara
      const isVisualMesh = Tags.MatchesQuery(e.view, 'light_visual') || (e.view as any).metadata?.isLightVisual;
      if (e.view.material && !isVisualMesh) {
        this.ensureUniqueMaterial(e.view, e.uid);
        mats.push(e.view.material);
      }

      // 2. Resolver posición de esta luz para asociar ÚNICAMENTE las ampolletas/mallas pertenecientes a este foco
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

      // Si tiene nodo anclado explícito, enlazamos exclusivamente a ese nodo
      if (e.light?.attachedNodeName) {
        const attachedNode = searchRoot.getDescendants(false).find((n: any) => n.name === e.light!.attachedNodeName);
        if (attachedNode && (attachedNode as AbstractMesh).material) {
          const m = attachedNode as AbstractMesh;
          this.ensureUniqueMaterial(m, e.uid);
          if (!mats.includes(m.material)) mats.push(m.material);
        }
      } else {
        // Enlazar solo mallas que estén físicamente próximas a esta luz (<= 3.5m)
        // Esto evita que todas las luces del pasillo se peleen por todas las ampolletas del pasillo
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
            
            // Umbral estricto: solo mallas correspondientes a este foco individual
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
        _lastRenderedMultiplier: -1,
        _isInPrepareRange: false,
        _sortScore: 0,
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