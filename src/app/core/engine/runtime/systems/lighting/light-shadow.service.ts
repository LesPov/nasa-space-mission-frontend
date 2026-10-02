
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, ShadowGenerator, Vector3, Tags, InstancedMesh, Mesh } from '@babylonjs/core';
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

  public clearCache(): void {
    this.castersCache.length = 0;
  }

  public refreshShadowCastersCache(): void {
    this.castersCache.length = 0;
    const entities = this.entityManager.getAllEntities();
    
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.isEligibleShadowCaster(e) && e.view && !e.view.isDisposed()) {
        const processMesh = (m: AbstractMesh) => {
           if (m.isDisposed()) return;
           
           // 🔥 FIX CRÍTICO: Removida la exclusión por `m.isVisible` para evitar desincronizaciones 
           // con objetos que apenas se están revelando en el nivel mediante Fade.
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
        
        // Reducido a 10cm de diámetro global jerárquico.
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
        slot.sg.bias = 0.001;
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

    renderList.length = 0;
    slot.hasDynamicCasters = false;
    
    // 🔥 PADRE CON LUZ HIJA: Detectamos al padre para resolver la jerarquía y el modo de contención.
    const ownerEnt = this.entityManager.getEntityByUid(entityUid);
    const containmentMode = ownerEnt?.light?.containmentMode || 'GLOBAL';
    
    const parentUid = ownerEnt?.parentId;
    let parentView: AbstractMesh | null = null;
    if (parentUid) {
        const parentEnt = this.entityManager.getEntityByUid(parentUid);
        if (parentEnt) parentView = parentEnt.view;
    }
    
    const rangeSq = range * range;
    for (let i = 0; i < this.castersCache.length; i++) {
        const m = this.castersCache[i];
        if (m.isDisposed()) continue; 

        const meshEntityUid = (m as any).metadata?.entityUid;

        // Omitimos a la propia luz visual
        if (meshEntityUid === entityUid) continue;

        // 🔥 FIX PADRE-HIJO: Evitamos que el mesh del padre bloquee a la luz interior (Auto-Shadowing preventivo).
        // SÓLO APLICA EN MODO INTERIOR. En GLOBAL o EXTERIOR, el padre (Ej: Poste de luz) DEBE poder proyectar sombra.
        if (containmentMode === 'INTERIOR') {
            if (parentView && (m === parentView || m.isDescendantOf(parentView))) {
                continue;
            }
        }

        const distSq = Vector3.DistanceSquared(m.getAbsolutePosition(), lightPos);
        if (distSq <= rangeSq) {
            renderList.push(m);
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