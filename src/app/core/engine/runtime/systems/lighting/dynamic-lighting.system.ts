// file: src/app/core/engine/runtime/systems/lighting/dynamic-lighting.system.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { Color3, Vector3, AbstractMesh, RenderTargetTexture, SpotLight, DirectionalLight } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { GameEntity } from '../../../entities/game.entity';
import { LightContainmentService } from './light-containment.service';
import { GameMode } from '../../../session/game-mode.model';
import { ShadowCache } from '../../shadows/shadow-cache.service';
import { CoreSceneMaterialService } from '../../../scene/utils/core-scene-material.service';

import { LightRegistryService } from './light-registry.service';
import { LightTransformService } from './light-transform.service';
import { LightVisualService } from './light-visual.service';
import { LightReferenceService } from './light-reference.service';
import { LightShadowService } from './light-shadow.service';
import { LightPoolService } from './light-pool.service';
import { LightDistanceService } from './light-distance.service';
import { LightAllocationService } from './light-allocation.service';
import { PoolSlot, VirtualLight, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { GameEventBusService } from '../../../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';

  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private containmentSvc = inject(LightContainmentService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private entityManager = inject(EntityManagerService);
  private shadowCache = inject(ShadowCache);
  private eventBus = inject(GameEventBusService);
  private materialSvc = inject(CoreSceneMaterialService);

  private lightRegistry = inject(LightRegistryService);
  private lightTransform = inject(LightTransformService);
  private lightVisual = inject(LightVisualService);
  private lightReference = inject(LightReferenceService);
  private lightShadows = inject(LightShadowService);
  private lightPool = inject(LightPoolService);
  private lightDistance = inject(LightDistanceService);
  private lightAllocation = inject(LightAllocationService);

  private isFirstFrame = true;
  private lastRefPos = Vector3.Zero();
  private playerVelocity = Vector3.Zero();
  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public profilerDisableLocalLights = false;
  private forceShadowRebuild = false;
  private shadowRebuildCooldownTimer = 0;

  // Throttling en modo Editor para suprimir el 84% de CPU en IDLE
  private editorEvalTimer = 0;
  private lastSelectedUid: string | null = null;

  public staleDistanceWarnings = 0;
  public staleStateWarnings = 0;

  constructor() {
    this.eventBus.events$.subscribe(e => {
      if (e.type === 'RuntimeVisibilityBatchChanged') {
        this.forceShadowRebuild = true;
      }
    });
  }

  public getProfilerMetrics() {
    let activeSlots = 0;
    let shadowedSlots = 0;
    const slotsInfo: { id: string; assigned: boolean; hasSg: boolean; renderListSize: number }[] = [];

    this.lightPool.getAllSlots().forEach(s => {
      if (s.assignedEntityUid) {
        activeSlots++;
        if (s.sg && (s.sg.getShadowMap()?.renderList?.length || 0) > 0) shadowedSlots++;
      }
      slotsInfo.push({
        id: `${s.type}_${s.index}`,
        assigned: !!s.assignedEntityUid,
        hasSg: !!s.sg,
        renderListSize: s.sg ? (s.sg.getShadowMap()?.renderList?.length || 0) : 0
      });
    });

    return {
      totalVirtual: this.lightRegistry.getVirtualLights().length,
      activePool: activeSlots,
      shadowedPool: shadowedSlots,
      slots: slotsInfo,
      castersCacheSize: this.lightShadows.getCastersCacheSize()
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

    this.lightPool.initializePool(scene);
    this.lightPool.resetPools();

    this.lightRegistry.clear();
    this.lightShadows.clearCache();
    this.containmentSvc.clearAllCache();

    this.lightShadows.refreshShadowCastersCache();
    this.lightRegistry.refreshVirtualLightsRegistry();

    const refPos = this.getReferencePosition('PLAYER');
    this.lightDistance.evaluateDistanceAndHysteresis(this.lightRegistry.getVirtualLights(), refPos, 0);
    this.lightAllocation.allocatePoolSlots(this.lightRegistry.getVirtualLights(), refPos, Vector3.Zero(), 0, null);
  }

  public start(): void {
    this.isFirstFrame = true;
    this.lastRefPos.copyFrom(this.getReferencePosition('PLAYER'));
    this.playerVelocity.setAll(0);
    this.shadowRebuildCooldownTimer = 0;
    this.editorEvalTimer = 9999;
    this.lastSelectedUid = null;
    this.staleDistanceWarnings = 0;
    this.staleStateWarnings = 0;

    const scene = this.motor3d.getScene();
    if (scene) {
      this.lightPool.initializePool(scene);
      this.lightPool.resetPools();
      this.lightShadows.refreshShadowCastersCache();
      this.lightRegistry.refreshVirtualLightsRegistry();
      
      const refPos = this.getReferencePosition('PLAYER');
      this.lightDistance.evaluateDistanceAndHysteresis(this.lightRegistry.getVirtualLights(), refPos, 0);
    }
  }

  public stop(): void {
    this.lightPool.resetPools();
    this.lightRegistry.clear();
    this.lightShadows.clearCache();
    this.containmentSvc.clearAllCache();
    this.shadowCache.clearMetrics();
  }

  public async forceWarmup(refPos: Vector3): Promise<void> {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    this.lightPool.initializePool(scene);

    if (this.lightRegistry.getVirtualLights().length === 0) {
      this.lightRegistry.refreshVirtualLightsRegistry();
    }
    if (this.lightShadows.getCastersCacheSize() === 0) {
      this.lightShadows.refreshShadowCastersCache();
    }

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

    const candidates = activeVirtuals.filter(vl => vl.entity.light?.enabled !== false);
    this.lightAllocation.allocatePoolSlots(candidates, refPos, Vector3.Zero(), 0, selectedUid);

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

    await this.materialSvc.prewarmMaterials(scene);
  }

  public syncLightImmediate(entity: GameEntity, forceUpdate: boolean = false): void {
    const scene = this.motor3d.getScene();
    const lightComp = entity.light;
    if (!lightComp || !scene) return;

    this.lightPool.initializePool(scene);

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const hexColor = isBW ? lightComp.lightColorBW : lightComp.lightColor;
    const baseColor = Color3.FromHexString(hexColor || '#ffffff');

    const vl = this.lightRegistry.registerOrUpdateVirtualLight(entity);
    vl.baseColor = baseColor;

    if (!lightComp.enabled) {
      vl.targetMultiplier = 0.0;
      vl.currentMultiplier = 0.0;
      vl.isLightInRange = false;
      vl.isShadowInRange = false;
      vl._lastRenderedMultiplier = 0.0;
      vl.lifecycleStage = 'INACTIVE';
      vl.rejectionReason = 'DISABLED';

      this.lightVisual.updateVisualGlow(vl, lightComp, baseColor, true);

      const slot = this.lightPool.findSlotByUid(entity.uid);
      if (slot) {
        slot.currentIntensity = 0;
        slot.light.intensity = 0;
        if (slot.sg && slot.sg.getShadowMap()?.renderList) {
          slot.sg.getShadowMap()!.renderList!.length = 0;
        }
        this.lightPool.releaseSlot(slot, new Set());
      }
      return;
    }

    const refPos = this.getReferencePosition('PLAYER');
    this.lightDistance.evaluateDistanceAndHysteresis([vl], refPos, 0);

    const isEditorPure = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;
    if (forceUpdate) {
      vl.currentMultiplier = vl.targetMultiplier;
    }

    this.lightVisual.updateVisualGlow(vl, lightComp, baseColor, this.profilerDisableLocalLights);
    this.lightAllocation.allocatePoolSlots(this.lightRegistry.getVirtualLights(), refPos, Vector3.Zero(), 0, entity.uid);
    const slot = this.lightPool.findSlotByUid(entity.uid);

    if (slot) {
      this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, forceUpdate);
      if (forceUpdate && slot.sg && vl.isShadowInRange) {
        const range = slot.type === 'directional' ? 50 : (lightComp.range || 50);
        this.lightShadows.rebuildShadowRenderList(slot, entity.uid, slot.light.position, range);
        slot.sg.getShadowMap()?.resetRefreshCounter();
      }
    }
  }

  public update(dtMs: number): void {
    const scene = this.motor3d.getScene();
    if (!scene || !this.lightPool.isInitialized) return;

    if (this.shadowRebuildCooldownTimer > 0) {
      this.shadowRebuildCooldownTimer -= dtMs;
    }

    const mode = this.context.mode();
    const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
    const lerpSpeed = this.isFirstFrame ? 1.0 : Math.min(1.0, (dtMs / 16.66) * 0.22);
    const activeVirtuals = this.lightRegistry.getVirtualLights();

    const refPos = this.getReferencePosition('PLAYER');
    const playerDelta = Vector3.Distance(refPos, this.lastRefPos);

    if (dtMs > 0) {
      this.playerVelocity.copyFrom(refPos).subtractInPlace(this.lastRefPos).scaleInPlace(1000 / dtMs);
    } else {
      this.playerVelocity.setAll(0);
    }
    this.lastRefPos.copyFrom(refPos);

    const selectedMesh = this.context.selectedNode() as AbstractMesh;
    let selectedUid: string | null = null;
    if (selectedMesh) {
      if ((selectedMesh as any).metadata?.entityUid) selectedUid = (selectedMesh as any).metadata.entityUid;
      else {
        const ent = this.entityManager.getEntityByMesh(selectedMesh);
        if (ent) selectedUid = ent.uid;
      }
    }
    const selectionChanged = selectedUid !== this.lastSelectedUid;
    this.lastSelectedUid = selectedUid;

    const anyEntityDirty = activeVirtuals.some(v => v.entity.isDirty);

    this.editorEvalTimer += dtMs;
    const editorNeedsEval = isEditorPure && (this.editorEvalTimer >= 200 || selectionChanged || anyEntityDirty || playerDelta > 0.05);
    const gameplayNeedsEval = !isEditorPure && (playerDelta > 0.015 || this.editorEvalTimer >= 80);

    const shouldReevaluateProximity = this.isFirstFrame || editorNeedsEval || gameplayNeedsEval;

    if (shouldReevaluateProximity) {
      this.editorEvalTimer = 0;
      const speed = this.playerVelocity.length();
      let moveDir = this.playerVelocity.clone();
      if (speed > 0.1) {
        moveDir.normalize();
      } else {
        const cam = this.ownership.getCamera() || this.motor3d.getEditorCamera();
        if (cam) {
          moveDir = cam.getDirection(Vector3.Forward());
          moveDir.y = 0;
          moveDir.normalize();
        }
      }

      this.lightDistance.evaluateDistanceAndHysteresis(activeVirtuals, refPos, speed);

      const candidates = activeVirtuals.filter(vl => vl.entity.light?.enabled !== false);
      this.lightAllocation.allocatePoolSlots(candidates, refPos, moveDir, speed, selectedUid);
    }

    const shouldRebuildShadows = this.forceShadowRebuild || (!isEditorPure && this.shadowRebuildCooldownTimer <= 0 && playerDelta > 0.5);
    this.forceShadowRebuild = false;

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      const lightComp = vl.entity.light;
      if (!lightComp || !vl.entity.view || vl.entity.view.isDisposed() || !lightComp.enabled) {
        vl.targetMultiplier = 0;
      }

      const matchedSlot = this.lightPool.findSlotByUid(vl.entity.uid);
      if (!matchedSlot) {
        vl.targetMultiplier = 0;
      }

      const multDiff = Math.abs(vl.targetMultiplier - vl.currentMultiplier);
      if (multDiff > 0.001) {
        vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * lerpSpeed;
        if (vl.currentMultiplier < LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          vl.currentMultiplier = 0;
        }
      } else {
        vl.currentMultiplier = vl.targetMultiplier;
      }

      if (matchedSlot && vl.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD && !vl.isLightInRange) {
        this.lightPool.releaseSlot(matchedSlot, new Set());
      }

      const renderDiff = Math.abs(vl.currentMultiplier - (vl._lastRenderedMultiplier ?? -1));
      if (renderDiff > 0.002 || this.isFirstFrame || vl.entity.isDirty) {
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
          slot.currentIntensity = 0;
          slot.light.intensity = 0;
          slot.light.diffuse.set(0, 0, 0);
          slot.light.specular.set(0, 0, 0);
          if (slot.type !== 'directional') (slot.light as any).position.set(0, -99999, 0);
        }
        continue;
      }

      const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
      if (!vl || !vl.entity.light || !vl.entity.light.enabled) {
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

  private syncSlotWithVirtualLight(
    slot: PoolSlot, 
    vl: VirtualLight, 
    scene: any, 
    isEditorPure: boolean, 
    forceRebuildShadows: boolean = false
  ): void {
    const lightComp = vl.entity.light!;
    this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

    if (slot.type !== 'directional') {
      if (Vector3.DistanceSquared(slot.light.position, this._tempPos) > 0.0001) {
        slot.light.position.copyFrom(this._tempPos);
      }
    }

    if (slot.type === 'spot') {
      const spot = slot.light as SpotLight;
      if (Vector3.DistanceSquared(spot.direction, this._tempDir) > 0.0001) {
        spot.direction.copyFrom(this._tempDir);
      }
      const targetAngle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
      if (Math.abs(spot.angle - targetAngle) > 0.001) {
        spot.angle = targetAngle;
      }
    } else if (slot.type === 'directional') {
      const dirL = slot.light as DirectionalLight;
      if (Vector3.DistanceSquared(dirL.direction, this._tempDir) > 0.0001) {
        dirL.direction.copyFrom(this._tempDir);
      }
    }

    if (slot.type !== 'directional') {
      const lightRange = lightComp.range || 50;
      if ((slot.light as any).range !== lightRange) {
        (slot.light as any).range = lightRange;
        slot.light.shadowMinZ = 0.05;
        slot.light.shadowMaxZ = lightRange;
      }
    }

    if (!slot.light.diffuse.equals(vl.baseColor)) {
      slot.light.diffuse.copyFrom(vl.baseColor);
    }

    const effectiveBase = (lightComp.renderIntensity !== undefined && lightComp.renderIntensity !== null)
      ? lightComp.renderIntensity
      : (lightComp.intensity ?? 1.0);

    let finalIntensity = effectiveBase * vl.currentMultiplier;
    if (!lightComp.enabled || this.profilerDisableLocalLights) finalIntensity = 0;

    if (Math.abs(slot.currentIntensity - finalIntensity) > 0.0005 || this.isFirstFrame || vl.entity.isDirty) {
      slot.currentIntensity = finalIntensity;
      slot.light.intensity = finalIntensity;

      if (!lightComp.enabled || finalIntensity <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        slot.light.intensity = 0;
      }
    }

    if (slot._isNewAssignment || vl.entity.isDirty || this.isFirstFrame) {
      if (slot.type !== 'directional') {
        const curLight = slot.light as any;
        const targetMode = vl.entity.light?.containmentMode || 'GLOBAL';
        const targetContainerUid = vl.entity.light?.containerEntityUid || '';
        const targetDescOnly = vl.entity.light?.affectDescendantsOnly ?? false;
        const targetStamp = `${targetMode}_${targetContainerUid}_${vl.entity.uid}_${targetDescOnly}`;

        if (curLight._containmentAppliedStamp !== targetStamp || vl.entity.isDirty || this.isFirstFrame) {
          this.containmentSvc.applyContainment(slot.light as any, vl.entity, scene);
        }
      }
    }

    const wantsShadow = vl.isShadowInRange && vl.currentMultiplier > 0.02 && lightComp.enabled;

    if (slot.sg) {
      if (wantsShadow) {
        let listRebuilt = false;
        const distMovedSq = slot.lastShadowRebuildPos 
          ? Vector3.DistanceSquared(slot.lastShadowRebuildPos, slot.light.position) 
          : 9999;

        if (slot._isNewAssignment || !slot.sg.getShadowMap()?.renderList?.length || distMovedSq > 4.0 || forceRebuildShadows) {
          const lightRange = slot.type === 'directional' ? 50 : (lightComp.range || 50);
          this.lightShadows.rebuildShadowRenderList(slot, vl.entity.uid, slot.light.position, lightRange);
          if (!slot.lastShadowRebuildPos) slot.lastShadowRebuildPos = Vector3.Zero();
          slot.lastShadowRebuildPos.copyFrom(slot.light.position);
          listRebuilt = true;
          this.shadowRebuildCooldownTimer = 500;
        }

        this.lightShadows.applyShadowLOD(slot, isEditorPure, this.getReferencePosition('PLAYER'));

        if (listRebuilt || slot.sg.getShadowMap()?.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
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