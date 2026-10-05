// file: src/app/core/engine/runtime/systems/lighting/light-shadow.service.ts
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, ShadowGenerator, Vector3, Tags, InstancedMesh, Mesh, RenderTargetTexture, Node } from '@babylonjs/core';
import { PoolSlot, ShadowTier } from './lighting-types';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { ShadowCache } from '../../shadows/shadow-cache.service';
import { ShadowQualityService } from '../../shadows/shadow-quality.service';
import { InteractableRulesService } from '../../rules/interactable-rules.service';
import { GameEntity } from '../../../entities/game.entity';
import { ShadowLODManager } from '../../shadows/shadow-lod-manager.service';

@Injectable({ providedIn: 'root' })
export class LightShadowService {
  private entityManager = inject(EntityManagerService);
  private lodManager = inject(ShadowLODManager);
  private shadowCache = inject(ShadowCache);
  private shadowQualitySvc = inject(ShadowQualityService);
  private interactRules = inject(InteractableRulesService);

  private castersCache: AbstractMesh[] = [];
  private entityToActiveSlotsMap = new Map<string, Set<PoolSlot>>();
  private actorRenderableMeshesCache = new Map<string, AbstractMesh[]>();

  public getCastersCacheSize(): number {
    return this.castersCache.length;
  }

  public clearCache(): void {
    this.castersCache.length = 0;
    this.entityToActiveSlotsMap.clear();
    this.actorRenderableMeshesCache.clear();
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
        if (shadowMap) {
          shadowMap.resetRefreshCounter();
          this.shadowCache.recordInvalidation();
        }
      }
    }
  }

  public resolveEntityForMesh(mesh: AbstractMesh): GameEntity | null {
    let curr: Node | null = mesh;
    while (curr) {
      if (curr instanceof AbstractMesh) {
        const ent = this.entityManager.getEntityByMesh(curr);
        if (ent) return ent;
        if ((curr as any).metadata?.entityUid) {
          const byUid = this.entityManager.getEntityByUid((curr as any).metadata.entityUid);
          if (byUid) return byUid;
        }
      }
      curr = curr.parent;
    }
    return null;
  }

  public getActorRenderableMeshes(actorEntity: GameEntity): AbstractMesh[] {
    if (!actorEntity.view || actorEntity.view.isDisposed()) return [];
    
    let meshes = this.actorRenderableMeshesCache.get(actorEntity.uid);
    if (!meshes || meshes.some(m => m.isDisposed())) {
      meshes = [];
      const root = actorEntity.view;
      
      const inspect = (m: AbstractMesh) => {
        if (!m || m.isDisposed()) return;
        if (Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) return;
        
        if (m.getClassName() === "InstancedMesh" && (m as InstancedMesh).sourceMesh) {
          meshes!.push(m);
        } else if (m.getClassName() === "Mesh" && (m as Mesh).getTotalVertices() > 0) {
          meshes!.push(m);
        }
      };

      inspect(root);
      root.getChildMeshes(false).forEach(inspect);

      if (meshes.length === 0 && (root instanceof Mesh) && root.getTotalVertices() > 0) {
        meshes.push(root);
      }

      this.actorRenderableMeshesCache.set(actorEntity.uid, meshes);
    }
    return meshes;
  }

  public refreshShadowCastersCache(): void {
    this.castersCache.length = 0;
    this.actorRenderableMeshesCache.clear();
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

  public isEligibleShadowCaster(e: GameEntity): boolean {
    if (!e.view) return false;
    if (e.isManuallyHidden) return false;

    if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) return false;
    if (e.characterConfig || e.rol === 'player' || e.rol === 'npc' || e.rol === 'politico' || e.rol === 'militar') return true;

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

  public isDynamicCaster(e: GameEntity): boolean {
    if (e.characterConfig || e.rol === 'player' || e.rol === 'npc' || e.rol === 'politico' || e.rol === 'militar') return true;
    if (e.autoAnim?.enabled) return true;
    if (e.movementAuthority !== 'GAMEPLAY') return true;
    return false;
  }

  public rebuildShadowRenderList(slot: PoolSlot, entityUid: string, lightPos: Vector3, range: number): void {
    if (!slot.sg) {
      const config = slot.type === 'spot' ? this.shadowQualitySvc.getSpotConfig() : this.shadowQualitySvc.getPointConfig();
      slot.sg = new ShadowGenerator(config.resolution, slot.light);

      slot.sg.usePercentageCloserFiltering = true;
      // Inmutable: Se fija QUALITY_MEDIUM de forma determinista para todo el pool
      slot.sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      slot.sg.bias = 0.0003;
      slot.sg.normalBias = slot.type === 'spot' ? 0.001 : 0.0008;
      slot.sg.setDarkness(0.0);
      if (slot.type === 'point') {
        slot.sg.useContactHardeningShadow = false;
      }
    }

    const renderList = slot.sg.getShadowMap()?.renderList;
    if (!renderList) return;

    for (const [, slotsSet] of this.entityToActiveSlotsMap.entries()) {
      slotsSet.delete(slot);
    }

    renderList.length = 0;
    slot.hasDynamicCasters = false;
    if (!slot.dynamicCastersRegistered) {
      slot.dynamicCastersRegistered = new Set<string>();
    }
    slot.dynamicCastersRegistered.clear();

    const ownerEnt = this.entityManager.getEntityByUid(entityUid);
    const rangeSq = range * range;

    for (let i = 0; i < this.castersCache.length; i++) {
      const m = this.castersCache[i];
      if (m.isDisposed()) continue;

      const parentEnt = this.resolveEntityForMesh(m);
      if (parentEnt && parentEnt.uid === entityUid) continue;

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

        if (parentEnt) {
          let slotSet = this.entityToActiveSlotsMap.get(parentEnt.uid);
          if (!slotSet) {
            slotSet = new Set<PoolSlot>();
            this.entityToActiveSlotsMap.set(parentEnt.uid, slotSet);
          }
          slotSet.add(slot);

          if (this.isDynamicCaster(parentEnt)) {
            slot.hasDynamicCasters = true;
            slot.dynamicCastersRegistered.add(parentEnt.uid);
          }
        }
      }
    }

    slot.isStaticLight = ownerEnt ? (!ownerEnt.autoAnim?.enabled && ownerEnt.movementAuthority === 'GAMEPLAY' && !ownerEnt.characterConfig) : true;
    this.shadowCache.recordRebuild();
  }

  public syncDynamicActorInSlot(
    slot: PoolSlot,
    actorEntity: GameEntity,
    lightPos: Vector3,
    lightRange: number,
    shouldCastShadow: boolean
  ): boolean {
    if (!slot.sg) return false;
    const renderList = slot.sg.getShadowMap()?.renderList;
    if (!renderList) return false;

    if (!slot.dynamicCastersRegistered) {
      slot.dynamicCastersRegistered = new Set<string>();
    }

    const actorMeshes = this.getActorRenderableMeshes(actorEntity);
    if (actorMeshes.length === 0) return false;

    const isCurrentlyRegistered = slot.dynamicCastersRegistered.has(actorEntity.uid);

    if (shouldCastShadow) {
      let anyAdded = false;
      for (let i = 0; i < actorMeshes.length; i++) {
        const m = actorMeshes[i];
        m.computeWorldMatrix(true);
        if (!renderList.includes(m)) {
          renderList.push(m);
          anyAdded = true;
        }
        if (m.receiveShadows !== true) {
          m.receiveShadows = true;
        }
      }

      slot.hasDynamicCasters = true;
      slot.dynamicCastersRegistered.add(actorEntity.uid);

      let slotSet = this.entityToActiveSlotsMap.get(actorEntity.uid);
      if (!slotSet) {
        slotSet = new Set<PoolSlot>();
        this.entityToActiveSlotsMap.set(actorEntity.uid, slotSet);
      }
      slotSet.add(slot);

      if (anyAdded || !isCurrentlyRegistered) {
        const sm = slot.sg.getShadowMap();
        if (sm) {
          sm.resetRefreshCounter();
          this.shadowCache.recordInvalidation();
        }
        return true;
      }
    } else {
      if (isCurrentlyRegistered) {
        for (let i = 0; i < actorMeshes.length; i++) {
          const idx = renderList.indexOf(actorMeshes[i]);
          if (idx !== -1) {
            renderList.splice(idx, 1);
          }
        }
        slot.dynamicCastersRegistered.delete(actorEntity.uid);

        const slotSet = this.entityToActiveSlotsMap.get(actorEntity.uid);
        if (slotSet) slotSet.delete(slot);

        slot.hasDynamicCasters = slot.dynamicCastersRegistered.size > 0;

        const sm = slot.sg.getShadowMap();
        if (sm) {
          sm.resetRefreshCounter();
          this.shadowCache.recordInvalidation();
        }
        return true;
      }
    }

    return false;
  }

  public applyShadowLOD(slot: PoolSlot, isEditor: boolean, refPos: Vector3): void {
    if (!slot.sg || !slot.sg.getShadowMap()) return;
    const distToCam = Vector3.Distance(slot.light.position, refPos);

    if (isEditor && slot.type === 'point' && !slot.hasDynamicCasters && slot.isStaticLight) {
      slot.sg.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      slot.currentRefreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      return;
    }

    const rate = this.lodManager.getRefreshRate(
      distToCam,
      !!slot.hasDynamicCasters,
      !slot.isStaticLight,
      slot.shadowTier || 'HIGH'
    );

    slot.sg.getShadowMap()!.refreshRate = rate;
    slot.currentRefreshRate = rate;
  }
}