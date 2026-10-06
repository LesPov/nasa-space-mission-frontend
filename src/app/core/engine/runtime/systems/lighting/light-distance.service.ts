// file: src/app/core/engine/runtime/systems/lighting/light-distance.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { VirtualLight, LightLifecycleStage, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { LightTransformService } from './light-transform.service';
import { LightReferenceService } from './light-reference.service';
import { LightAttenuationCurve } from './light-attenuation-curve';
import { LightContainmentService } from './light-containment.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { EngineProfilerService } from '../../../telemetry/engine-profiler.service';
import { GameMode } from '../../../session/game-mode.model';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';
import { SpatialRelevanceHubService } from '../../../spatial/spatial-relevance-hub.service';

@Injectable({ providedIn: 'root' })
export class LightDistanceService {
  private context = inject(GameContextService);
  private lightTransform = inject(LightTransformService);
  private referenceSvc = inject(LightReferenceService);
  private containmentSvc = inject(LightContainmentService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private profiler = inject(EngineProfilerService);
  private spatialGroups = inject(SpatialStreamingGroupService);
  private spatialHub = inject(SpatialRelevanceHubService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public evaluateDistanceAndHysteresis(activeVirtuals: VirtualLight[], baseRefPos: Vector3, speed: number): void {
    const scene = this.motor3d.getScene();
    const mode = this.context.mode();
    const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    this.profiler.recordDistanceEvaluation('LightDistanceService', activeVirtuals.length);
    const validActors = this.referenceSvc.getValidActorEntities();
    const nowTimeStr = new Date().toLocaleTimeString();

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      const lightComp = vl.entity.light;

      if (!lightComp || !vl.entity.view || !lightComp.enabled) {
        this.transitionState(vl, 'INACTIVE', nowTimeStr, 'DISABLED', 'Luz desactivada en configuración');
        vl.isLightInRange = false;
        vl.isShadowInRange = false;
        vl.targetMultiplier = 0;
        vl._isInPrepareRange = false;
        vl.closestActorName = 'Inactiva';
        vl.insideVolume = false;
        vl.inPreEntryZone = false;
        vl.inPreExitZone = false;
        vl.spatialState = 'OUTSIDE';
        vl.lastEvaluatedDistance = 99999;
        vl.centerDistance = 99999;
        vl.boundsDistance = 99999;
        vl.effectiveDistance = 99999;
        vl.shadowTier = undefined;
        continue;
      }

      const wasInRange = vl.isLightInRange;
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

      let actorWorldPos: Vector3;
      if (validActors.length > 0) {
        actorWorldPos = this.referenceSvc.getActorWorldPosition(validActors[0], new Vector3());
        vl.closestActorName = validActors[0].name;
      } else {
        actorWorldPos = baseRefPos;
        vl.closestActorName = 'Referencia Base';
      }

      // En el Editor: la distancia siempre es con respecto al Player o entidad actor, nunca a la cámara libre del visor
      const hubDist = this.spatialHub.getDistanceToPlayer(vl.entity.uid);
      const hubDistSq = this.spatialHub.getDistanceSquaredToPlayer(vl.entity.uid);
      const centerDist = hubDist !== Number.MAX_VALUE ? hubDist : Vector3.Distance(actorWorldPos, this._tempPos);
      
      vl.centerDistance = parseFloat(centerDist.toFixed(2));
      vl.boundsDistance = parseFloat(centerDist.toFixed(2));
      vl.distSq = hubDistSq !== Number.MAX_VALUE ? hubDistSq : (centerDist * centerDist);
      vl.lastDistanceUpdateTimestamp = nowTimeStr;

      const isInterior = lightComp.containmentMode === 'INTERIOR';
      vl.isInterior = isInterior;
      vl.interiorActivationMode = lightComp.interiorActivationMode || 'VOLUME';

      const isModelPreEntryMode = isInterior && lightComp.preEntryEnabled && lightComp.interiorActivationMode !== 'DISTANCE';
      const container = (isInterior && scene) ? this.containmentSvc.resolveContainerEntity(vl.entity, scene) : null;
      vl.containerName = container ? container.name : undefined;

      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);
      const isGroupPreparedOrBetter = Boolean(
        group && (
          group.state === 'ACTIVE' || 
          group.state === 'PREACTIVATING' || 
          group.state === 'PREPARED' ||
          group.isPredictedTarget
        )
      );

      // =========================================================================
      // MODO INTERIOR + CONTENCIÓN EN MODELO
      // =========================================================================
      if (isModelPreEntryMode) {
        if (!container || !container.view || container.view.isDisposed()) {
          vl.spatialState = 'OUTSIDE';
          vl.insideVolume = false;
          vl.inPreEntryZone = false;
          vl.inPreExitZone = false;
          vl.targetMultiplier = 0.0;
          vl.isLightInRange = false;
          vl.isShadowInRange = false;
          vl._isInPrepareRange = false;
          vl.effectiveDistance = vl.centerDistance;
          vl.lastEvaluatedDistance = vl.centerDistance;
          vl.containmentSource = 'AABB_FALLBACK';
          this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'CONTAINER_NOT_FOUND', 'Contenedor no resuelto');
          continue;
        }

        const preDist = Math.max(16.0, lightComp.preEntryDistance ?? 16.0);
        const contResult = this.containmentSvc.evaluateModelContainment(actorWorldPos, container, preDist, wasInRange);

        vl.spatialState = contResult.spatialState;
        vl.insideVolume = contResult.inside;
        vl.inPreEntryZone = contResult.preEntry;
        vl.inPreExitZone = contResult.preExit;
        vl.distanceToBoundary = parseFloat(contResult.distanceToBoundary.toFixed(2));
        vl.containmentSource = contResult.source;

        vl.effectiveDistance = vl.centerDistance;
        vl.lastEvaluatedDistance = vl.centerDistance;

        const maxKeepAliveExitDistance = Math.min(
          LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_MAX_DISTANCE,
          Math.max(preDist + 16.0, preDist * LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_DISTANCE_MULTIPLIER)
        );

        vl._isInPrepareRange = Boolean(
          isGroupPreparedOrBetter || (contResult.distanceToBoundary <= (preDist + 20.0))
        );

        if (contResult.spatialState === 'INSIDE') {
          vl.targetMultiplier = 1.0;
          vl.isLightInRange = true;
          this.evaluateStateAndDecision(vl, 0, 0, preDist, nowTimeStr, `INSIDE (${contResult.source})`);
        } else if (contResult.spatialState === 'PRE_ENTRY') {
          vl.targetMultiplier = LightAttenuationCurve.calculate(contResult.distanceToBoundary, 0, preDist);
          vl.isLightInRange = vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          this.evaluateStateAndDecision(vl, contResult.distanceToBoundary, 0, preDist, nowTimeStr, `PRE-ENTRADA (${contResult.source})`);
        } else if (contResult.spatialState === 'PRE_EXIT') {
          const holdDistance = preDist + LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_HOLD_MARGIN;

          if (contResult.distanceToBoundary <= holdDistance) {
            vl.targetMultiplier = 1.0;
          } else {
            vl.targetMultiplier = LightAttenuationCurve.calculate(
              contResult.distanceToBoundary, 
              holdDistance, 
              maxKeepAliveExitDistance
            );
          }

          vl.isLightInRange = vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          this.evaluateStateAndDecision(vl, contResult.distanceToBoundary, holdDistance, maxKeepAliveExitDistance, nowTimeStr, `PRE-SALIDA / KEEP-ALIVE (${contResult.source})`);
        } else {
          vl.targetMultiplier = 0.0;
          if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
            vl.isLightInRange = true;
            this.transitionState(vl, 'FADING_OUT', nowTimeStr, undefined, `FADING OUT RETENTION (${contResult.source})`);
          } else {
            vl.isLightInRange = false;
            this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'OUTSIDE_INTERIOR_VOLUME', `Fuera de volumen (${contResult.source})`);
          }
        }

        if (lightComp.castShadows) {
          const syncShadow = lightComp.linkShadowPreEntryToLightPreEntry !== false;
          const shadowPreDist = syncShadow ? preDist : Math.max(preDist, lightComp.shadowPreEntryDistance ?? preDist);
          const shadowExitMargin = shadowPreDist + LIGHT_SPATIAL_CONSTANTS.INTERIOR_SHADOW_EXIT_MARGIN;
          
          const inShadowZone = Boolean(
            contResult.spatialState === 'INSIDE' || 
            (contResult.spatialState === 'PRE_ENTRY' && contResult.distanceToBoundary <= shadowPreDist) ||
            (contResult.spatialState === 'PRE_EXIT' && contResult.distanceToBoundary <= shadowExitMargin)
          );

          vl.isShadowInRange = inShadowZone;
        } else {
          vl.isShadowInRange = false;
        }

      } else {
        // =========================================================================
        // MODO RADIAL ESTÁNDAR (LUCES EXTERIORES)
        // =========================================================================
        vl.spatialState = undefined;
        vl.containmentSource = undefined;
        vl.inPreExitZone = false;
        vl.effectiveDistance = vl.centerDistance;
        vl.lastEvaluatedDistance = vl.centerDistance;

        const configuredActivation = lightComp.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS;
        const configuredDeactivation = lightComp.deactivationDistance ?? (configuredActivation + 8.0);
        
        const rActivation = Math.max(1.0, configuredActivation);
        const rDeactivation = Math.max(rActivation + 2.0, configuredDeactivation);
        
        const rPrepare = isGroupPreparedOrBetter ? (rDeactivation + 35.0) : (rDeactivation + 20.0);

        this.applyStandardProximity(vl, centerDist, rActivation, rDeactivation, rPrepare, wasInRange, nowTimeStr);

        if (vl.isLightInRange && lightComp.castShadows && lightComp.distanceShadowsEnabled !== false) {
          const shadowAct = Math.max(rActivation, lightComp.shadowActivationDistance ?? rActivation);
          const shadowDeact = Math.max(rDeactivation, lightComp.shadowDeactivationDistance ?? rDeactivation);
          
          vl.isShadowInRange = (wasInRange || vl.currentMultiplier > 0.05) ? centerDist <= shadowDeact : centerDist <= shadowAct;
        } else {
          vl.isShadowInRange = false;
        }
      }
    }
  }

  private applyStandardProximity(
    vl: VirtualLight, 
    dist: number, 
    rActivation: number, 
    rDeactivation: number, 
    rPrepare: number, 
    wasInRange: boolean,
    timestamp: string
  ): void {
    vl._isInPrepareRange = dist <= rPrepare;
    const currentLimit = wasInRange ? rDeactivation : rActivation;

    vl.targetMultiplier = LightAttenuationCurve.calculate(dist, rActivation * 0.8, rDeactivation);

    if (dist <= currentLimit && vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
      vl.isLightInRange = true;
      this.evaluateStateAndDecision(vl, dist, rActivation, rDeactivation, timestamp, 'PROXIMIDAD RADIAL');
    } else {
      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        vl.isLightInRange = true;
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, 'FADING OUT CONTINUO');
      } else {
        vl.isLightInRange = false;
        
        let rejectionR = undefined;
        if (dist > rDeactivation) rejectionR = 'OUT_OF_EFFECTIVE_RANGE';
        
        this.transitionState(vl, dist > rDeactivation ? 'OUTSIDE' : 'INACTIVE', timestamp, rejectionR, 'Fuera de rango radial');
      }
    }
  }

  private evaluateStateAndDecision(
    vl: VirtualLight, 
    dist: number, 
    rAct: number, 
    rDeact: number, 
    timestamp: string, 
    contextMsg: string
  ): void {
    if (vl.targetMultiplier >= 0.98) {
      this.transitionState(vl, 'ACTIVE', timestamp, undefined, `ACTIVE (${contextMsg})`);
    } else if (vl.targetMultiplier > 0.01) {
      if (vl.targetMultiplier > vl.currentMultiplier) {
        this.transitionState(vl, 'FADING_IN', timestamp, undefined, `FADING IN (${contextMsg})`);
      } else if (vl.targetMultiplier < vl.currentMultiplier) {
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, `FADING OUT (${contextMsg})`);
      } else {
        this.transitionState(vl, 'ACTIVE', timestamp, undefined, `PARTIAL ACTIVE (${contextMsg})`);
      }
    } else {
      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, `FADING OUT (${contextMsg})`);
      } else {
        this.transitionState(vl, 'INACTIVE', timestamp, 'INTENSITY_NEAR_ZERO', `NEAR ZERO (${contextMsg})`);
      }
    }
  }

  private transitionState(
    vl: VirtualLight, 
    newState: LightLifecycleStage, 
    timestamp: string, 
    rejectionReason?: string, 
    decisionText: string = ''
  ): void {
    if (vl.lifecycleStage !== newState) {
      vl.previousLifecycleStage = vl.lifecycleStage;
      vl.lifecycleStage = newState;
      vl.lastStateChangeTimestamp = timestamp;
    }
    vl.rejectionReason = rejectionReason;
    vl.decisionText = decisionText;
  }
}