
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, ShadowGenerator, Vector3, Tags, InstancedMesh, Mesh, RenderTargetTexture } from '@babylonjs/core';
import { PoolSlot } from './lighting-types';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { ShadowLODManager } from '../../shadows/shadow-lod-manager.service';
import { ShadowCache } from '../../shadows/shadow-cache.service';
import { ShadowQualityService } from '../../shadows/shadow-quality.service';
import { InteractableRulesService } from '../../rules/interactable-rules.service';
import { GameEntity } from '../../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class LightShadowService {
  private entityManager = inject(EntityManagerService);
  private lodManager = inject(ShadowLODManager);
  private shadowCache = inject(ShadowCache);
  private shadowQualitySvc = inject(ShadowQualityService);
  private interactRules = inject(InteractableRulesService);

  private castersCache: AbstractMesh[] = [];
  private entityToActiveSlotsMap = new Map<string, Set<PoolSlot>>();

  public getCastersCacheSize(): number {
    return this.castersCache.length;
  }

  public clearCache(): void {
    this.castersCache.length = 0;
    this.entityToActiveSlotsMap.clear();
  }

  public isEntityRequiredForActiveShadows(entityUid: string): boolean {
    const slots = this.entityToActiveSlotsMap.get(entityUid);
    if (!slots || slots.size === 0) return false;

    for (const slot of slots) {
      if (slot.sg && slot.assignedEntityUid) {
        return true;
      }
    }
    return false;
  }

  public notifyCasterRestored(entityUid: string): void {
    const slots = this.entityToActiveSlotsMap.get(entityUid);
    if (!slots) return;

    for (const slot of slots) {
      if (slot.sg && slot.sg.getShadowMap()) {
        const shadowMap = slot.sg.getShadowMap();
        if (shadowMap && shadowMap.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
          shadowMap.resetRefreshCounter();
          this.shadowCache.recordInvalidation();
        }
      }
    }
  }

  public refreshShadowCastersCache(): void {
    this.castersCache.length = 0;
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.isEligibleShadowCaster(e) && e.view && !e.view.isDisposed()) {
        const processMesh = (m: AbstractMesh) => {
          if (m.isDisposed()) return;

          if (!e.isManuallyHidden && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) {
            if (m.getClassName() === "InstancedMesh" && (m as InstancedMesh).sourceMesh) {
              this.castersCache.push(m);
            } else if (m.getClassName() === "Mesh" && (m as Mesh).getTotalVertices() > 0) {
              this.castersCache.push(m);
            }
          }
        };
        processMesh(e.view);
        e.view.getChildMeshes(false).forEach(processMesh);
      }
    }
  }

  private isEligibleShadowCaster(e: GameEntity): boolean {
    if (!e.view) return false;
    if (e.isManuallyHidden) return false;

    if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) return false;
    if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') return true;

    const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
    if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
      if (this.interactRules.isInteractable(e)) return true;

      e.view.computeWorldMatrix(true);
      const bounds = e.view.getHierarchyBoundingVectors(true);
      const diag = Vector3.Distance(bounds.min, bounds.max);

      if (diag < 0.1) return false;
      return true;
    }
    return false;
  }

  public rebuildShadowRenderList(slot: PoolSlot, entityUid: string, lightPos: Vector3, range: number): void {
    if (!slot.sg) {
      const config = slot.type === 'spot' ? this.shadowQualitySvc.getSpotConfig() : this.shadowQualitySvc.getPointConfig();
      slot.sg = new ShadowGenerator(config.resolution, slot.light);

      slot.sg.usePercentageCloserFiltering = true;
      slot.sg.filteringQuality = config.filteringQuality;
      slot.sg.bias = 0.0003;
      slot.sg.normalBias = slot.type === 'spot' ? 0.001 : 0.0008;
      slot.sg.setDarkness(0.0);
      if (slot.type === 'point') {
        slot.sg.useContactHardeningShadow = false;
      }
    } else {
      const config = slot.type === 'spot' ? this.shadowQualitySvc.getSpotConfig() : this.shadowQualitySvc.getPointConfig();
      slot.sg.filteringQuality = config.filteringQuality;
      slot.sg.bias = 0.0003;
      slot.sg.normalBias = slot.type === 'spot' ? 0.001 : 0.0008;
      slot.sg.setDarkness(0.0);
    }

    const renderList = slot.sg.getShadowMap()?.renderList;
    if (!renderList) return;

    for (const [, slotsSet] of this.entityToActiveSlotsMap.entries()) {
      slotsSet.delete(slot);
    }

    renderList.length = 0;
    slot.hasDynamicCasters = false;

    const ownerEnt = this.entityManager.getEntityByUid(entityUid);
    const rangeSq = range * range;

    for (let i = 0; i < this.castersCache.length; i++) {
      const m = this.castersCache[i];
      if (m.isDisposed()) continue;

      const meshEntityUid = (m as any).metadata?.entityUid;
      if (meshEntityUid === entityUid) continue;

      m.computeWorldMatrix(true);
      const bInfo = m.getBoundingInfo();
      const bBox = bInfo.boundingBox;

      const cX = Math.max(bBox.minimumWorld.x, Math.min(lightPos.x, bBox.maximumWorld.x));
      const cY = Math.max(bBox.minimumWorld.y, Math.min(lightPos.y, bBox.maximumWorld.y));
      const cZ = Math.max(bBox.minimumWorld.z, Math.min(lightPos.z, bBox.maximumWorld.z));

      const dx = lightPos.x - cX;
      const dy = lightPos.y - cY;
      const dz = lightPos.z - cZ;
      const distToBoxSq = dx * dx + dy * dy + dz * dz;

      if (distToBoxSq <= rangeSq) {
        renderList.push(m);

        if (m.receiveShadows !== true) {
          m.receiveShadows = true;
        }

        if (meshEntityUid) {
          let slotSet = this.entityToActiveSlotsMap.get(meshEntityUid);
          if (!slotSet) {
            slotSet = new Set<PoolSlot>();
            this.entityToActiveSlotsMap.set(meshEntityUid, slotSet);
          }
          slotSet.add(slot);
        }

        const parentEnt = this.entityManager.getEntityByMesh(m);
        if (parentEnt && this.isDynamicCaster(parentEnt)) {
          slot.hasDynamicCasters = true;
        }
      }
    }

    slot.isStaticLight = ownerEnt ? (!ownerEnt.autoAnim?.enabled && ownerEnt.movementAuthority === 'GAMEPLAY' && !ownerEnt.characterConfig) : true;
    this.shadowCache.recordRebuild();
  }

  public applyShadowLOD(slot: PoolSlot, isEditor: boolean, refPos: Vector3): void {
    if (!slot.sg || !slot.sg.getShadowMap()) return;
    const distToCam = Vector3.Distance(slot.light.position, refPos);

    const rate = this.lodManager.getRefreshRate(
      distToCam,
      !!slot.hasDynamicCasters,
      !slot.isStaticLight
    );

    // En editor, si no hay casters dinámicos, RENDER_ONCE (0) congela el cálculo inmediatamente
    slot.sg.getShadowMap()!.refreshRate = rate;
  }

  private isDynamicCaster(e: GameEntity): boolean {
    if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') return true;
    if (e.autoAnim?.enabled) return true;
    if (e.movementAuthority !== 'GAMEPLAY') return true;
    return false;
  }
}