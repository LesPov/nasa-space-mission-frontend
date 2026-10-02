
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, SpotLight, DirectionalLight, Vector3, Color3, Tags, ShadowGenerator, AbstractMesh, Mesh, StandardMaterial, RenderTargetTexture } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';
import { GameEntity } from '../../../entities/game.entity';
import { LightContainmentService } from './light-containment.service';
import { GameMode } from '../../../session/game-mode.model';
import { SpatialSchedulerService } from '../spatial-scheduler.service';
import { InteractableRulesService } from '../../rules/interactable-rules.service';
import { ShadowLODManager } from '../../shadows/shadow-lod-manager.service';
import { ShadowCache } from '../../shadows/shadow-cache.service';

export interface VirtualLight {
    entity: GameEntity;
    materials: any[];
    baseColor: Color3;
    currentMultiplier: number;
    targetMultiplier: number;
    distSq: number;
    isLightInRange: boolean;
    isShadowInRange: boolean;
    lastEvaluatedDistance: number;
    _lastRenderedMultiplier?: number;
}

interface PoolSlot {
    index: number;
    type: 'point' | 'spot' | 'directional';
    light: PointLight | SpotLight | DirectionalLight;
    sg: ShadowGenerator | null; 
    assignedEntityUid: string | null;
    currentIntensity: number;
    lastShadowRebuildPos?: Vector3; 
    _isNewAssignment?: boolean; 
    
    hasDynamicCasters?: boolean;
    isStaticLight?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private context = inject(GameContextService); 
  private containmentSvc = inject(LightContainmentService);
  private spatialScheduler = inject(SpatialSchedulerService); 
  private interactRules = inject(InteractableRulesService); 
  private shadowLOD = inject(ShadowLODManager);
  private shadowCache = inject(ShadowCache);

  private virtualLights: VirtualLight[] = [];
  private pointPool: PoolSlot[] = [];
  private spotPool: PoolSlot[] = [];
  private dirPool: PoolSlot[] = []; 
  
  private isInitialized = false;
  private shadowCastersCache: AbstractMesh[] = [];
  private isFirstFrame = true;

  private MAX_LOCAL_SHADER_LIGHTS = 3;
  private MAX_SHADOW_LIGHTS = 3;
  private readonly LIGHT_VISUAL_MIN_INTENSITY = 0.0001;
  private readonly LIGHT_DISABLE_THRESHOLD = 0.00001;

  private static _Z_AXIS = new Vector3(0, 0, 1);
  private static _fallbackPos = Vector3.Zero();
  
  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public profilerDisableLocalLights = false;

  public getProfilerMetrics() {
    let activeSlots = 0;
    let shadowedSlots = 0;
    [...this.pointPool, ...this.spotPool, ...this.dirPool].forEach(s => {
      if (s.assignedEntityUid) {
        activeSlots++;
        if (s.light.shadowEnabled) shadowedSlots++;
      }
    });

    return {
      totalVirtual: this.virtualLights.length,
      activePool: activeSlots,
      shadowedPool: shadowedSlots
    };
  }

  public getVirtualLightByUid(uid: string): VirtualLight | undefined {
    return this.virtualLights.find(v => v.entity.uid === uid);
  }

  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const refMode = customMode || 'AUTO';

      if (refMode === 'CAMERA') {
        const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
        if (camera) return camera.globalPosition;
        return DynamicLightingSystem._fallbackPos;
      }

      if (refMode === 'PLAYER') {
        const playerEntity = this.context.activePlayerEntity();
        if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
        }
      }

      if (!isEditor) {
        const playerEntity = this.context.activePlayerEntity();
        if (playerEntity && playerEntity.view) {
            return playerEntity.view.getAbsolutePosition();
        }
      }

      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      if (camera) return camera.globalPosition;
      return DynamicLightingSystem._fallbackPos;
  }

  private getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
      if (!entity.view) {
          outPos.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
          outDir.copyFrom(DynamicLightingSystem._Z_AXIS);
          return;
      }

      let targetNode: any = entity.view;

      if (entity.light?.attachedNodeName) {
          const boneNode = entity.view.getDescendants(false).find(n => n.name === entity.light!.attachedNodeName);
          if (boneNode) {
              targetNode = boneNode;
          }
      }

      outPos.copyFrom(targetNode.getAbsolutePosition());
      
      if (targetNode.getDirectionToRef) {
          targetNode.getDirectionToRef(DynamicLightingSystem._Z_AXIS, outDir);
      } else if (targetNode.getDirection) {
          outDir.copyFrom(targetNode.getDirection(DynamicLightingSystem._Z_AXIS));
      } else {
          outDir.copyFrom(DynamicLightingSystem._Z_AXIS);
      }
      outDir.normalize();
  }

  private isDynamicLight(entity: GameEntity): boolean {
      if (entity.light?.attachedNodeName) return true;
      if (entity.autoAnim?.enabled) return true;
      if (entity.movementAuthority.startsWith('CINEMATIC')) return true;
      return false;
  }

  private isDynamicCaster(entity: GameEntity): boolean {
      if (entity.rol === 'player' || entity.rol === 'npc' || entity.characterConfig) return true;
      if (entity.autoAnim?.enabled) return true;
      if (entity.movementAuthority.startsWith('CINEMATIC')) return true;
      return false;
  }

  private isEligibleShadowCaster(e: GameEntity): boolean {
      if (!e.view) return false;
      const isManuallyHidden = !e.isCulled && (!e.view.isVisible || !e.view.isEnabled());
      if (isManuallyHidden) return false;

      if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
      if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) return false;
      if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') return true;

      const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
      if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
          const isInteractable = this.interactRules.isInteractable(e);
          if (isInteractable) return true; 

          const radius = e.view.getBoundingInfo().boundingSphere.radiusWorld;
          const diag = radius * 2;
          
          if (diag < 0.6) return false;
          return true;
      }
      return false;
  }

  public prepareAllLights(): void {
      const scene = this.motor3d.getScene();
      if (!scene) return;

      if (!this.isInitialized) {
          this.initializePool(scene);
      }

      this.refreshShadowCastersCache();
      this.refreshVirtualLightsRegistry();

      this.spatialScheduler.forceNextEvaluation(); 
      this.evaluateDistanceAndHysteresis();
      this.allocatePoolSlots();
  }

  private initializePool(scene: any): void {
      this.pointPool = [];
      this.spotPool = [];
      this.dirPool = [];
      this.virtualLights = [];
      this.shadowCastersCache = [];
      this.containmentSvc.clearAllCache();

      const engine = this.motor3d.getEngine();
      const maxUbo = (engine.getCaps() as { maxUniformBufferBindings?: number }).maxUniformBufferBindings || 12; 
      
      const BASE_UBOS = 6;
      const availableUBOsForShadows = Math.max(0, maxUbo - BASE_UBOS);
      this.MAX_SHADOW_LIGHTS = Math.min(3, availableUBOsForShadows);
      this.MAX_LOCAL_SHADER_LIGHTS = 3;

      for(let i = 0; i < this.MAX_LOCAL_SHADER_LIGHTS; i++) {
          const hasShadows = i < this.MAX_SHADOW_LIGHTS;

          const pLight = new PointLight(`pool_point_${i}`, new Vector3(0, -99999, 0), scene);
          pLight.intensity = 0; pLight.diffuse = Color3.Black(); pLight.shadowEnabled = hasShadows; pLight.shadowMinZ = 0.05;
          Tags.AddTagsTo(pLight, "system_element");

          let pSg: ShadowGenerator | null = null;
          if (hasShadows) {
              pSg = new ShadowGenerator(512, pLight);
              pSg.usePercentageCloserFiltering = true; 
              pSg.filteringQuality = ShadowGenerator.QUALITY_LOW;
              pSg.setDarkness(0.0); pSg.bias = 0.005; pSg.normalBias = 0.02; pSg.forceBackFacesOnly = false;
          }
          this.pointPool.push({ index: i, type: 'point', light: pLight, sg: pSg, assignedEntityUid: null, currentIntensity: 0 });

          const sLight = new SpotLight(`pool_spot_${i}`, new Vector3(0, -99999, 0), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
          sLight.intensity = 0; sLight.diffuse = Color3.Black(); sLight.shadowEnabled = hasShadows; sLight.shadowMinZ = 0.1;
          Tags.AddTagsTo(sLight, "system_element");

          let sSg: ShadowGenerator | null = null;
          if (hasShadows) { 
              sSg = new ShadowGenerator(1024, sLight);
              sSg.usePercentageCloserFiltering = true; sSg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
              sSg.setDarkness(0.0); sSg.bias = 0.001; sSg.normalBias = 0.015; sSg.forceBackFacesOnly = false;
          }
          this.spotPool.push({ index: i, type: 'spot', light: sLight, sg: sSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      for(let i = 0; i < 2; i++) { 
          const hasShadows = i < 1; 
          const dLight = new DirectionalLight(`pool_dir_${i}`, new Vector3(0, -1, 0), scene);
          dLight.intensity = 0; dLight.diffuse = Color3.Black(); dLight.shadowEnabled = hasShadows; 
          Tags.AddTagsTo(dLight, "system_element");

          let dSg: ShadowGenerator | null = null;
          if (hasShadows) { 
              dSg = new ShadowGenerator(1024, dLight);
              dSg.usePercentageCloserFiltering = true; dSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
              dSg.setDarkness(0.0); dSg.bias = 0.001; dSg.normalBias = 0.015; dSg.forceBackFacesOnly = false;
          }
          this.dirPool.push({ index: i, type: 'directional', light: dLight, sg: dSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      this.isInitialized = true;
  }

  private refreshShadowCastersCache(): void {
      this.shadowCastersCache = [];
      this.entityManager.getAllEntities().forEach(e => {
          if (this.isEligibleShadowCaster(e) && e.view) {
              const addMesh = (m: AbstractMesh) => {
                  const isManuallyHidden = !e.isCulled && (!m.isVisible || !m.isEnabled());
                  if (!isManuallyHidden && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) {
                      if (m instanceof Mesh && m.getTotalVertices() > 0) {
                          this.shadowCastersCache.push(m);
                      }
                      m.receiveShadows = true;
                  }
              };
              addMesh(e.view);
              e.view.getChildMeshes(false).forEach(addMesh);
          } else if (e.view) {
              if (!Tags.MatchesQuery(e.view, "light_visual || debug_element || proxy_collider")) {
                  e.view.receiveShadows = true;
                  e.view.getChildMeshes(false).forEach(cm => {
                      if (!Tags.MatchesQuery(cm, "light_visual || debug_element || proxy_collider")) cm.receiveShadows = true;
                  });
              }
          }
      });
  }

  private refreshVirtualLightsRegistry(): void {
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

      if (!vl) {
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
          vl = {
              entity: e, materials: mats, baseColor, currentMultiplier: 0.0, targetMultiplier: 0.0, distSq: 0,
              isLightInRange: false, isShadowInRange: false, lastEvaluatedDistance: 0, _lastRenderedMultiplier: -1
          };
          this.virtualLights.push(vl);
      } else {
          vl.entity = e;
          vl.baseColor = baseColor;
      }
      return vl;
  }

  public start(): void { 
      this.isFirstFrame = true; 
      this.spatialScheduler.reset();
      this.spatialScheduler.forceNextEvaluation();
  }

  public stop(): void {
      const cleanPool = (pool: PoolSlot[]) => {
          pool.forEach(p => { 
            this.containmentSvc.clearContainment(p.light as any);
            if (p.light && !p.light.isDisposed()) p.light.dispose(); 
            if (p.sg) p.sg.dispose(); 
          });
      };
      cleanPool(this.pointPool);
      cleanPool(this.spotPool);
      cleanPool(this.dirPool);
      
      this.pointPool = []; this.spotPool = []; this.dirPool = [];
      this.virtualLights = []; this.shadowCastersCache = [];
      this.containmentSvc.clearAllCache();
      this.shadowCache.clearMetrics();
      this.spatialScheduler.reset();
      this.isInitialized = false;
  }

  private updateRenderListIfChanged(currentList: AbstractMesh[], newList: AbstractMesh[]): void {
      if (currentList.length === newList.length) {
          let isSame = true;
          for (let i = 0; i < newList.length; i++) {
              if (currentList[i] !== newList[i]) {
                  isSame = false;
                  break;
              }
          }
          if (isSame) return;
      }
      currentList.length = 0;
      for (let i = 0; i < newList.length; i++) {
          currentList.push(newList[i]);
      }
  }

  private rebuildShadowRenderList(slot: PoolSlot, entityToExcludeUid: string): void {
      if (!slot.sg) return;
      const rList = slot.sg.getShadowMap()?.renderList;
      if (!rList) return;
      
      this.shadowCache.recordRebuild();

      const lightEntity = this.entityManager.getEntityByUid(entityToExcludeUid);
      const lightMesh = lightEntity?.view;
      
      const lightPos = slot.light.getAbsolutePosition();
      const lightRange = slot.type === 'directional' ? Number.MAX_VALUE : (slot.light as PointLight | SpotLight).range;
      const maxDistSq = lightRange * lightRange;

      const newRenderList: AbstractMesh[] = [];
      let hasDynamic = false;

      for (let i = 0; i < this.shadowCastersCache.length; i++) {
          const m = this.shadowCastersCache[i];
          if (!m || m.isDisposed()) continue;
          if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) continue;
          if (lightMesh && m === lightMesh) continue;
          
          if (slot.type !== 'directional') {
              const meshPos = m.getBoundingInfo().boundingSphere.centerWorld;
              const distSq = Vector3.DistanceSquared(lightPos, meshPos);
              const radius = m.getBoundingInfo().boundingSphere.radiusWorld;
              const effectiveDist = Math.max(0, Math.sqrt(distSq) - radius);
              if (effectiveDist * effectiveDist > maxDistSq) continue;
          }
          
          const casterEnt = this.entityManager.getEntityByMesh(m);
          if (casterEnt && this.isDynamicCaster(casterEnt)) {
              hasDynamic = true;
          }
          
          newRenderList.push(m);
      }
      
      slot.hasDynamicCasters = hasDynamic;
      slot.isStaticLight = lightEntity ? !this.isDynamicLight(lightEntity) : true;
      
      this.updateRenderListIfChanged(rList, newRenderList);
  }

  // 🔥 FASE 5: Actualización inteligente del Refresh Rate
  private applyShadowLOD(slot: PoolSlot, isEditor: boolean): void {
      if (!slot.sg) return;
      const shadowMap = slot.sg.getShadowMap();
      if (!shadowMap) return;

      // En el editor queremos respuesta instantánea de las sombras para comodidad autoral.
      if (isEditor) {
          shadowMap.refreshRate = 1;
          return;
      }

      const dist = Vector3.Distance(this.getReferencePosition(), slot.light.getAbsolutePosition());
      shadowMap.refreshRate = this.shadowLOD.getRefreshRate(dist, slot.hasDynamicCasters ?? false, !slot.isStaticLight);
  }

  private evaluateDistanceAndHysteresis(): void {
      const baseRefPos = this.getReferencePosition('AUTO');

      for (let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.isLightInRange = false; vl.isShadowInRange = false; vl.targetMultiplier = 0;
              continue;
          }

          const refPos = lightComp.distanceReferenceMode === 'AUTO' ? baseRefPos : this.getReferencePosition(lightComp.distanceReferenceMode);
          
          this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          
          vl.distSq = Vector3.DistanceSquared(refPos, this._tempPos);
          const dist = Math.sqrt(vl.distSq);
          vl.lastEvaluatedDistance = dist;

          if (lightComp.distanceControlEnabled) {
              const actDist = Math.max(0.1, lightComp.activationDistance ?? 65);
              const deactDist = Math.max(actDist, lightComp.deactivationDistance ?? (actDist + 10));
              const fadeStartDist = actDist * 0.6;
              const fadeEndDist = actDist; 

              if (vl.isLightInRange) {
                  if (dist > deactDist) { vl.isLightInRange = false; vl.targetMultiplier = 0; } 
                  else {
                      if (dist <= fadeStartDist) vl.targetMultiplier = 1.0;
                      else if (dist >= fadeEndDist) vl.targetMultiplier = this.LIGHT_DISABLE_THRESHOLD;
                      else {
                          let t = 1.0 - ((dist - fadeStartDist) / (fadeEndDist - fadeStartDist));
                          t = Math.max(0, Math.min(1, t));
                          vl.targetMultiplier = (t * t * (3.0 - 2.0 * t));
                      }
                  }
              } else {
                  if (dist <= actDist) {
                      vl.isLightInRange = true;
                      if (dist <= fadeStartDist) vl.targetMultiplier = 1.0;
                      else {
                          let t = 1.0 - ((dist - fadeStartDist) / (fadeEndDist - fadeStartDist));
                          t = Math.max(0, Math.min(1, t));
                          vl.targetMultiplier = (t * t * (3.0 - 2.0 * t));
                      }
                  } else { vl.targetMultiplier = 0; }
              }
          } else {
              vl.isLightInRange = true; vl.targetMultiplier = 1.0;
          }

          if (vl.isLightInRange && lightComp.castShadows) {
              if (lightComp.distanceShadowsEnabled) {
                  const sActDist = Math.max(0.1, lightComp.shadowActivationDistance ?? 30);
                  const sDeactDist = Math.max(sActDist, lightComp.shadowDeactivationDistance ?? (sActDist + 6));
                  if (vl.isShadowInRange) { if (dist > sDeactDist) vl.isShadowInRange = false; } 
                  else { if (dist <= sActDist) vl.isShadowInRange = true; }
              } else { vl.isShadowInRange = true; }
          } else { vl.isShadowInRange = false; }
      }
  }

  private allocatePoolSlots(): void {
      const activeVirtuals = this.virtualLights.filter(vl => vl.entity.light?.enabled !== false && vl.isLightInRange);

      const selectedMesh = this.context.selectedNode() as AbstractMesh;
      let selectedUid: string | null = null;
      if (selectedMesh) {
        if ((selectedMesh as any).metadata?.entityUid) selectedUid = (selectedMesh as any).metadata.entityUid;
        else {
          const ent = this.entityManager.getEntityByMesh(selectedMesh);
          if (ent) selectedUid = ent.uid;
        }
      }

      const assignedSet = new Set<string>();
      this.pointPool.forEach(s => s.assignedEntityUid && assignedSet.add(s.assignedEntityUid));
      this.spotPool.forEach(s => s.assignedEntityUid && assignedSet.add(s.assignedEntityUid));
      this.dirPool.forEach(s => s.assignedEntityUid && assignedSet.add(s.assignedEntityUid));

      activeVirtuals.sort((a, b) => {
          if (selectedUid) {
              if (a.entity.uid === selectedUid) return -1;
              if (b.entity.uid === selectedUid) return 1;
          }
          const isA_Assigned = assignedSet.has(a.entity.uid);
          const isB_Assigned = assignedSet.has(b.entity.uid);
          let distA = a.distSq; let distB = b.distSq;
          if (isA_Assigned) distA *= 0.8; 
          if (isB_Assigned) distB *= 0.8; 
          return distA - distB;
      });

      const topVirtuals = activeVirtuals.slice(0, this.MAX_LOCAL_SHADER_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      const releaseSlot = (slot: PoolSlot) => {
          if (slot.assignedEntityUid && !topUids.has(slot.assignedEntityUid)) {
              slot.assignedEntityUid = null;
              // 🔥 FASE 5: Vaciar la renderList desactiva completamente el trabajo de CPU/GPU de sombras para el slot inactivo.
              if (slot.sg && slot.sg.getShadowMap()?.renderList) slot.sg.getShadowMap()!.renderList!.length = 0; 
              slot.currentIntensity = 0; slot.light.intensity = 0; 
              slot.light.shadowEnabled = false; 
              if (slot.type !== 'directional') {
                  (slot.light as any).position.set(0, -99999, 0); 
              }
          }
      };

      this.pointPool.forEach(releaseSlot);
      this.spotPool.forEach(releaseSlot);
      this.dirPool.forEach(releaseSlot);

      const scene = this.motor3d.getScene();

      topVirtuals.forEach(vl => {
          const isPoint = vl.entity.type === 'light_point';
          const isDir = vl.entity.type === 'light_directional';
          const pool = isPoint ? this.pointPool : (isDir ? this.dirPool : this.spotPool);
          const wantsShadow = vl.isShadowInRange;

          let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

          if (!existingSlot) {
              let freeSlot = null;
              if (wantsShadow) freeSlot = pool.find(s => s.sg !== null && s.assignedEntityUid === null);
              if (!freeSlot) freeSlot = pool.find(s => s.sg === null && s.assignedEntityUid === null);
              if (!freeSlot) freeSlot = pool.find(s => s.assignedEntityUid === null);

              if (freeSlot) {
                  freeSlot.assignedEntityUid = vl.entity.uid;
                  freeSlot.currentIntensity = 0; freeSlot.light.intensity = 0; 
                  freeSlot._isNewAssignment = true; 
                  existingSlot = freeSlot;
              }
          }

          if (existingSlot) {
              this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
              existingSlot.light.position.copyFrom(this._tempPos);
              
              if (existingSlot.type === 'spot') {
                  const spot = existingSlot.light as SpotLight;
                  spot.direction.copyFrom(this._tempDir);
                  spot.angle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
              } else if (existingSlot.type === 'directional') {
                  const dirL = existingSlot.light as DirectionalLight;
                  dirL.direction.copyFrom(this._tempDir);
              }

              if (existingSlot.type !== 'directional') {
                  const range = vl.entity.light?.range || 50;
                  (existingSlot.light as PointLight|SpotLight).range = range;
                  existingSlot.light.shadowMaxZ = range;
              }

              if (existingSlot.sg) {
                  if (wantsShadow) {
                      this.rebuildShadowRenderList(existingSlot, vl.entity.uid);
                      if (vl.entity.light?.containmentMode === 'INTERIOR' && existingSlot.type !== 'directional') {
                          existingSlot.sg.setDarkness(vl.entity.light.shadowDarkness ?? 0.0);
                          existingSlot.sg.bias = vl.entity.light.shadowBias ?? (existingSlot.type === 'point' ? 0.002 : 0.001);
                          existingSlot.sg.normalBias = vl.entity.light.shadowNormalBias ?? (existingSlot.type === 'point' ? 0.005 : 0.015);
                      } else {
                          existingSlot.sg.setDarkness(0.0);
                          existingSlot.sg.bias = existingSlot.type === 'point' ? 0.002 : 0.001;
                          existingSlot.sg.normalBias = existingSlot.type === 'point' ? 0.005 : 0.015;
                      }
                  } else {
                      if (existingSlot.sg.getShadowMap()?.renderList) existingSlot.sg.getShadowMap()!.renderList!.length = 0;
                  }
              }

              if (scene && existingSlot.type !== 'directional') {
                this.containmentSvc.applyContainment(existingSlot.light as any, vl.entity, scene);
              }
          }
      });
  }

  public syncLightImmediate(entity: GameEntity): void {
      if (!this.isInitialized) this.prepareAllLights();
      const scene = this.motor3d.getScene();
      const lightComp = entity.light;
      if (!lightComp || !scene) return;

      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const hexColor = isBW ? lightComp.lightColorBW : lightComp.lightColor;
      const baseColor = Color3.FromHexString(hexColor || '#ffffff');

      const vl = this.registerOrUpdateVirtualLight(entity);
      vl.baseColor = baseColor;
      
      this.spatialScheduler.forceNextEvaluation();
      this.evaluateDistanceAndHysteresis();

      const isPoint = entity.type === 'light_point';
      const isDir = entity.type === 'light_directional';
      const pool = isPoint ? this.pointPool : (isDir ? this.dirPool : this.spotPool);

      let slot = pool.find(s => s.assignedEntityUid === entity.uid);
      if (!slot && vl.isLightInRange) {
          this.allocatePoolSlots();
          slot = pool.find(s => s.assignedEntityUid === entity.uid);
      }

      this.getLightWorldTransform(entity, this._tempPos, this._tempDir);

      if (slot) {
          slot.light.position.copyFrom(this._tempPos);
          if (slot.type === 'spot') {
              const spot = slot.light as SpotLight;
              spot.direction.copyFrom(this._tempDir);
              spot.angle = (lightComp.angle || 60) * (Math.PI / 180);
          } else if (slot.type === 'directional') {
              const dirL = slot.light as DirectionalLight;
              dirL.direction.copyFrom(this._tempDir);
          }

          if (slot.type !== 'directional') {
              const lightRange = lightComp.range ?? 50;
              (slot.light as PointLight|SpotLight).range = lightRange;
              slot.light.shadowMaxZ = lightRange;
          }
          slot.light.diffuse.copyFrom(baseColor);

          let finalIntensity = (lightComp.enabled && vl.isLightInRange) ? (lightComp.intensity ?? 1.0) * vl.targetMultiplier : 0;
          if (this.profilerDisableLocalLights) finalIntensity = 0;

          slot.currentIntensity = finalIntensity; slot.light.intensity = finalIntensity;

          const isEnabled = lightComp.enabled && vl.isLightInRange && finalIntensity > this.LIGHT_DISABLE_THRESHOLD;
          if (!isEnabled) {
              if (slot.type !== 'directional') {
                  (slot.light as any).position.set(0, -99999, 0);
              }
              slot.light.intensity = 0;
          }

          const wantsShadow = vl.isShadowInRange;
          slot.light.shadowEnabled = wantsShadow;

          if (slot.sg) {
              if (wantsShadow) {
                  this.rebuildShadowRenderList(slot, entity.uid);
                  if (lightComp.containmentMode === 'INTERIOR' && slot.type !== 'directional') {
                      slot.sg.setDarkness(lightComp.shadowDarkness ?? 0.0);
                      slot.sg.bias = lightComp.shadowBias ?? (slot.type === 'point' ? 0.002 : 0.001);
                      slot.sg.normalBias = lightComp.shadowNormalBias ?? (slot.type === 'point' ? 0.005 : 0.015);
                  } else {
                      slot.sg.setDarkness(0.0);
                      slot.sg.bias = slot.type === 'point' ? 0.002 : 0.001;
                      slot.sg.normalBias = slot.type === 'point' ? 0.005 : 0.015;
                  }
              } else {
                  if (slot.sg.getShadowMap()?.renderList) slot.sg.getShadowMap()!.renderList!.length = 0;
              }
          }

          if (slot.type !== 'directional') {
              this.containmentSvc.markDirty(entity.uid);
              this.containmentSvc.applyContainment(slot.light as any, entity, scene);
          }
      }

      if (entity.view) {
          const visual = entity.view.getChildMeshes(false).find(m => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
          if (visual && visual.material && visual.material instanceof StandardMaterial) {
              visual.material.emissiveColor.copyFrom(baseColor);
              visual.material.diffuseColor.copyFrom(baseColor);
          }

          let emissiveScale = (lightComp.intensity / 5) * (vl.isLightInRange ? vl.targetMultiplier : 0.1);
          if (this.profilerDisableLocalLights) emissiveScale = 0;

          const r = baseColor.r * emissiveScale; const g = baseColor.g * emissiveScale; const b = baseColor.b * emissiveScale;

          for (let j = 0; j < vl.materials.length; j++) {
              if (vl.materials[j].emissiveColor) vl.materials[j].emissiveColor.set(r, g, b);
          }
      }
  }

  public update(dtMs: number): void {
      const scene = this.motor3d.getScene();
      if (!scene || !this.isInitialized) return;

      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

      const lerpSpeed = (this.isFirstFrame || isEditor) ? 1.0 : Math.min(1.0, dtMs * 0.005);
      
      const refPos = this.getReferencePosition('AUTO');

      if (this.isFirstFrame || this.spatialScheduler.shouldEvaluate(refPos, dtMs)) {
          this.evaluateDistanceAndHysteresis();
          this.allocatePoolSlots();
      }

      for(let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          if (!lightComp || !vl.entity.view || !lightComp.enabled || !vl.isLightInRange) vl.targetMultiplier = 0;

          const matchedSlot = [...this.pointPool, ...this.spotPool, ...this.dirPool].find(s => s.assignedEntityUid === vl.entity.uid);
          if (matchedSlot && matchedSlot._isNewAssignment) {
              vl.currentMultiplier = vl.targetMultiplier;
              matchedSlot._isNewAssignment = false;
          } else {
              const multDiff = Math.abs(vl.targetMultiplier - vl.currentMultiplier);
              if (multDiff > 0.001 || isEditor) {
                  vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * lerpSpeed;
                  if (vl.currentMultiplier < this.LIGHT_DISABLE_THRESHOLD) vl.currentMultiplier = 0;
              } else {
                  vl.currentMultiplier = vl.targetMultiplier;
              }
          }

          const renderDiff = Math.abs(vl.currentMultiplier - (vl._lastRenderedMultiplier ?? -1));
          
          if (renderDiff > 0.005 || this.isFirstFrame || isEditor) {
              vl._lastRenderedMultiplier = vl.currentMultiplier;
              
              const hexColor = lightComp ? (isBW ? lightComp.lightColorBW : lightComp.lightColor) : '#ffffff';
              vl.baseColor = Color3.FromHexString(hexColor || '#ffffff');
              
              const animatedIntensity = lightComp?.renderIntensity ?? lightComp?.intensity ?? 1.0;
              let emissiveScale = (animatedIntensity / 5) * vl.currentMultiplier; 
              if (this.profilerDisableLocalLights) emissiveScale = 0;
              
              const r = vl.baseColor.r * emissiveScale; const g = vl.baseColor.g * emissiveScale; const b = vl.baseColor.b * emissiveScale;
              for(let j = 0; j < vl.materials.length; j++) {
                  if (vl.materials[j].emissiveColor) vl.materials[j].emissiveColor.set(r, g, b);
              }
          }
      }

      let statics = 0;
      let dynamics = 0;

      const syncSlot = (slot: PoolSlot) => {
          if (!slot.assignedEntityUid) {
              if (Math.abs(slot.currentIntensity) > 0.0001) {
                  slot.currentIntensity = 0; slot.light.intensity = 0; slot.light.diffuse.set(0, 0, 0);
                  if (slot.type !== 'directional') {
                      (slot.light as any).position.set(0, -99999, 0);
                  }
              }
              return;
          }

          const vl = this.virtualLights.find(v => v.entity.uid === slot.assignedEntityUid);
          if (!vl || !vl.entity.light || !vl.isLightInRange) {
              slot.assignedEntityUid = null; 
              slot.currentIntensity = 0; slot.light.intensity = 0; 
              slot.light.shadowEnabled = false;
              if (slot.type !== 'directional') {
                  (slot.light as any).position.set(0, -99999, 0);
              }
              return;
          }

          this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          
          if (slot.type !== 'directional') {
              if (Vector3.DistanceSquared(slot.light.position, this._tempPos) > 0.001) {
                  slot.light.position.copyFrom(this._tempPos);
              }
          }
          
          if (slot.type === 'spot') {
              const spot = slot.light as SpotLight;
              spot.direction.copyFrom(this._tempDir);
              spot.angle = (vl.entity.light.angle || 60) * (Math.PI / 180);
          } else if (slot.type === 'directional') {
              const dirL = slot.light as DirectionalLight;
              dirL.direction.copyFrom(this._tempDir);
          }

          if (slot.type !== 'directional') {
              const lightRange = vl.entity.light.range || 50;
              (slot.light as PointLight|SpotLight).range = lightRange;
              slot.light.shadowMaxZ = lightRange;
          }
          
          slot.light.diffuse.copyFrom(vl.baseColor);

          const animatedIntensity = vl.entity.light.renderIntensity ?? vl.entity.light.intensity ?? 1.0;
          let finalIntensity = animatedIntensity * vl.currentMultiplier;
          if (!vl.entity.light.enabled) finalIntensity = 0;
          if (this.profilerDisableLocalLights) finalIntensity = 0;

          if (Math.abs(slot.currentIntensity - finalIntensity) > 0.001 || this.isFirstFrame) {
              slot.currentIntensity = finalIntensity; 
              slot.light.intensity = finalIntensity;
              
              const isEnabled = vl.entity.light.enabled && slot.light.intensity > this.LIGHT_DISABLE_THRESHOLD;
              if (!isEnabled) {
                  if (slot.type !== 'directional') {
                      (slot.light as any).position.set(0, -99999, 0);
                  }
                  slot.light.intensity = 0;
              }
          }

          const wantsShadow = vl.isShadowInRange;
          slot.light.shadowEnabled = wantsShadow;

          if (slot.sg) {
              if (wantsShadow) {
                  // 🔥 FASE 5: Evaluación RENDER ONCE vs DYNAMIC REFRESH
                  let listRebuilt = false;

                  // 1. Verificar si la luz se movió drásticamente para reconstruir la lista de casters.
                  const distMovedSq = slot.lastShadowRebuildPos ? Vector3.DistanceSquared(slot.lastShadowRebuildPos, slot.light.position) : 9999;
                  if (!slot.sg.getShadowMap()?.renderList?.length || distMovedSq > 4.0 || this.isFirstFrame) {
                      this.rebuildShadowRenderList(slot, vl.entity.uid);
                      if (!slot.lastShadowRebuildPos) slot.lastShadowRebuildPos = Vector3.Zero();
                      slot.lastShadowRebuildPos.copyFrom(slot.light.position);
                      listRebuilt = true;
                  }

                  this.applyShadowLOD(slot, isEditor);

                  let triggerOneShot = listRebuilt; // Si la lista se regeneró, es mandatorio recalcular la sombra
                  
                  // 2. Si la sombra está congelada (RENDER ONCE), verificamos flags de suciedad para pedir un solo frame de re-renderizado
                  if (!triggerOneShot && slot.sg.getShadowMap()?.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
                      if (vl.entity.isDirty || this.isFirstFrame) {
                          triggerOneShot = true;
                      }
                      
                      // Escaneamos solo los casters asignados a ESTA sombra
                      if (!triggerOneShot && slot.sg.getShadowMap()?.renderList) {
                          const rList = slot.sg.getShadowMap()!.renderList!;
                          for (let mIdx = 0; mIdx < rList.length; mIdx++) {
                              const e = this.entityManager.getEntityByMesh(rList[mIdx]);
                              if (e && e.isDirty) {
                                  triggerOneShot = true;
                                  break;
                              }
                          }
                      }
                  }

                  if (triggerOneShot) {
                      slot.sg.getShadowMap()?.resetRefreshCounter();
                      this.shadowCache.recordInvalidation();
                  }

                  if (slot.isStaticLight && !slot.hasDynamicCasters) statics++;
                  else dynamics++;

              } else {
                  if ((slot.sg.getShadowMap()?.renderList?.length ?? 0) > 0) {
                      slot.sg.getShadowMap()!.renderList!.length = 0;
                  }
              }
          }

          if (slot.type !== 'directional') {
              this.containmentSvc.applyContainment(slot.light as any, vl.entity, scene);
          }
      };

      this.pointPool.forEach(syncSlot);
      this.spotPool.forEach(syncSlot);
      this.dirPool.forEach(syncSlot);

      this.shadowCache.setLightDistribution(statics, dynamics);

      this.isFirstFrame = false;
  }
}