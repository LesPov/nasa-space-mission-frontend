// RUTA: src/app/core/engine/runtime/systems/lighting/light-shadow.service.ts
// ACCIÓN: MODIFICAR

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

  // Mapeo inverso O(1): entidad UID -> lista de PoolSlots donde participa como caster
  private entityToActiveSlotsMap = new Map<string, Set<PoolSlot>>();

  public getCastersCacheSize(): number {
    return this.castersCache.length;
  }

  public clearCache(): void {
    this.castersCache.length = 0;
    this.entityToActiveSlotsMap.clear();
  }

  /**
   * Determina si una entidad está registrada activamente en la renderList de alguna luz
   * cuyo generador de sombra esté encendido.
   */
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

  /**
   * Notifica que una entidad pasó de CULLED a RESTORING/VISIBLE.
   * Dispara el refresco puntual de la sombra SOLO en los slots que la contienen,
   * sin requerir un rebuild global.
   */
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

  /**
   * Reconstruye la lista de casters para la luz.
   * CORRECCIÓN FUNDAMENTAL: Para luces de interior, las mallas del contenedor
   * (paredes, techo, piso) DEBEN pertenecer a la renderList para bloquear físicamente la luz.
   * Solo por las aberturas geométricas (donde no haya polígonos) la luz escapará al exterior.
   */
  public rebuildShadowRenderList(slot: PoolSlot, entityUid: string, lightPos: Vector3, range: number): void {
    if (!slot.sg) {
      const config = slot.type === 'spot' ? this.shadowQualitySvc.getSpotConfig() : this.shadowQualitySvc.getPointConfig();
      slot.sg = new ShadowGenerator(config.resolution, slot.light);

      slot.sg.usePercentageCloserFiltering = true;
      slot.sg.filteringQuality = config.filteringQuality;
      slot.sg.bias = 0.0005;
      slot.sg.normalBias = 0.01;
      if (slot.type === 'point') {
        slot.sg.useContactHardeningShadow = false;
      }
    } else {
      const config = slot.type === 'spot' ? this.shadowQualitySvc.getSpotConfig() : this.shadowQualitySvc.getPointConfig();
      slot.sg.filteringQuality = config.filteringQuality;
    }

    const renderList = slot.sg.getShadowMap()?.renderList;
    if (!renderList) return;

    // Limpiar asociaciones inversas anteriores de este slot
    for (const [, slotsSet] of this.entityToActiveSlotsMap.entries()) {
      slotsSet.delete(slot);
    }

    renderList.length = 0;
    slot.hasDynamicCasters = false;

    const ownerEnt = this.entityManager.getEntityByUid(entityUid);
    const rangeSq = range * range;
    const addedUids = new Set<string>();

    for (let i = 0; i < this.castersCache.length; i++) {
      const m = this.castersCache[i];
      if (m.isDisposed()) continue;

      // No permitir que la representación física de la bombilla se ocluya a sí misma
      const meshEntityUid = (m as any).metadata?.entityUid;
      if (meshEntityUid === entityUid) continue;

      // En luces interiores, el pasillo entero proyecta sombra bloqueando paredes y dejando escapar luz por puertas
      const distSq = Vector3.DistanceSquared(m.getAbsolutePosition(), lightPos);
      if (distSq <= rangeSq) {
        renderList.push(m);

        if (meshEntityUid) {
          addedUids.add(meshEntityUid);
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

    slot.sg.getShadowMap()!.refreshRate = isEditor ? 1 : rate;
  }

  private isDynamicCaster(e: GameEntity): boolean {
    if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') return true;
    if (e.autoAnim?.enabled) return true;
    if (e.movementAuthority !== 'GAMEPLAY') return true;
    return false;
  }
}