// file: src/app/core/engine/runtime/systems/lighting/light-distance.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { GameMode } from '../../../session/game-mode.model';
import { VirtualLight } from './lighting-types';
import { LightTransformService } from './light-transform.service';
import { EditorLightingPolicy } from './policies/editor-lighting.policy';
import { RuntimeLightingPolicy } from './policies/runtime-lighting.policy';
import { LightReferenceService } from './light-reference.service';
import { LightAttenuationCurve } from './light-attenuation-curve';
import { LightContainmentService } from './light-containment.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';

@Injectable({ providedIn: 'root' })
export class LightDistanceService {
  private context = inject(GameContextService);
  private lightTransform = inject(LightTransformService);
  private referenceSvc = inject(LightReferenceService);
  private containmentSvc = inject(LightContainmentService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  private editorPolicy = new EditorLightingPolicy();
  private runtimePolicy = new RuntimeLightingPolicy();

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public evaluateDistanceAndHysteresis(activeVirtuals: VirtualLight[], baseRefPos: Vector3, speed: number): void {
      const mode = this.context.mode();
      const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const policy = isEditorPure ? this.editorPolicy : this.runtimePolicy;
      const scene = this.motor3d.getScene();

      for (let i = 0; i < activeVirtuals.length; i++) {
          const vl = activeVirtuals[i];
          const lightComp = vl.entity.light;
          
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.isLightInRange = false; 
              vl.isShadowInRange = false; 
              vl.targetMultiplier = 0;
              vl._isInPrepareRange = false;
              vl.lifecycleStage = 'IDLE';
              vl.closestActorName = 'Inactiva';
              vl.isInterior = false;
              vl.insideVolume = false;
              vl.inPreEntryZone = false;
              continue;
          }

          const wasInRange = vl.isLightInRange;
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

          let dist: number;
          let actorWorldPos: Vector3;

          if (isEditorPure) {
              const closest = this.referenceSvc.getClosestActorForLight(this._tempPos);
              dist = closest.distance;
              actorWorldPos = closest.actorPosition;
              vl.closestActorName = closest.actor ? closest.actor.name : 'NO_ACTOR';
          } else {
              if (lightComp.distanceReferenceMode === 'CAMERA') {
                  actorWorldPos = this.referenceSvc.getReferencePosition('CAMERA');
                  vl.closestActorName = 'Cámara de Juego';
                  dist = Vector3.Distance(actorWorldPos, this._tempPos);
              } else {
                  const closest = this.referenceSvc.getClosestActorForLight(this._tempPos);
                  actorWorldPos = closest.actorPosition;
                  vl.closestActorName = closest.actor ? closest.actor.name : 'NO_ACTOR';
                  dist = closest.actor ? Vector3.Distance(actorWorldPos, this._tempPos) : Number.MAX_VALUE;
              }
          }

          if (dist === Number.MAX_VALUE || !vl.closestActorName || vl.closestActorName === 'NO_ACTOR') {
              vl.isLightInRange = false;
              vl.isShadowInRange = false;
              vl.targetMultiplier = 0;
              vl._isInPrepareRange = false;
              vl.lifecycleStage = 'IDLE';
              vl.lastEvaluatedDistance = 99999;
              vl.isInterior = lightComp.containmentMode === 'INTERIOR';
              vl.insideVolume = false;
              vl.inPreEntryZone = false;
              continue;
          }

          vl.distSq = dist * dist;
          vl.lastEvaluatedDistance = dist;

          const thresholds = policy.calculateThresholds(
              lightComp.activationDistance,
              lightComp.deactivationDistance,
              lightComp.shadowActivationDistance,
              lightComp.shadowDeactivationDistance,
              speed
          );

          const isInterior = lightComp.containmentMode === 'INTERIOR';
          vl.isInterior = isInterior;
          vl.interiorActivationMode = lightComp.interiorActivationMode || 'VOLUME';

          if (isInterior && scene) {
              const container = this.containmentSvc.resolveContainerEntity(vl.entity, scene);
              vl.containerName = container ? container.name : 'Auto/Sin Asignar';

              if (container && container.view && !container.view.isDisposed()) {
                  const preEntryDist = lightComp.preEntryEnabled ? (lightComp.preEntryDistance ?? 3.0) : 0.0;
                  const evalVol = this.containmentSvc.evaluateActorInsideContainer(actorWorldPos, container, preEntryDist, wasInRange);
                  
                  vl.insideVolume = evalVol.inside;
                  vl.inPreEntryZone = evalVol.inPreEntry;

                  const activationMode = lightComp.interiorActivationMode || 'VOLUME';

                  if (activationMode === 'VOLUME') {
                      if (vl.insideVolume) {
                          if (lightComp.distanceControlEnabled) {
                              vl.targetMultiplier = LightAttenuationCurve.calculate(dist, thresholds.activation, thresholds.dynamicDeactivation);
                          } else {
                              vl.targetMultiplier = 1.0;
                          }
                          vl.isLightInRange = true;
                          vl._isInPrepareRange = true;
                      } else if (vl.inPreEntryZone) {
                          const ratio = Math.max(0.0, Math.min(1.0, 1.0 - (evalVol.distToBox / Math.max(0.1, preEntryDist))));
                          vl.targetMultiplier = ratio * 0.75;
                          vl.isLightInRange = ratio > 0.05;
                          vl._isInPrepareRange = true;
                      } else {
                          vl.targetMultiplier = 0.0;
                          vl.isLightInRange = false;
                          vl._isInPrepareRange = evalVol.distToBox <= (preEntryDist + 15.0);
                      }
                  } else if (activationMode === 'DISTANCE') {
                      this.applyStandardProximity(vl, lightComp, dist, thresholds, wasInRange);
                  } else if (activationMode === 'BOTH') {
                      if (vl.insideVolume || vl.inPreEntryZone) {
                          this.applyStandardProximity(vl, lightComp, dist, thresholds, wasInRange);
                          if (!vl.isLightInRange) {
                              vl.targetMultiplier = 0.0;
                          }
                      } else {
                          vl.targetMultiplier = 0.0;
                          vl.isLightInRange = false;
                          vl._isInPrepareRange = evalVol.distToBox <= (preEntryDist + 15.0);
                      }
                  }
              } else {
                  this.applyStandardProximity(vl, lightComp, dist, thresholds, wasInRange);
              }
          } else {
              vl.insideVolume = false;
              vl.inPreEntryZone = false;
              vl.containerName = undefined;
              this.applyStandardProximity(vl, lightComp, dist, thresholds, wasInRange);
          }

          // Definir etapas del ciclo de vida (PRELOAD -> PREACTIVE -> ACTIVE)
          if (vl.isLightInRange && vl.targetMultiplier > 0.05) {
              vl.lifecycleStage = 'ACTIVE';
          } else if (vl._isInPrepareRange || (vl.isLightInRange && vl.targetMultiplier <= 0.05)) {
              vl.lifecycleStage = 'PREACTIVE';
          } else if (dist <= (thresholds.prepare + 20.0)) {
              vl.lifecycleStage = 'PRELOAD';
          } else {
              vl.lifecycleStage = 'IDLE';
              vl.isWarmedUp = false;
          }

          // Evaluación de sombras por histéresis
          if (vl.isLightInRange && lightComp.castShadows) {
              if (lightComp.distanceShadowsEnabled) {
                  if (vl.isShadowInRange) { 
                      if (dist > thresholds.shadowDeactivation) vl.isShadowInRange = false; 
                  } else { 
                      if (dist <= thresholds.shadowActivation) vl.isShadowInRange = true; 
                  }
              } else { 
                  vl.isShadowInRange = true; 
              }
          } else { 
              vl.isShadowInRange = false; 
          }
      }
  }

  private applyStandardProximity(vl: VirtualLight, lightComp: any, dist: number, thresholds: any, wasInRange: boolean): void {
      vl._isInPrepareRange = dist <= thresholds.prepare;

      if (lightComp.distanceControlEnabled) {
          vl.targetMultiplier = LightAttenuationCurve.calculate(dist, thresholds.activation, thresholds.dynamicDeactivation);
          const logicalDeactivation = thresholds.dynamicDeactivation + 2.0;

          if (wasInRange) {
              vl.isLightInRange = dist <= logicalDeactivation;
          } else {
              vl.isLightInRange = dist <= thresholds.dynamicDeactivation;
          }
      } else {
          vl._isInPrepareRange = true;
          vl.isLightInRange = true; 
          vl.targetMultiplier = 1.0;
      }
  }
}