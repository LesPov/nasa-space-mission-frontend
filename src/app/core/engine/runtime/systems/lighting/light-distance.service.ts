
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { GameMode } from '../../../session/game-mode.model';
import { VirtualLight } from './lighting-types';
import { LightTransformService } from './light-transform.service';
import { EditorLightingPolicy } from './policies/editor-lighting.policy';
import { RuntimeLightingPolicy } from './policies/runtime-lighting.policy';
import { LightReferenceService } from './light-reference.service';

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
              vl.isLightInRange = false; vl.isShadowInRange = false; vl.targetMultiplier = 0;
              vl._isInPrepareRange = false;
              continue;
          }

          const wasInRange = vl.isLightInRange;
          
          let refPos = baseRefPos;
          if (policy.referenceStrategy === 'RUNTIME_CONFIG' && lightComp.distanceReferenceMode !== 'AUTO') {
              refPos = this.referenceSvc.getReferencePosition(lightComp.distanceReferenceMode);
          }
          
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          
          vl.distSq = Vector3.DistanceSquared(refPos, this._tempPos);
          const dist = Math.sqrt(vl.distSq);
          vl.lastEvaluatedDistance = dist;

          const thresholds = policy.calculateThresholds(
              lightComp.activationDistance,
              lightComp.deactivationDistance,
              lightComp.shadowActivationDistance,
              lightComp.shadowDeactivationDistance,
              speed
          );

          vl._isInPrepareRange = dist <= thresholds.prepare;

          if (lightComp.distanceControlEnabled) {
              if (dist > thresholds.dynamicDeactivation) { 
                  vl.isLightInRange = false; 
                  vl.targetMultiplier = 0; 
              } else {
                  vl.isLightInRange = true;
                  if (dist <= thresholds.fadeStart) vl.targetMultiplier = 1.0;
                  else {
                      let t = 1.0 - ((dist - thresholds.fadeStart) / (thresholds.fadeEnd - thresholds.fadeStart));
                      t = Math.max(0, Math.min(1, t));
                      vl.targetMultiplier = (t * t * (3.0 - 2.0 * t));
                  }
              }
          } else {
              vl._isInPrepareRange = true;
              vl.isLightInRange = true; 
              vl.targetMultiplier = 1.0;
          }

          if (vl.isLightInRange && lightComp.castShadows) {
              if (lightComp.distanceShadowsEnabled) {
                  if (vl.isShadowInRange) { if (dist > thresholds.shadowDeactivation) vl.isShadowInRange = false; } 
                  else { if (dist <= thresholds.shadowActivation) vl.isShadowInRange = true; }
              } else { vl.isShadowInRange = true; }
          } else { vl.isShadowInRange = false; }

          if (isEditorPure && this.context.authorityProfile().canViewDebug && wasInRange !== vl.isLightInRange) {
              console.log(`[EDITOR LIGHT] ${vl.isLightInRange ? '🟢 ON' : '🔴 OFF'} | ${vl.entity.name} | Dist: ${dist.toFixed(1)}m`);
          }
      }
  }
}