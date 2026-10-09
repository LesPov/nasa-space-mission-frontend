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
    this.profiler.recordDistanceEvaluation('LightDistanceService', activeVirtuals.length);
    const validActors = this.referenceSvc.getValidActorEntities();
    const nowTimeStr = new Date().toLocaleTimeString();

    const activeGroupId = this.spatialGroups.getActiveGroupId();

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      const lightComp = vl.entity.light;

      if (!lightComp || !vl.entity.view || !lightComp.enabled) {
        this.transitionState(vl, 'INACTIVE', nowTimeStr, 'DISABLED', 'Desactivada');
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
        vl.effectiveDistance = 99999;
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

      const hubDist = this.spatialHub.getDistanceToPlayer(vl.entity.uid);
      const centerDist = hubDist !== Number.MAX_VALUE ? hubDist : Vector3.Distance(actorWorldPos, this._tempPos);
      
      vl.centerDistance = parseFloat(centerDist.toFixed(2));
      vl.effectiveDistance = vl.centerDistance;
      vl.lastEvaluatedDistance = vl.centerDistance;
      vl.distSq = centerDist * centerDist;
      vl.lastDistanceUpdateTimestamp = nowTimeStr;

      const isInterior = lightComp.containmentMode === 'INTERIOR';
      vl.isInterior = isInterior;
      vl.interiorActivationMode = lightComp.interiorActivationMode || 'VOLUME';

      const isModelPreEntryMode = isInterior && lightComp.preEntryEnabled && lightComp.interiorActivationMode !== 'DISTANCE';
      const container = (isInterior && scene) ? this.containmentSvc.resolveContainerEntity(vl.entity, scene) : null;
      vl.containerName = container ? container.name : undefined;

      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);
      vl.corridorZoneName = group ? group.name : undefined;

      const hopDistance = (activeGroupId && group) ? this.spatialGroups.getHopDistance(activeGroupId, group.id) : 0;
      vl.topologicalHop = hopDistance;

      // =========================================================================
      // FILTRADO TOPOLÓGICO: PASILLOS NO CONECTADOS QUEDAN EXCLUIDOS
      // =========================================================================
      if (isInterior && activeGroupId && group && hopDistance >= 2 && !wasInRange) {
        vl.spatialState = 'OUTSIDE';
        vl.insideVolume = false;
        vl.inPreEntryZone = false;
        vl.inPreExitZone = false;
        vl.targetMultiplier = 0.0;
        vl.isLightInRange = false;
        vl.isShadowInRange = false;
        vl._isInPrepareRange = false;
        vl.rejectionReason = 'TOPOLOGICALLY_DISCONNECTED';
        vl.decisionText = `INELIGIBLE (Salto ${hopDistance} desde zona activa)`;
        this.transitionState(vl, 'INACTIVE', nowTimeStr, 'TOPOLOGICALLY_DISCONNECTED', vl.decisionText);
        continue;
      }

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
          this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'CONTAINER_NOT_FOUND', 'Sin contenedor válido');
          continue;
        }

        const configuredPreDist = Math.max(3.0, lightComp.preEntryDistance ?? 6.0);
        const contResult = this.containmentSvc.evaluateModelContainment(actorWorldPos, container, configuredPreDist, wasInRange);

        vl.spatialState = contResult.spatialState;
        vl.insideVolume = contResult.inside;
        vl.inPreEntryZone = contResult.preEntry;
        vl.inPreExitZone = contResult.preExit;
        vl.distanceToBoundary = parseFloat(contResult.distanceToBoundary.toFixed(2));
        vl.containmentSource = contResult.source;

        const isConnectedNeighbor = hopDistance === 1;
        vl._isInPrepareRange = (hopDistance === 0) || (isConnectedNeighbor && contResult.distanceToBoundary <= (configuredPreDist + 8.0));

        if (contResult.spatialState === 'INSIDE') {
          vl.targetMultiplier = 1.0;
          vl.isLightInRange = true;
          this.evaluateStateAndDecision(vl, 0, 0, configuredPreDist, nowTimeStr, `ACTIVA (DENTRO DE ${group?.name || 'PASILLO'})`);
        } else if (contResult.spatialState === 'PRE_ENTRY') {
          vl.targetMultiplier = LightAttenuationCurve.calculate(contResult.distanceToBoundary, 0, configuredPreDist);
          vl.isLightInRange = vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          this.evaluateStateAndDecision(vl, contResult.distanceToBoundary, 0, configuredPreDist, nowTimeStr, `PRE-ENTRADA (${group?.name || 'UMBRAL'})`);
        } else if (contResult.spatialState === 'PRE_EXIT') {
          const holdDistance = LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_HOLD_MARGIN;
          const maxExitDist = LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_MAX_DISTANCE;

          if (contResult.distanceToBoundary <= holdDistance) {
            vl.targetMultiplier = 1.0;
          } else {
            vl.targetMultiplier = LightAttenuationCurve.calculate(contResult.distanceToBoundary, holdDistance, maxExitDist);
          }

          vl.isLightInRange = vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          this.evaluateStateAndDecision(vl, contResult.distanceToBoundary, holdDistance, maxExitDist, nowTimeStr, `PRE-SALIDA / ATENUANDO (${group?.name || 'ZONA'})`);
        } else {
          vl.targetMultiplier = 0.0;
          if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
            vl.isLightInRange = true;
            this.transitionState(vl, 'FADING_OUT', nowTimeStr, undefined, 'APAGANDO DESPUÉS DE SALIR');
          } else {
            vl.isLightInRange = false;
            this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'OUTSIDE_INTERIOR_VOLUME', 'Fuera del pasillo');
          }
        }

        vl.isShadowInRange = vl.isLightInRange && (lightComp.castShadows ?? true);
      } else {
        // Modo radial exterior
        vl.spatialState = undefined;
        vl.containmentSource = undefined;
        vl.inPreExitZone = false;

        const configuredAct = lightComp.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS;
        const configuredDeact = lightComp.deactivationDistance ?? (configuredAct + 6.0);

        this.applyStandardProximity(vl, centerDist, configuredAct, configuredDeact, wasInRange, nowTimeStr);

        if (vl.isLightInRange && lightComp.castShadows && lightComp.distanceShadowsEnabled !== false) {
          const shadowAct = lightComp.shadowActivationDistance ?? (configuredAct * 0.8);
          const shadowDeact = lightComp.shadowDeactivationDistance ?? (shadowAct + 4.0);
          vl.isShadowInRange = wasInRange ? centerDist <= shadowDeact : centerDist <= shadowAct;
        } else {
          vl.isShadowInRange = false;
        }
      }
    }
  }

  private applyStandardProximity(
    vl: VirtualLight, dist: number, rAct: number, rDeact: number, wasInRange: boolean, timestamp: string
  ): void {
    const currentLimit = wasInRange ? rDeact : rAct;
    vl.targetMultiplier = LightAttenuationCurve.calculate(dist, rAct * 0.7, rDeact);

    if (dist <= currentLimit && vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
      vl.isLightInRange = true;
      this.evaluateStateAndDecision(vl, dist, rAct, rDeact, timestamp, 'PROXIMIDAD RADIAL');
    } else {
      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        vl.isLightInRange = true;
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, 'FADING OUT RADIAL');
      } else {
        vl.isLightInRange = false;
        this.transitionState(vl, dist > rDeact ? 'OUTSIDE' : 'INACTIVE', timestamp, 'OUT_OF_RANGE', 'Fuera de rango');
      }
    }
  }

  private evaluateStateAndDecision(
    vl: VirtualLight, dist: number, rAct: number, rDeact: number, timestamp: string, contextMsg: string
  ): void {
    if (vl.targetMultiplier >= 0.98) {
      this.transitionState(vl, 'ACTIVE', timestamp, undefined, `ACTIVA (${contextMsg})`);
    } else if (vl.targetMultiplier > 0.01) {
      if (vl.targetMultiplier > vl.currentMultiplier) {
        this.transitionState(vl, 'FADING_IN', timestamp, undefined, `ENCENDIENDO (${contextMsg})`);
      } else {
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, `APAGANDO (${contextMsg})`);
      }
    } else {
      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, `APAGANDO (${contextMsg})`);
      } else {
        this.transitionState(vl, 'INACTIVE', timestamp, 'INTENSITY_NEAR_ZERO', `INACTIVA (${contextMsg})`);
      }
    }
  }

  private transitionState(
    vl: VirtualLight, newState: LightLifecycleStage, timestamp: string, rejectionReason?: string, decisionText: string = ''
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