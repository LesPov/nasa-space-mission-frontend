import { Injectable, inject } from '@angular/core';
import { Color3, AbstractMesh, Tags } from '@babylonjs/core';
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
      let vl = this.virtualLights.find(v => v.entity.uid === e.uid);
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const hexColor = e.light ? (isBW ? e.light.lightColorBW : e.light.lightColor) : '#ffffff';
      const baseColor = Color3.FromHexString(hexColor || '#ffffff');

      const mats: any[] = [];
      if (e.view) {
          const isVisualMesh = Tags.MatchesQuery(e.view, "light_visual") || (e.view as any).metadata?.isLightVisual;
          if (e.view.material && !isVisualMesh) mats.push(e.view.material);
          
          e.view.getChildMeshes(false).forEach((m: AbstractMesh) => {
              if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) return;
              if (m.material) {
                 const nL = m.name.toLowerCase();
                 const mL = m.material.name.toLowerCase();
                 if (nL.includes('bulb') || nL.includes('light') || nL.includes('emit') || mL.includes('bulb') || mL.includes('light') || mL.includes('emit')) {
                     const override = e.partOverrides?.overrides[m.name];
                     if (!override || (override.color === undefined && override.esEmisivo === undefined)) {
                         mats.push(m.material);
                     }
                 }
              }
          });
      }

      if (!vl) {
          vl = {
              entity: e, materials: mats, baseColor, currentMultiplier: 0.0, targetMultiplier: 0.0, distSq: 0,
              isLightInRange: false, isShadowInRange: false, lastEvaluatedDistance: 0, _lastRenderedMultiplier: -1,
              _isInPrepareRange: false, _sortScore: 0
          };
          this.virtualLights.push(vl);
      } else {
          vl.entity = e;
          vl.baseColor = baseColor;
          vl.materials = mats; 
      }
      return vl;
  }

  public clear(): void {
      this.virtualLights = [];
  }
}