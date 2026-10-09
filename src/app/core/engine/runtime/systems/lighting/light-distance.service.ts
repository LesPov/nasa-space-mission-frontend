// file: src/app/core/engine/runtime/systems/lighting/light-distance.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { 
  VirtualLight, LightLifecycleStage, MacroZoneState, 
  LIGHT_SPATIAL_CONSTANTS 
} from './lighting-types';
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

  private currentMacroZone: MacroZoneState = 'EXTERIOR';

  public getMacroZone(): MacroZoneState {
    return this.currentMacroZone;
  }

  public evaluateDistanceAndHysteresis(
    activeVirtuals: VirtualLight[], 
    baseRefPos: Vector3, 
    speed: number, 
    moveDir: Vector3 = Vector3.Zero()
  ): void {
    const scene = this.motor3d.getScene();
    this.profiler.recordDistanceEvaluation('LightDistanceService', activeVirtuals.length);
    const validActors = this.referenceSvc.getValidActorEntities();
    const nowTimeStr = new Date().toLocaleTimeString();

    const activeGroupId = this.spatialGroups.getActiveGroupId();

    let actorWorldPos: Vector3;
    let actorName = 'Referencia Base';
    if (validActors.length > 0) {
      actorWorldPos = this.referenceSvc.getActorWorldPosition(validActors[0], new Vector3());
      actorName = validActors[0].name;
    } else {
      actorWorldPos = baseRefPos;
    }

    const actorVelocity = moveDir.scale(speed);

    // 1. Determinar el Estado Macro Espacial del Jugador
    let anyInsideInterior = false;
    let anyInPreEntryInterior = false;
    let anyInPreExitInterior = false;

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      if (vl.entity.light?.containmentMode === 'INTERIOR') {
        const container = scene ? this.containmentSvc.resolveContainerEntity(vl.entity, scene) : null;
        if (container) {
          const configuredPreDist = Math.max(3.0, vl.entity.light?.preEntryDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_INTERIOR_PREENTRY_DISTANCE);
          const wasInside = vl.spatialState === 'INSIDE';
          const evalRes = this.containmentSvc.evaluateModelContainment(actorWorldPos, container, configuredPreDist, wasInside, actorVelocity);
          
          if (evalRes.spatialState === 'INSIDE') anyInsideInterior = true;
          if (evalRes.spatialState === 'PRE_ENTRY') anyInPreEntryInterior = true;
          if (evalRes.spatialState === 'PRE_EXIT') anyInPreExitInterior = true;
        }
      }
    }

    if (anyInsideInterior) {
      this.currentMacroZone = 'INTERIOR_ACTIVE';
    } else if (anyInPreEntryInterior) {
      this.currentMacroZone = 'INTERIOR_PREENTRY';
    } else if (anyInPreExitInterior) {
      this.currentMacroZone = 'INTERIOR_EXIT';
    } else {
      this.currentMacroZone = 'EXTERIOR';
    }

    // 2. Evaluación individual de cada luz virtual
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

      vl.closestActorName = actorName;
      const wasInRange = vl.isLightInRange;
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

      const hubDist = this.spatialHub.getDistanceToPlayer(vl.entity.uid);
      const centerDist = hubDist !== Number.MAX_VALUE ? hubDist : Vector3.Distance(actorWorldPos, this._tempPos);
      
      vl.centerDistance = parseFloat(centerDist.toFixed(2));
      vl.effectiveDistance = vl.centerDistance;
      vl.lastEvaluatedDistance = vl.centerDistance;
      vl.distSq = centerDist * centerDist;
      vl.lastDistanceUpdateTimestamp = nowTimeStr;

      // Cálculo continuo del dot con el vector forward de la cámara
      const cam = scene?.activeCamera;
      if (cam && centerDist > 0.1) {
        const toLightDir = this._tempPos.subtract(actorWorldPos).normalize();
        const camFwd = cam.getDirection(Vector3.Forward());
        camFwd.y = 0; camFwd.normalize();
        vl.dotWithCameraForward = Vector3.Dot(camFwd, toLightDir);
      } else {
        vl.dotWithCameraForward = 1.0;
      }

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

      // Desconexión topológica estricta: solo a >= 2 saltos si no es grupo predicho y estamos profundamente en otro interior
      const isPredictedGroup = Boolean(group && this.spatialGroups.getPreactivatingGroupIds().has(group.id));
      if (isInterior && activeGroupId && group && hopDistance >= 2 && !isPredictedGroup && !wasInRange && this.currentMacroZone === 'INTERIOR_ACTIVE') {
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

      // =======================================================================
      // EVALUACIÓN MODO INTERIOR (PRE-ENTRY 16 METROS PRESERVADA)
      // =======================================================================
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

        const configuredPreDist = Math.max(3.0, lightComp.preEntryDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_INTERIOR_PREENTRY_DISTANCE);
        const contResult = this.containmentSvc.evaluateModelContainment(actorWorldPos, container, configuredPreDist, wasInRange, actorVelocity);

        vl.spatialState = contResult.spatialState;
        vl.insideVolume = contResult.inside;
        vl.inPreEntryZone = contResult.preEntry;
        vl.inPreExitZone = contResult.preExit;
        vl.distanceToBoundary = parseFloat(contResult.distanceToBoundary.toFixed(2));
        vl.containmentSource = contResult.source;

        const isConnectedNeighbor = Boolean(hopDistance <= 1 || isPredictedGroup);
        const prepareLookAhead = Math.min(12.0, speed * 1.5);
        const totalPrepareMargin = configuredPreDist + 8.0 + prepareLookAhead;
        vl._isInPrepareRange = Boolean(isConnectedNeighbor && (contResult.distanceToBoundary <= totalPrepareMargin));

        if (contResult.spatialState === 'INSIDE') {
          vl.targetMultiplier = 1.0;
          vl.isLightInRange = true;
          this.evaluateStateAndDecision(vl, 0, 0, configuredPreDist, nowTimeStr, `ACTIVA (DENTRO DE ${group?.name || 'PASILLO'})`);
        } else if (contResult.spatialState === 'PRE_ENTRY') {
          // Curva suave de entrada hacia la abertura de la puerta
          vl.targetMultiplier = LightAttenuationCurve.calculate(contResult.distanceToBoundary, 0, configuredPreDist);
          vl.isLightInRange = vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          this.evaluateStateAndDecision(vl, contResult.distanceToBoundary, 0, configuredPreDist, nowTimeStr, `PRE-ENTRADA (${group?.name || 'UMBRAL'})`);
        } else if (contResult.spatialState === 'PRE_EXIT') {
          const holdDistance = LIGHT_SPATIAL_CONSTANTS.INTERIOR_KEEP_ALIVE_HOLD_MARGIN;
          const maxExitDist = Math.max(configuredPreDist + 4.0, lightComp.deactivationDistance ?? 32.0);

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
            this.transitionState(vl, 'FADING_OUT', nowTimeStr, undefined, 'APAGANDO TRAS SALIR');
          } else {
            vl.isLightInRange = false;
            this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'OUTSIDE_INTERIOR_VOLUME', 'Fuera de preentrada interior');
          }
        }

        const shadowPreDist = lightComp.linkShadowPreEntryToLightPreEntry !== false
          ? configuredPreDist
          : (lightComp.shadowPreEntryDistance ?? configuredPreDist);

        vl.isShadowInRange = (vl.isLightInRange || (contResult.distanceToBoundary <= shadowPreDist)) && (lightComp.castShadows ?? true);
      } 
      // =======================================================================
      // EVALUACIÓN MODO EXTERIOR / GLOBAL
      // =======================================================================
      else {
        vl.spatialState = undefined;
        vl.containmentSource = undefined;
        vl.inPreExitZone = false;

        const configuredAct = lightComp.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS;
        const configuredDeact = lightComp.deactivationDistance ?? (configuredAct + 7.0);

        // Cuando el jugador se interna profundamente en el pasillo interior, las luces exteriores atenúan su alcance
        const isDeepInside = this.currentMacroZone === 'INTERIOR_ACTIVE';
        const effectiveActDist = isDeepInside ? (configuredAct * 0.45) : configuredAct;
        const effectiveDeactDist = isDeepInside ? (configuredDeact * 0.55) : configuredDeact;

        this.applyStandardProximity(vl, centerDist, effectiveActDist, effectiveDeactDist, wasInRange, nowTimeStr);

        if (vl.isLightInRange && lightComp.castShadows && lightComp.distanceShadowsEnabled !== false) {
          const shadowAct = lightComp.shadowActivationDistance ?? (effectiveActDist * 0.85);
          const shadowDeact = lightComp.shadowDeactivationDistance ?? (shadowAct + 4.0);
          vl.isShadowInRange = wasInRange ? centerDist <= shadowDeact : centerDist <= shadowAct;
        } else {
          vl.isShadowInRange = false;
        }

        vl._isInPrepareRange = centerDist <= (effectiveDeactDist + 15.0);
      }
    }
  }

  private applyStandardProximity(
    vl: VirtualLight, dist: number, rAct: number, rDeact: number, wasInRange: boolean, timestamp: string
  ): void {
    const currentLimit = wasInRange ? rDeact : rAct;
    vl.targetMultiplier = LightAttenuationCurve.calculate(dist, rAct * 0.65, rDeact);

    if (dist <= currentLimit && vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
      vl.isLightInRange = true;
      this.evaluateStateAndDecision(vl, dist, rAct, rDeact, timestamp, 'PROXIMIDAD RADIAL EXTERIOR');
    } else {
      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        vl.isLightInRange = true;
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, 'FADING OUT RADIAL');
      } else {
        vl.isLightInRange = false;
        this.transitionState(vl, dist > rDeact ? 'OUTSIDE' : 'INACTIVE', timestamp, 'OUT_OF_RANGE', 'Fuera de rango exterior');
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