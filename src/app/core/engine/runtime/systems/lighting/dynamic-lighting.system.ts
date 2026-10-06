// file: src/app/core/engine/runtime/systems/lighting/dynamic-lighting.system.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { Color3, Vector3, AbstractMesh, SpotLight, DirectionalLight, PointLight, Light, Tags } from '@babylonjs/core';
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
import { PerformanceIncidentService } from '../../../telemetry/performance-incident.service';
import { EngineProfilerService } from '../../../telemetry/engine-profiler.service';

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
  private incidentSvc = inject(PerformanceIncidentService);
  private profiler = inject(EngineProfilerService);

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
  private previousActiveSlotsHash = '';

  // Transacción de arrastre en Editor
  private isPlayerDragActive = false;
  private deferredShadowRebuildRequested = false;
  private shadowRebuildQueue: Array<{ slot: PoolSlot; uid: string; range: number }> = [];

  constructor() {
    this.eventBus.events$.subscribe(e => {
      if (e.type === 'RuntimeVisibilityBatchChanged') {
        this.forceShadowRebuild = true;
      }
    });
  }

  public beginPlayerDragTransaction(): void {
    if (this.context.mode() !== GameMode.EDITOR) return;
    this.isPlayerDragActive = true;
    this.deferredShadowRebuildRequested = false;
    this.shadowRebuildQueue = [];
    this.profiler.recordTimelineEvent('LIGHT', 'EDITOR_PLAYER_DRAG_BEGIN', {
      timestamp: performance.now()
    });
  }

  public endPlayerDragTransaction(): void {
    if (!this.isPlayerDragActive) return;
    this.isPlayerDragActive = false;
    this.deferredShadowRebuildRequested = true;
    this.profiler.recordTimelineEvent('LIGHT', 'EDITOR_PLAYER_DRAG_END', {
      timestamp: performance.now()
    });
  }

  public getFastMetrics() {
    let activeSlots = 0;
    let shadowedSlots = 0;
    const slots = this.lightPool.getAllSlots();
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].assignedEntityUid && slots[i].light.isEnabled() && slots[i].currentIntensity > 0) {
        activeSlots++;
        if (slots[i].sg && (slots[i].sg!.getShadowMap()?.renderList?.length || 0) > 0) {
          shadowedSlots++;
        }
      }
    }
    return { activePool: activeSlots, shadowedPool: shadowedSlots };
  }

  public getProfilerMetrics() {
    let activeSlots = 0;
    let shadowedSlots = 0;
    const slotsInfo: { id: string; assigned: boolean; hasSg: boolean; renderListSize: number; tier?: string }[] = [];

    this.lightPool.getAllSlots().forEach(s => {
      const isPhysicallyOn = !!s.assignedEntityUid && s.light.isEnabled() && s.currentIntensity > 0;
      if (isPhysicallyOn) {
        activeSlots++;
        if (s.sg && (s.sg.getShadowMap()?.renderList?.length || 0) > 0) shadowedSlots++;
      }
      slotsInfo.push({
        id: `${s.type}_${s.index}`,
        assigned: isPhysicallyOn,
        hasSg: !!s.sg,
        renderListSize: s.sg ? (s.sg.getShadowMap()?.renderList?.length || 0) : 0,
        tier: s.shadowTier
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

    const actors = this.lightReference.getValidActorEntities();
    actors.forEach(a => {
      if (a.view && !a.view.isDisposed()) {
        a.view.computeWorldMatrix(true);
      }
    });

    const refPos = this.getReferencePosition('AUTO');
    this.lastRefPos.copyFrom(refPos);

    const virtuals = this.lightRegistry.getVirtualLights();
    this.lightDistance.evaluateDistanceAndHysteresis(virtuals, refPos, 0);

    const candidates = virtuals.filter(vl => vl.entity.light?.enabled !== false);
    this.lightAllocation.allocatePoolSlots(candidates, refPos, Vector3.Zero(), 0, null);

    const isEditorPure = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';

    for (let i = 0; i < virtuals.length; i++) {
      const vl = virtuals[i];
      if (vl.isLightInRange) {
        vl.targetMultiplier = 1.0;
        vl.currentMultiplier = 1.0;
        vl._lastRenderedMultiplier = 1.0;
        
        const lightComp = vl.entity.light;
        if (lightComp) {
          const hexColor = isBW ? lightComp.lightColorBW : lightComp.lightColor;
          vl.baseColor = Color3.FromHexString(hexColor || '#ffffff');
          this.lightVisual.updateVisualGlow(vl, lightComp, vl.baseColor, this.profilerDisableLocalLights);
        }
      }
    }

    const allSlots = this.lightPool.getAllSlots();
    for (let i = 0; i < allSlots.length; i++) {
      const slot = allSlots[i];
      if (slot.assignedEntityUid) {
        const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
        if (vl) {
          this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, true, false);
          if (slot.sg && vl.isShadowInRange) {
            const range = slot.type === 'directional' ? 50 : (vl.entity.light?.range || 58);
            this.lightShadows.rebuildShadowRenderList(slot, vl.entity.uid, slot.light.position, range);
            slot.sg.getShadowMap()?.resetRefreshCounter();
            slot.isWarmedUp = true;
          }
        }
      }
    }

    const preparedLights = virtuals.filter(vl => vl.lifecycleStage === 'PREPARED');
    preparedLights.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const range = vl.entity.light?.range || 50;
      const typeStr = vl.entity.type === 'light_spot' ? 'spot' : (vl.entity.type === 'light_directional' ? 'directional' : 'point');
      this.lightShadows.prepareStaticCastersCache(vl.entity.uid, typeStr, this._tempPos, range);
    });
  }

  public start(): void {
    this.isFirstFrame = true;
    this.isPlayerDragActive = false;
    this.deferredShadowRebuildRequested = false;
    this.shadowRebuildQueue = [];

    const actors = this.lightReference.getValidActorEntities();
    actors.forEach(a => {
      if (a.view && !a.view.isDisposed()) {
        a.view.computeWorldMatrix(true);
      }
    });

    const refPos = this.getReferencePosition('AUTO');
    this.lastRefPos.copyFrom(refPos);
    this.playerVelocity.setAll(0);
    this.shadowRebuildCooldownTimer = 0;
    this.previousActiveSlotsHash = '';

    const scene = this.motor3d.getScene();
    if (scene) {
      this.prepareAllLights();
    }
  }

  public stop(): void {
    this.lightPool.resetPools();
    this.lightRegistry.clear();
    this.lightShadows.clearCache();
    this.containmentSvc.clearAllCache();
    this.shadowCache.clearMetrics();
    this.previousActiveSlotsHash = '';
    this.isPlayerDragActive = false;
    this.deferredShadowRebuildRequested = false;
    this.shadowRebuildQueue = [];
  }

  public updateAssignedLightIntensity(uid: string, newIntensity: number): void {
    const slot = this.lightPool.findSlotByUid(uid);
    if (!slot) return;

    const vl = this.lightRegistry.getVirtualLightByUid(uid);
    if (!vl || !vl.entity.light || !vl.entity.light.enabled) return;

    const effective = Math.max(0, newIntensity * vl.currentMultiplier);
    slot.currentIntensity = effective;
    slot.light.intensity = effective;

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const hexColor = isBW ? vl.entity.light.lightColorBW : vl.entity.light.lightColor;
    vl.baseColor = Color3.FromHexString(hexColor || '#ffffff');
    this.lightVisual.updateVisualGlow(vl, vl.entity.light, vl.baseColor, this.profilerDisableLocalLights);
  }

  public async forceWarmup(refPos: Vector3): Promise<void> {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    let actualPos = refPos;
    if (actualPos.lengthSquared() < 0.001) {
      actualPos = this.getReferencePosition('AUTO');
    }

    this.lightPool.initializePool(scene);

    if (this.lightRegistry.getVirtualLights().length === 0) {
      this.lightRegistry.refreshVirtualLightsRegistry();
    }
    if (this.lightShadows.getCastersCacheSize() === 0) {
      this.lightShadows.refreshShadowCastersCache();
    }

    const isEditorPure = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;
    const activeVirtuals = this.lightRegistry.getVirtualLights();

    this.lightDistance.evaluateDistanceAndHysteresis(activeVirtuals, actualPos, 0);

    const candidates = activeVirtuals.filter(vl => vl.entity.light?.enabled !== false);
    this.lightAllocation.allocatePoolSlots(candidates, actualPos, Vector3.Zero(), 0, null);

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      if (vl.isLightInRange) {
        vl.targetMultiplier = 1.0;
        vl.currentMultiplier = 1.0;
      } else {
        vl.currentMultiplier = 0.0;
      }
      vl._lastRenderedMultiplier = vl.currentMultiplier;

      const lightComp = vl.entity.light;
      if (lightComp) {
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
          this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, true, false);
          this.isFirstFrame = tempFirstFrame;

          if (slot.sg && vl.isShadowInRange) {
            const lightComp = vl.entity.light;
            const lightRange = slot.type === 'directional' ? 50 : (lightComp?.range || 58);
            this.lightShadows.rebuildShadowRenderList(slot, vl.entity.uid, slot.light.position, lightRange);
            slot.sg.getShadowMap()?.resetRefreshCounter();
            slot.isWarmedUp = true;
          }
        }
      }
    }

    const backupLights: any[] = [];
    const allSlotsForWarmup = this.lightPool.getAllSlots();
    
    const allCasters = scene.meshes.filter(m => {
        return m.isVisible && m.isEnabled() && m.getTotalVertices() > 0 && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || proxy_collider || light_visual");
    });

    for (let i = 0; i < allSlotsForWarmup.length; i++) {
      const slot = allSlotsForWarmup[i];
      let backupRenderList: AbstractMesh[] | undefined;

      if (slot.sg && slot.sg.getShadowMap()) {
          const sm = slot.sg.getShadowMap()!;
          backupRenderList = sm.renderList ? [...sm.renderList] : [];
          sm.renderList = [...allCasters];
      }

      backupLights.push({
        intensity: slot.light.intensity,
        range: slot.type !== 'directional' ? (slot.light as any).range : undefined,
        renderList: backupRenderList
      });
      
      slot.light.intensity = 0.0001;
      if (slot.type !== 'directional') {
        (slot.light as any).range = 10000; 
      }
    }

    const warmupReport = await this.materialSvc.prewarmMaterials(scene);

    for (let i = 0; i < allSlotsForWarmup.length; i++) {
      const slot = allSlotsForWarmup[i];
      const backup = backupLights[i];
      
      slot.light.intensity = backup.intensity;
      if (slot.type !== 'directional') {
        (slot.light as any).range = backup.range;
      }
      
      if (slot.sg && slot.sg.getShadowMap() && backup.renderList !== undefined) {
          slot.sg.getShadowMap()!.renderList = backup.renderList;
      }
    }

    this.profiler.recordTimelineEvent('SHADER', 'SHADER_WARMUP_COMPLETED', {
      durationMs: warmupReport.durationMs,
      compiledVariants: warmupReport.compiledVariants,
      totalMaterials: warmupReport.totalMaterials,
      success: warmupReport.success
    });
  }

  public syncLightImmediate(entity: GameEntity, forceUpdate: boolean = false): void {
    if (!entity.type.startsWith('light_')) return;
    
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
      vl.spatialState = 'OUTSIDE';
      vl.rejectionReason = 'DISABLED';
      vl.shadowTier = undefined;

      this.lightVisual.updateVisualGlow(vl, lightComp, baseColor, true);

      const slot = this.lightPool.findSlotByUid(entity.uid);
      if (slot) {
        slot.currentIntensity = 0;
        slot.light.intensity = 0;
        if (slot.light.isEnabled()) slot.light.setEnabled(false);
        if (slot.sg && slot.sg.getShadowMap()?.renderList) {
          slot.sg.getShadowMap()!.renderList!.length = 0;
        }
        this.lightPool.forceHardRelease(slot);
      }
      return;
    }

    vl.targetMultiplier = 1.0;
    vl.currentMultiplier = 1.0;
    vl.isLightInRange = true;
    vl._isInPrepareRange = true;

    const isEditorPure = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;
    this.lightVisual.updateVisualGlow(vl, lightComp, baseColor, this.profilerDisableLocalLights);

    const refPos = this.getReferencePosition('AUTO');
    this.lightAllocation.allocatePoolSlots(this.lightRegistry.getVirtualLights(), refPos, Vector3.Zero(), 0, null);
    
    let slot = this.lightPool.findSlotByUid(entity.uid);

    if (!slot) {
      const pool = this.lightPool.getPoolByType(entity.type);
      slot = pool.find(s => !s.assignedEntityUid) || pool[0];
      if (slot) {
        slot.assignedEntityUid = entity.uid;
        slot._isNewAssignment = true;
      }
    }

    if (slot) {
      this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, true, false);
      if (slot.sg && vl.isShadowInRange) {
        const range = slot.type === 'directional' ? 50 : (lightComp.range || 58);
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

    const refPos = this.getReferencePosition('AUTO');
    const playerDelta = Vector3.Distance(refPos, this.lastRefPos);
    const playerMoved = playerDelta > 0.005;

    // Si el usuario está arrastrando al Player en el Editor:
    // Congelamos la reasignación de slots de luz y la reconstrucción pesada de sombras
    if (isEditorPure && this.isPlayerDragActive) {
      this.lastRefPos.copyFrom(refPos);
      this.isFirstFrame = false;

      // Mantener sincronizados los emisivos y posiciones de las luces ya activas sin tocar el pool
      const activeVirtualsDuringDrag = this.lightRegistry.getVirtualLights();
      for (let i = 0; i < activeVirtualsDuringDrag.length; i++) {
        const vl = activeVirtualsDuringDrag[i];
        if (vl.isLightInRange) {
          const slot = this.lightPool.findSlotByUid(vl.entity.uid);
          if (slot) {
            this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, false, false);
          }
        }
      }
      return;
    }

    // Reconciliación presupuestada al finalizar el arrastre del Player
    if (isEditorPure && this.deferredShadowRebuildRequested) {
      this.deferredShadowRebuildRequested = false;
      this.reconcileDeferredAfterDrag(refPos, scene, isEditorPure);
      return;
    }

    // Procesar cola escalonada de sombras si existe trabajo diferido
    if (this.shadowRebuildQueue.length > 0 && this.shadowRebuildCooldownTimer <= 0) {
      const task = this.shadowRebuildQueue.shift()!;
      if (task.slot.assignedEntityUid === task.uid && task.slot.sg) {
        this.lightShadows.rebuildShadowRenderList(task.slot, task.uid, task.slot.light.position, task.range);
        task.slot.sg.getShadowMap()?.resetRefreshCounter();
        this.shadowRebuildCooldownTimer = 16; // 1 rebuild cada frame
      }
    }

    const activeVirtuals = this.lightRegistry.getVirtualLights();
    const anyLightDirty = activeVirtuals.some(v => v.entity.isDirty);
    const anyLightFading = activeVirtuals.some(v => Math.abs(v.targetMultiplier - v.currentMultiplier) > 0.001);

    if (isEditorPure && !this.isFirstFrame) {
      if (!playerMoved && !anyLightDirty && !anyLightFading) {
        return;
      }
    }

    const fadeRate = 1.0 - Math.exp(-4.0 * (dtMs / 1000.0));
    const lerpSpeed = this.isFirstFrame ? 1.0 : Math.min(1.0, isEditorPure ? Math.max(0.65, fadeRate * 2.5) : fadeRate);

    if (dtMs > 0) {
      this.playerVelocity.copyFrom(refPos).subtractInPlace(this.lastRefPos).scaleInPlace(1000 / dtMs);
    } else {
      this.playerVelocity.setAll(0);
    }
    this.lastRefPos.copyFrom(refPos);

    const shouldReevaluateProximity = this.isFirstFrame || isEditorPure || playerMoved;

    if (shouldReevaluateProximity) {
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
      this.lightAllocation.allocatePoolSlots(candidates, refPos, moveDir, speed, null);

      const activeSlotsOnly = this.lightPool.getAllSlots().slice(0, LIGHT_SPATIAL_CONSTANTS.MAX_PHYSICAL_ACTIVE_LIGHTS);
      const currentHash = activeSlotsOnly.map(s => `${s.type}_${s.index}:${s.assignedEntityUid || 'empty'}`).join('|');
      
      if (currentHash !== this.previousActiveSlotsHash) {
        this.profiler.recordTimelineEvent('LIGHT', 'LIGHT_LAYOUT_CHANGED', {
          previousHash: this.previousActiveSlotsHash,
          currentHash
        });
        this.previousActiveSlotsHash = currentHash;
      }

      const preparedLights = activeVirtuals.filter(vl => vl.lifecycleStage === 'PREPARED');
      preparedLights.forEach(vl => {
        this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
        const range = vl.entity.light?.range || 50;
        const typeStr = vl.entity.type === 'light_spot' ? 'spot' : (vl.entity.type === 'light_directional' ? 'directional' : 'point');
        this.lightShadows.prepareStaticCastersCache(vl.entity.uid, typeStr, this._tempPos, range);
      });
    }

    const shouldRebuildShadows = this.forceShadowRebuild;
    this.forceShadowRebuild = false;

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      const lightComp = vl.entity.light;
      if (!lightComp || !vl.entity.view || vl.entity.view.isDisposed() || !lightComp.enabled) {
        vl.targetMultiplier = 0;
      }

      const matchedSlot = this.lightPool.findSlotByUid(vl.entity.uid);
      if (!matchedSlot && !vl.isLightInRange) {
        vl.targetMultiplier = 0;
      }

      let currentLerp = lerpSpeed;
      if (vl.targetMultiplier === 0) {
        currentLerp = Math.min(1.0, currentLerp * 1.5);
      }

      const multDiff = Math.abs(vl.targetMultiplier - vl.currentMultiplier);
      if (multDiff > 0.0005) {
        vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * currentLerp;
        
        if (vl.targetMultiplier === 0 && vl.currentMultiplier < 0.02) {
          vl.currentMultiplier = 0;
        }
      } else {
        vl.currentMultiplier = vl.targetMultiplier;
      }

      if (vl.currentMultiplier === 0 && vl.lifecycleStage === 'FADING_OUT') {
         vl.previousLifecycleStage = vl.lifecycleStage;
         vl.lifecycleStage = vl.isInterior ? 'OUTSIDE' : 'INACTIVE';
      }

      if (matchedSlot && vl.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD && !vl.isLightInRange) {
        this.lightPool.forceHardRelease(matchedSlot);
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
        if (Math.abs(slot.currentIntensity) > 0.0001 || slot.light.isEnabled()) {
          slot.currentIntensity = 0;
          slot.light.intensity = 0;
          if (slot.light.isEnabled()) slot.light.setEnabled(false);
          slot.light.diffuse.set(0, 0, 0);
          slot.light.specular.set(0, 0, 0);
          slot.shadowTier = undefined;
          if (slot.type !== 'directional') (slot.light as any).position.set(0, -99999, 0);
        }
        continue;
      }

      const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
      if (!vl || !vl.entity.light || !vl.entity.light.enabled) {
        this.lightPool.forceHardRelease(slot);
        continue;
      }

      this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, shouldRebuildShadows, playerMoved);

      if (slot.sg && vl.isShadowInRange && slot.light.intensity > 0) {
        if (slot.isStaticLight && !slot.hasDynamicCasters) statics++;
        else dynamics++;
      }
    }

    this.shadowCache.setLightDistribution(statics, dynamics);
    this.isFirstFrame = false;
  }

  private reconcileDeferredAfterDrag(refPos: Vector3, scene: any, isEditorPure: boolean): void {
    const activeVirtuals = this.lightRegistry.getVirtualLights();
    this.lightDistance.evaluateDistanceAndHysteresis(activeVirtuals, refPos, 0);

    const candidates = activeVirtuals.filter(vl => vl.entity.light?.enabled !== false);
    this.lightAllocation.allocatePoolSlots(candidates, refPos, Vector3.Zero(), 0, null);

    const allSlots = this.lightPool.getAllSlots();
    this.shadowRebuildQueue = [];

    for (let i = 0; i < allSlots.length; i++) {
      const slot = allSlots[i];
      if (slot.assignedEntityUid) {
        const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
        if (vl) {
          this.syncSlotWithVirtualLight(slot, vl, scene, isEditorPure, false, false);
          if (slot.sg && vl.isShadowInRange) {
            const range = slot.type === 'directional' ? 50 : (vl.entity.light?.range || 58);
            this.shadowRebuildQueue.push({ slot, uid: vl.entity.uid, range });
          }
        }
      }
    }
  }

  private syncSlotWithVirtualLight(
    slot: PoolSlot, 
    vl: VirtualLight, 
    scene: any, 
    isEditorPure: boolean, 
    forceRebuildShadows: boolean = false,
    playerMoved: boolean = false
  ): void {
    const lightComp = vl.entity.light!;
    this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

    if (slot.type !== 'directional') {
      slot.light.position.copyFrom(this._tempPos);
    }

    if (slot.type === 'spot') {
      const spot = slot.light as SpotLight;
      spot.direction.copyFrom(this._tempDir);
      spot.angle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
      spot.exponent = 1.0;
    } else if (slot.type === 'directional') {
      const dirL = slot.light as DirectionalLight;
      dirL.direction.copyFrom(this._tempDir);
    }

    if (slot.type !== 'directional') {
      const effectiveRange = Math.max(1, lightComp.range || 58);
      (slot.light as any).range = effectiveRange;

      slot.light.shadowMinZ = 0.05;
      slot.light.shadowMaxZ = effectiveRange;

      if (slot.type === 'point') {
        const pLight = slot.light as PointLight;
        pLight.falloffType = PointLight.FALLOFF_STANDARD;
        pLight.radius = 0.20;
      }
    }

    slot.light.diffuse.copyFrom(vl.baseColor);
    slot.light.specular.copyFrom(vl.baseColor);

    const effectiveBase = (lightComp.renderIntensity !== undefined && lightComp.renderIntensity !== null && lightComp.renderIntensity > 0)
      ? lightComp.renderIntensity
      : (lightComp.intensity ?? 1.0);

    let finalIntensity = effectiveBase * vl.currentMultiplier;
    if (!lightComp.enabled || this.profilerDisableLocalLights) finalIntensity = 0;

    slot.currentIntensity = finalIntensity;
    slot.light.intensity = finalIntensity;

    if (finalIntensity > 0.0001) {
      if (!slot.light.isEnabled()) slot.light.setEnabled(true);
    } else {
      if (slot.light.isEnabled()) slot.light.setEnabled(false);
    }

    if (slot._isNewAssignment || vl.entity.isDirty || this.isFirstFrame) {
      if (slot.type !== 'directional') {
        this.containmentSvc.applyContainment(slot.light as any, vl.entity, scene);
      }
    }

    const isFadingOut = vl.targetMultiplier < vl.currentMultiplier;
    const shadowIntensityThreshold = isFadingOut ? 0.15 : 0.01;
    const wantsShadow = vl.isShadowInRange && vl.currentMultiplier > shadowIntensityThreshold && lightComp.enabled && lightComp.castShadows && slot.shadowTier !== 'DISABLED';

    if (slot.sg) {
      const sBias = lightComp.shadowBias ?? 0.0008;
      const sNormalBias = lightComp.shadowNormalBias ?? 0.002;
      const sDarkness = 0.00;

      if (slot.sg.bias !== sBias) slot.sg.bias = sBias;
      if (slot.sg.normalBias !== sNormalBias) slot.sg.normalBias = sNormalBias;
      if (slot.sg.getDarkness() !== sDarkness) slot.sg.setDarkness(sDarkness);

      if (wantsShadow) {
        let listRebuilt = false;
        const renderListEmpty = !slot.sg.getShadowMap()?.renderList?.length;
        const distMovedSq = slot.lastShadowRebuildPos 
          ? Vector3.DistanceSquared(slot.lastShadowRebuildPos, slot.light.position) 
          : 9999;

        const shouldExecuteRebuild = (!slot.isWarmedUp && (slot._isNewAssignment || renderListEmpty)) || distMovedSq > 1.0 || forceRebuildShadows;

        // Si estamos en drag en el Editor, no reconstruimos la lista pesada de casters en cada movimiento
        if (shouldExecuteRebuild && (!isEditorPure || !this.isPlayerDragActive)) {
          const lightRange = slot.type === 'directional' ? 50 : (slot.light as any).range || 58;
          this.lightShadows.rebuildShadowRenderList(slot, vl.entity.uid, slot.light.position, lightRange);
          if (!slot.lastShadowRebuildPos) slot.lastShadowRebuildPos = Vector3.Zero();
          slot.lastShadowRebuildPos.copyFrom(slot.light.position);
          listRebuilt = true;
          slot.isWarmedUp = true;
          this.shadowRebuildCooldownTimer = 100;
        }

        const actors = this.lightReference.getValidActorEntities();
        const lightRange = slot.type === 'directional' ? 50 : (slot.light as any).range || 58;
        let dynamicCasterChanged = false;

        for (let a = 0; a < actors.length; a++) {
          const actor = actors[a];
          const actorPos = this.lightReference.getActorWorldPosition(actor, new Vector3());
          const distToLight = Vector3.Distance(actorPos, slot.light.position);

          let actorShouldCastShadow = false;
          if (vl.isInterior && vl.interiorActivationMode !== 'DISTANCE') {
            actorShouldCastShadow = (vl.spatialState === 'INSIDE' || vl.spatialState === 'PRE_ENTRY' || vl.spatialState === 'PRE_EXIT') && distToLight <= (lightRange + 8.0);
          } else {
            actorShouldCastShadow = distToLight <= (lightRange + 4.0);
          }

          const changed = this.lightShadows.syncDynamicActorInSlot(slot, actor, slot.light.position, lightRange, actorShouldCastShadow);
          if (changed) {
            dynamicCasterChanged = true;
          }
        }

        this.lightShadows.applyShadowLOD(slot, isEditorPure, this.getReferencePosition('AUTO'), playerMoved);

        if (listRebuilt || dynamicCasterChanged) {
          slot.sg.getShadowMap()?.resetRefreshCounter();
          this.shadowCache.recordInvalidation();
        }
      } else {
        if ((slot.sg.getShadowMap()?.renderList?.length ?? 0) > 0) {
          slot.sg.getShadowMap()!.renderList!.length = 0;
          slot.dynamicCastersRegistered?.clear();
          slot.hasDynamicCasters = false;
        }
      }
    }

    slot._isNewAssignment = false;
  }
}