
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { Color3, Vector3, AbstractMesh, RenderTargetTexture } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { GameEntity } from '../../../entities/game.entity';
import { LightContainmentService } from './light-containment.service';
import { GameMode } from '../../../session/game-mode.model';
import { SpatialSchedulerService } from '../spatial-scheduler.service';
import { ShadowCache } from '../../shadows/shadow-cache.service';
import { GameEventBusService } from '../../../events/game-event-bus.service';

import { LightRegistryService } from './light-registry.service';
import { LightTransformService } from './light-transform.service';
import { LightVisualService } from './light-visual.service';
import { LightReferenceService } from './light-reference.service';
import { LightShadowService } from './light-shadow.service';
import { LightPoolService } from './light-pool.service';
import { LightDistanceService } from './light-distance.service';
import { LightAllocationService } from './light-allocation.service';
import { PoolSlot, VirtualLight } from './lighting-types';

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';
  
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private context = inject(GameContextService); 
  private ownership = inject(CameraOwnershipService);
  private containmentSvc = inject(LightContainmentService);
  private spatialScheduler = inject(SpatialSchedulerService); 
  private worldSettingsSvc = inject(WorldSettingsService);
  private entityManager = inject(EntityManagerService);
  private shadowCache = inject(ShadowCache);
  private eventBus = inject(GameEventBusService);

  private lightRegistry = inject(LightRegistryService);
  private lightTransform = inject(LightTransformService);
  private lightVisual = inject(LightVisualService);
  private lightReference = inject(LightReferenceService);
  private lightShadows = inject(LightShadowService);
  private lightPool = inject(LightPoolService);
  private lightDistance = inject(LightDistanceService);
  private lightAllocation = inject(LightAllocationService);

  private isFirstFrame = true;
  private readonly LIGHT_DISABLE_THRESHOLD = 0.00001;
  
  private lastRefPos = Vector3.Zero();
  private playerVelocity = Vector3.Zero();
  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public profilerDisableLocalLights = false;
  private forceShadowRebuild = false;

  constructor() {
    this.eventBus.events$.subscribe(e => {
        // 🔥 FIX SOMBRAS: Escucha cuando el LocalRenderingSystem restaura un objeto visible 
        // para invalidar y re-renderizar las sombras de las luces que lo cubran.
        if (e.type === 'RuntimeVisibilityBatchChanged') {
            this.forceShadowRebuild = true;
        }
    });
  }

  public getProfilerMetrics() {
    let activeSlots = 0;
    let shadowedSlots = 0;
    this.lightPool.getAllSlots().forEach(s => {
      if (s.assignedEntityUid) {
        activeSlots++;
        if (s.sg) shadowedSlots++;
      }
    });

    return {
      totalVirtual: this.lightRegistry.getVirtualLights().length,
      activePool: activeSlots,
      shadowedPool: shadowedSlots
    };
  }

  public getVirtualLightByUid(uid: string): VirtualLight | undefined {
    return this.lightRegistry.getVirtualLightByUid(uid);
  }

  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
    return this.lightReference.getReferencePosition(customMode);
  }

  public registerOrUpdateVirtualLight(e: GameEntity): VirtualLight {
    return this.lightRegistry.registerOrUpdateVirtualLight(e);
  }

  public reconcileSceneLights(): void {
      this.stop();
      this.prepareAllLights();
  }

  public prepareAllLights(): void {
      const scene = this.motor3d.getScene();
      if (!scene) return;

      if (!this.lightPool.isInitialized) {
          this.lightPool.initializePool(scene);
          this.lightRegistry.clear();
          this.lightShadows.clearCache();
          this.containmentSvc.clearAllCache();
      }

      this.lightShadows.refreshShadowCastersCache();
      this.lightRegistry.refreshVirtualLightsRegistry();

      this.spatialScheduler.forceNextEvaluation(); 
      this.lightDistance.evaluateDistanceAndHysteresis(this.lightRegistry.getVirtualLights(), this.getReferencePosition('AUTO'), 0);
      this.lightAllocation.allocatePoolSlots(this.lightRegistry.getVirtualLights(), this.getReferencePosition('AUTO'), Vector3.Zero(), 0, null);
  }

  public start(): void { 
      this.isFirstFrame = true; 
      this.lastRefPos.copyFrom(this.getReferencePosition('AUTO'));
      this.playerVelocity.setAll(0);
      this.spatialScheduler.reset();
      this.spatialScheduler.forceNextEvaluation();
  }

  public stop(): void {
      this.lightPool.clearPools();
      this.lightRegistry.clear();
      this.lightShadows.clearCache();
      this.containmentSvc.clearAllCache();
      this.shadowCache.clearMetrics();
      this.spatialScheduler.reset();
  }

  public forceWarmup(refPos: Vector3): void {
      if (!this.lightPool.isInitialized) this.prepareAllLights();
      const scene = this.motor3d.getScene();
      if (!scene) return;

      const isEditorPure = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;
      const activeVirtuals = this.lightRegistry.getVirtualLights();

      this.lightDistance.evaluateDistanceAndHysteresis(activeVirtuals, refPos, 0);

      const selectedMesh = this.context.selectedNode() as AbstractMesh;
      let selectedUid: string | null = null;
      if (selectedMesh) {
        if ((selectedMesh as any).metadata?.entityUid) selectedUid = (selectedMesh as any).metadata.entityUid;
        else {
          const ent = this.entityManager.getEntityByMesh(selectedMesh);
          if (ent) selectedUid = ent.uid;
        }
      }

      const prepareRangeVirtuals = activeVirtuals.filter(vl => vl.entity.light?.enabled !== false && (vl._isInPrepareRange || vl.currentMultiplier > 0.001));
      this.lightAllocation.allocatePoolSlots(prepareRangeVirtuals, refPos, Vector3.Zero(), 0, selectedUid);

      for (let i = 0; i < activeVirtuals.length; i++) {
          const vl = activeVirtuals[i];
          vl.currentMultiplier = vl.targetMultiplier;
          vl._lastRenderedMultiplier = vl.currentMultiplier;

          const lightComp = vl.entity.light;
          if (lightComp) {
              const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
              const hexColor = isBW ? lightComp.lightColorBW : lightComp.lightColor;
              vl.baseColor = Color3.FromHexString(hexColor || '#ffffff');
              this.lightVisual.updateVisualGlow(vl, lightComp, vl.baseColor, this.profilerDisableLocalLights);
          }
      }

      const allSlots = this.lightPool.getAllSlots();
      for (let i = 0; i < allSlots.length; i++) {
          const slot = allSlots[i];
          if (slot.assignedEntityUid) {
              const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
              if (vl) {
                  const tempFirstFrame = this.isFirstFrame;
                  this.isFirstFrame = true;
                  this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, true);
                  this.isFirstFrame = tempFirstFrame;

                  if (slot.sg && vl.isShadowInRange) {
                      const lightComp = vl.entity.light;
                      const lightRange = slot.type === 'directional' ? 50 : (lightComp?.range || 50);
                      this.lightShadows.rebuildShadowRenderList(slot, vl.entity.uid, slot.light.position, lightRange);
                      slot.sg.getShadowMap()?.resetRefreshCounter();
                  }
              }
          }
      }
  }

  public syncLightImmediate(entity: GameEntity, forceUpdate: boolean = false): void {
      if (!this.lightPool.isInitialized) this.prepareAllLights();
      const scene = this.motor3d.getScene();
      const lightComp = entity.light;
      if (!lightComp || !scene) return;

      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const hexColor = isBW ? lightComp.lightColorBW : lightComp.lightColor;
      const baseColor = Color3.FromHexString(hexColor || '#ffffff');

      const vl = this.lightRegistry.registerOrUpdateVirtualLight(entity);
      vl.baseColor = baseColor;
      
      this.spatialScheduler.forceNextEvaluation();
      this.lightDistance.evaluateDistanceAndHysteresis([vl], this.getReferencePosition('AUTO'), 0);

      const isEditorPure = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;
      if (isEditorPure && forceUpdate) {
          vl.currentMultiplier = vl.targetMultiplier;
      }

      this.lightVisual.updateVisualGlow(vl, lightComp, baseColor, this.profilerDisableLocalLights);

      let slot = this.lightPool.findSlotByUid(entity.uid);
      if (!slot && vl.isLightInRange) {
          this.lightAllocation.allocatePoolSlots(this.lightRegistry.getVirtualLights(), this.getReferencePosition('AUTO'), Vector3.Zero(), 0, null);
          slot = this.lightPool.findSlotByUid(entity.uid);
      }

      if (slot) {
          this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, forceUpdate);
          if (forceUpdate && slot.sg && vl.isShadowInRange) {
            const range = slot.type === 'directional' ? 50 : lightComp.range;
            this.lightShadows.rebuildShadowRenderList(slot, entity.uid, slot.light.position, range || 50);
            if (slot.sg.getShadowMap()?.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
                slot.sg.getShadowMap()?.resetRefreshCounter();
            }
          }
      }
  }

  public update(dtMs: number): void {
      const scene = this.motor3d.getScene();
      if (!scene || !this.lightPool.isInitialized) return;

      const mode = this.context.mode();
      const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const lerpSpeed = this.isFirstFrame ? 1.0 : Math.min(1.0, dtMs * 0.005);
      
      const refPos = this.getReferencePosition('AUTO');
      if (dtMs > 0 && !this.isFirstFrame) {
          this.playerVelocity.copyFrom(refPos).subtractInPlace(this.lastRefPos).scaleInPlace(1000 / dtMs);
      } else {
          this.playerVelocity.setAll(0);
      }
      this.lastRefPos.copyFrom(refPos);

      const activeVirtuals = this.lightRegistry.getVirtualLights();

      const spatialEval = this.isFirstFrame || this.spatialScheduler.shouldEvaluate(refPos, dtMs);
      const shouldRebuildShadows = this.forceShadowRebuild || spatialEval;
      this.forceShadowRebuild = false;

      if (spatialEval) {
          let speed = this.playerVelocity.length();
          let moveDir = this.playerVelocity.clone();
          
          if (speed > 0.1) {
              moveDir.normalize();
          } else {
              const cam = isEditorPure ? this.motor3d.getEditorCamera() : (this.ownership.getCamera() || this.motor3d.getEditorCamera());
              if (cam) {
                  moveDir = cam.getDirection(Vector3.Forward());
                  moveDir.y = 0;
                  moveDir.normalize();
              }
          }

          this.lightDistance.evaluateDistanceAndHysteresis(activeVirtuals, refPos, speed);
          
          const selectedMesh = this.context.selectedNode() as AbstractMesh;
          let selectedUid: string | null = null;
          if (selectedMesh) {
            if ((selectedMesh as any).metadata?.entityUid) selectedUid = (selectedMesh as any).metadata.entityUid;
            else {
              const ent = this.entityManager.getEntityByMesh(selectedMesh);
              if (ent) selectedUid = ent.uid;
            }
          }

          const prepareRangeVirtuals = activeVirtuals.filter(vl => vl.entity.light?.enabled !== false && (vl._isInPrepareRange || vl.currentMultiplier > 0.001));
          this.lightAllocation.allocatePoolSlots(prepareRangeVirtuals, refPos, moveDir, speed, selectedUid);
      }

      for(let i = 0; i < activeVirtuals.length; i++) {
          const vl = activeVirtuals[i];
          const lightComp = vl.entity.light;
          if (!lightComp || !vl.entity.view || !lightComp.enabled || !vl.isLightInRange) vl.targetMultiplier = 0;

          const matchedSlot = this.lightPool.findSlotByUid(vl.entity.uid);
          if (matchedSlot && matchedSlot._isNewAssignment) {
              vl.currentMultiplier = vl.targetMultiplier;
          } else {
              const multDiff = Math.abs(vl.targetMultiplier - vl.currentMultiplier);
              if (multDiff > 0.001) {
                  vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * lerpSpeed;
                  if (vl.currentMultiplier < this.LIGHT_DISABLE_THRESHOLD) vl.currentMultiplier = 0;
              } else {
                  vl.currentMultiplier = vl.targetMultiplier;
              }
          }

          const renderDiff = Math.abs(vl.currentMultiplier - (vl._lastRenderedMultiplier ?? -1));
          if (renderDiff > 0.005 || this.isFirstFrame) {
              vl._lastRenderedMultiplier = vl.currentMultiplier;
              const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
              const hexColor = lightComp ? (isBW ? lightComp.lightColorBW : lightComp.lightColor) : '#ffffff';
              vl.baseColor = Color3.FromHexString(hexColor || '#ffffff');
              this.lightVisual.updateVisualGlow(vl, lightComp, vl.baseColor, this.profilerDisableLocalLights);
          }
      }

      let statics = 0;
      let dynamics = 0;

      const allSlots = this.lightPool.getAllSlots();
      for (let i = 0; i < allSlots.length; i++) {
          const slot = allSlots[i];
          
          if (!slot.assignedEntityUid) {
              if (Math.abs(slot.currentIntensity) > 0.0001) {
                  slot.currentIntensity = 0; slot.light.intensity = 0; slot.light.diffuse.set(0, 0, 0);
                  if (slot.type !== 'directional') (slot.light as any).position.set(0, -99999, 0);
                  this.containmentSvc.clearContainment(slot.light as any);
              }
              continue;
          }

          const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
          if (!vl || !vl.entity.light) {
              this.lightPool.releaseSlot(slot, new Set());
              continue;
          }

          this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, shouldRebuildShadows);

          if (slot.sg && vl.isShadowInRange) {
              if (slot.isStaticLight && !slot.hasDynamicCasters) statics++;
              else dynamics++;
          }
      }

      this.shadowCache.setLightDistribution(statics, dynamics);
      this.isFirstFrame = false;
  }

  private syncSlotWithVirtualLight(slot: PoolSlot, vl: VirtualLight, scene: any, isEditorPure: boolean, forceRebuildShadows: boolean = false): void {
      const lightComp = vl.entity.light!;
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          
      if (slot.type !== 'directional') {
          if (Vector3.DistanceSquared(slot.light.position, this._tempPos) > 0.001) {
              slot.light.position.copyFrom(this._tempPos);
          }
      }
      
      if (slot.type === 'spot') {
          (slot.light as any).direction.copyFrom(this._tempDir);
          (slot.light as any).angle = (lightComp.angle || 60) * (Math.PI / 180);
      } else if (slot.type === 'directional') {
          (slot.light as any).direction.copyFrom(this._tempDir);
      }

      if (slot.type !== 'directional') {
          const lightRange = lightComp.range || 50;
          (slot.light as any).range = lightRange;
          slot.light.shadowMaxZ = lightRange;
      }
      
      slot.light.diffuse.copyFrom(vl.baseColor);

      const animatedIntensity = lightComp.renderIntensity ?? lightComp.intensity ?? 1.0;
      let finalIntensity = animatedIntensity * vl.currentMultiplier;
      if (!lightComp.enabled || this.profilerDisableLocalLights) finalIntensity = 0;

      if (Math.abs(slot.currentIntensity - finalIntensity) > 0.001 || this.isFirstFrame) {
          slot.currentIntensity = finalIntensity; 
          slot.light.intensity = finalIntensity;
          
          if (!lightComp.enabled || finalIntensity <= this.LIGHT_DISABLE_THRESHOLD) {
              slot.light.intensity = 0;
          }
      }

      const wantsShadow = vl.isShadowInRange;

      if (slot._isNewAssignment || vl.entity.isDirty || this.isFirstFrame) {
          if (slot.type !== 'directional') {
              this.containmentSvc.applyContainment(slot.light as any, vl.entity, scene);
          }
      }

      if (slot.sg) {
          if (wantsShadow) {
              let listRebuilt = false;
              const distMovedSq = slot.lastShadowRebuildPos ? Vector3.DistanceSquared(slot.lastShadowRebuildPos, slot.light.position) : 9999;
              
              if (slot._isNewAssignment || !slot.sg.getShadowMap()?.renderList?.length || distMovedSq > 4.0 || this.isFirstFrame || vl.entity.isDirty || forceRebuildShadows) {
                  const lightRange = slot.type === 'directional' ? 50 : (lightComp.range || 50);
                  this.lightShadows.rebuildShadowRenderList(slot, vl.entity.uid, slot.light.position, lightRange);
                  if (!slot.lastShadowRebuildPos) slot.lastShadowRebuildPos = Vector3.Zero();
                  slot.lastShadowRebuildPos.copyFrom(slot.light.position);
                  listRebuilt = true;
              }

              this.lightShadows.applyShadowLOD(slot, isEditorPure, this.getReferencePosition('AUTO'));

              let triggerOneShot = listRebuilt; 
              
              if (!triggerOneShot && slot.sg.getShadowMap()?.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
                  if (vl.entity.isDirty || this.isFirstFrame || forceRebuildShadows) {
                      triggerOneShot = true;
                  }
                  
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
          } else {
              if ((slot.sg.getShadowMap()?.renderList?.length ?? 0) > 0) {
                  slot.sg.getShadowMap()!.renderList!.length = 0;
              }
          }
      }
      
      slot._isNewAssignment = false;
  }
}