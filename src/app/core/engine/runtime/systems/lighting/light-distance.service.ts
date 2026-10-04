// file: src/app/core/engine/runtime/systems/lighting/light-distance.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Tags } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { VirtualLight, LightLifecycleStage, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { LightTransformService } from './light-transform.service';
import { LightReferenceService } from './light-reference.service';
import { LightAttenuationCurve } from './light-attenuation-curve';
import { LightContainmentService } from './light-containment.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { EngineProfilerService } from '../../../telemetry/engine-profiler.service';

@Injectable({ providedIn: 'root' })
export class LightDistanceService {
  private context = inject(GameContextService);
  private lightTransform = inject(LightTransformService);
  private referenceSvc = inject(LightReferenceService);
  private containmentSvc = inject(LightContainmentService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private profiler = inject(EngineProfilerService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();
  private _tempClosestPoint = Vector3.Zero();

  public evaluateDistanceAndHysteresis(activeVirtuals: VirtualLight[], baseRefPos: Vector3, speed: number): void {
    const scene = this.motor3d.getScene();
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
        vl.lastEvaluatedDistance = 99999;
        vl.centerDistance = 99999;
        vl.boundsDistance = 99999;
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

      const centerDist = Vector3.Distance(actorWorldPos, this._tempPos);
      const boundsDist = this.calculateBoundsDistance(vl.entity.view, actorWorldPos, centerDist);
      const effectiveDist = Math.min(centerDist, boundsDist);

      vl.centerDistance = parseFloat(centerDist.toFixed(2));
      vl.boundsDistance = parseFloat(boundsDist.toFixed(2));
      vl.effectiveDistance = parseFloat(effectiveDist.toFixed(2));
      vl.lastEvaluatedDistance = vl.effectiveDistance;
      vl.distSq = effectiveDist * effectiveDist;
      vl.lastDistanceUpdateTimestamp = nowTimeStr;

      const configuredActivation = lightComp.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS;
      const configuredDeactivation = lightComp.deactivationDistance ?? (configuredActivation + 5.0);
      
      const rActivation = Math.max(1.0, configuredActivation);
      const rDeactivation = Math.max(rActivation + 1.0, configuredDeactivation);
      const rPrepare = rDeactivation + 10.0;

      const isInterior = lightComp.containmentMode === 'INTERIOR';
      vl.isInterior = isInterior;
      vl.interiorActivationMode = lightComp.interiorActivationMode || 'DISTANCE';

      const container = (isInterior && scene) ? this.containmentSvc.resolveContainerEntity(vl.entity, scene) : null;
      vl.containerName = container ? container.name : undefined;

      let evalVol = { inside: false, inPreEntry: false, distToBox: Number.MAX_VALUE };
      if (container && container.view && !container.view.isDisposed()) {
        const preEntryDist = lightComp.preEntryEnabled ? (lightComp.preEntryDistance ?? 4.0) : 0.0;
        evalVol = this.containmentSvc.evaluateActorInsideContainer(actorWorldPos, container, preEntryDist, wasInRange);
      }
      vl.insideVolume = evalVol.inside;
      vl.inPreEntryZone = evalVol.inPreEntry;

      if (isInterior && lightComp.interiorActivationMode === 'VOLUME') {
        if (vl.insideVolume) {
          vl.targetMultiplier = LightAttenuationCurve.calculate(effectiveDist, rActivation * 0.75, rDeactivation);
          vl.isLightInRange = effectiveDist <= rDeactivation && vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          vl._isInPrepareRange = true;
          this.evaluateStateAndDecision(vl, effectiveDist, rActivation, rDeactivation, nowTimeStr, 'INTERIOR DENTRO DE VOLUMEN');
        } else if (vl.inPreEntryZone) {
          const ratio = Math.max(0.0, Math.min(1.0, 1.0 - (evalVol.distToBox / Math.max(0.1, lightComp.preEntryDistance ?? 4.0))));
          vl.targetMultiplier = ratio * 0.8;
          vl.isLightInRange = ratio > 0.02;
          vl._isInPrepareRange = true;
          this.evaluateStateAndDecision(vl, effectiveDist, rActivation, rDeactivation, nowTimeStr, 'PRE-ENTRADA (FADE IN)');
        } else {
          vl.targetMultiplier = 0.0;
          vl.isLightInRange = false;
          vl._isInPrepareRange = evalVol.distToBox <= ((lightComp.preEntryDistance ?? 4.0) + 10.0);
          this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'OUTSIDE_INTERIOR_VOLUME', 'Fuera de volumen interior');
        }
      } else {
        // En modo DISTANCE o GLOBAL la activación depende estrictamente de la distancia física al player
        this.applyStandardProximity(vl, effectiveDist, rActivation, rDeactivation, rPrepare, wasInRange, nowTimeStr);
      }

      if (vl.isLightInRange && lightComp.castShadows) {
        const shadowAct = lightComp.shadowActivationDistance ?? Math.min(LIGHT_SPATIAL_CONSTANTS.DEFAULT_SHADOW_ACTIVATION_RADIUS, rActivation * 0.6);
        const shadowDeact = lightComp.shadowDeactivationDistance ?? (shadowAct + 4.0);

        if (vl.isShadowInRange) {
          if (effectiveDist > shadowDeact) vl.isShadowInRange = false;
        } else {
          if (effectiveDist <= shadowAct) vl.isShadowInRange = true;
        }
      } else {
        vl.isShadowInRange = false;
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

    vl.targetMultiplier = LightAttenuationCurve.calculate(dist, rActivation * 0.7, rDeactivation);

    if (dist <= currentLimit && vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
      vl.isLightInRange = true;
      this.evaluateStateAndDecision(vl, dist, rActivation, rDeactivation, timestamp, 'PROXIMIDAD RADIAL ESTÁNDAR');
    } else {
      vl.isLightInRange = false;
      this.transitionState(vl, dist > rDeactivation ? 'OUTSIDE' : 'INACTIVE', timestamp, 'OUT_OF_EFFECTIVE_RANGE', 'Fuera de rango de activación');
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
    if (dist <= (rAct * 0.7)) {
      this.transitionState(vl, 'ACTIVE', timestamp, undefined, `INSIDE ACTIVATION RANGE (${contextMsg})`);
    } else if (vl.targetMultiplier > 0.05) {
      if (vl.currentMultiplier < vl.targetMultiplier) {
        this.transitionState(vl, 'FADING_IN', timestamp, undefined, `INSIDE FADE RANGE [ENTRADA] (${contextMsg})`);
      } else {
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, `INSIDE FADE RANGE [SALIDA] (${contextMsg})`);
      }
    } else {
      this.transitionState(vl, 'INACTIVE', timestamp, 'INTENSITY_NEAR_ZERO', `NEAR ZERO THRESHOLD (${contextMsg})`);
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

  private calculateBoundsDistance(rootMesh: AbstractMesh, actorPos: Vector3, fallbackDistance: number): number {
    try {
      if (rootMesh.name.includes('light') || Tags.MatchesQuery(rootMesh, 'light_entity')) {
        return fallbackDistance;
      }

      rootMesh.computeWorldMatrix(true);
      const bInfo = rootMesh.getHierarchyBoundingVectors(true, (m: AbstractMesh) => {
        return !Tags.MatchesQuery(m, 'system_element || editor_only || proxy_collider || light_visual || debug_element');
      });

      const min = bInfo.min;
      const max = bInfo.max;

      if (!Number.isFinite(min.x) || !Number.isFinite(max.x) || min.x > max.x) {
        return fallbackDistance;
      }

      const cx = Math.max(min.x, Math.min(actorPos.x, max.x));
      const cy = Math.max(min.y, Math.min(actorPos.y, max.y));
      const cz = Math.max(min.z, Math.min(actorPos.z, max.z));

      this._tempClosestPoint.set(cx, cy, cz);
      return Vector3.Distance(actorPos, this._tempClosestPoint);
    } catch {
      return fallbackDistance;
    }
  }
}