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

@Injectable({ providedIn: 'root' })
export class LightDistanceService {
  private context = inject(GameContextService);
  private lightTransform = inject(LightTransformService);
  private referenceSvc = inject(LightReferenceService);

  private editorPolicy = new EditorLightingPolicy();
  private runtimePolicy = new RuntimeLightingPolicy();

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public evaluateDistanceAndHysteresis(activeVirtuals: VirtualLight[], baseRefPos: Vector3, speed: number): void {
      const mode = this.context.mode();
      const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const policy = isEditorPure ? this.editorPolicy : this.runtimePolicy;

      for (let i = 0; i < activeVirtuals.length; i++) {
          const vl = activeVirtuals[i];
          const lightComp = vl.entity.light;
          
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.isLightInRange = false; 
              vl.isShadowInRange = false; 
              vl.targetMultiplier = 0;
              vl._isInPrepareRange = false;
              vl.closestActorName = 'Inactiva';
              continue;
          }

          const wasInRange = vl.isLightInRange;
          
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

          let dist: number;

          if (isEditorPure) {
              const closest = this.referenceSvc.getClosestActorForLight(this._tempPos);
              dist = closest.distance;
              vl.closestActorName = closest.actor ? closest.actor.name : 'NO_ACTOR';
          } else {
              let refPos = baseRefPos;
              if (lightComp.distanceReferenceMode === 'CAMERA') {
                  refPos = this.referenceSvc.getReferencePosition('CAMERA');
                  vl.closestActorName = 'Cámara de Juego';
                  dist = Vector3.Distance(refPos, this._tempPos);
              } else {
                  const closest = this.referenceSvc.getClosestActorForLight(this._tempPos);
                  refPos = closest.actorPosition;
                  vl.closestActorName = closest.actor ? closest.actor.name : 'NO_ACTOR';
                  // Si no hay actor en auto mode, forzamos distancia infinita para apagar luces locales
                  dist = closest.actor ? Vector3.Distance(refPos, this._tempPos) : Number.MAX_VALUE;
              }
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

          // Rango de preparación para asignar slot en el pool
          vl._isInPrepareRange = dist <= thresholds.prepare;

          if (lightComp.distanceControlEnabled) {
              // Curva matemática suave de fade tanto en Editor como en Runtime calculada contra el actor
              vl.targetMultiplier = LightAttenuationCurve.calculate(dist, thresholds.activation, thresholds.dynamicDeactivation);

              // Tolerancia de ranura lógica para evitar alternancias bruscas en la frontera
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

          // Lógica de Sombras por Distancia
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
}