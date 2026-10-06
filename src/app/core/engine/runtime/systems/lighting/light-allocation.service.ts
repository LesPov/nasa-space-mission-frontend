
// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { VirtualLight, PoolSlot, ShadowTier, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);
  private spatialGroups = inject(SpatialStreamingGroupService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public allocatePoolSlots(
    activeVirtuals: VirtualLight[], 
    refPos: Vector3, 
    moveDir: Vector3, 
    speed: number, 
    selectedUid: string | null
  ): void {
    const lookAheadTime = Math.min(2.0, Math.max(0.6, speed * 0.15));
    const lookAheadDist = Math.min(45.0, Math.max(10.0, speed * lookAheadTime * 2.0));
    const predictedPos = refPos.add(moveDir.scale(lookAheadDist));

    const currentlyOccupiedSlots = this.lightPool.getAllSlots().filter(s => s.assignedEntityUid !== null);
    const assignedUidsSet = new Set<string>();
    currentlyOccupiedSlots.forEach(s => assignedUidsSet.add(s.assignedEntityUid!));

    const activeGroupId = this.spatialGroups.getActiveGroupId();
    const preactivatingGroups = this.spatialGroups.getPreactivatingGroupIds();

    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      if (assignedUidsSet.has(vl.entity.uid) && vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        return true;
      }

      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);
      const isGroupPriority = Boolean(
        group && (
          group.id === activeGroupId || 
          preactivatingGroups.has(group.id) || 
          group.isPredictedTarget
        )
      );

      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      if (isInteriorVolumeMode) {
        if (vl.spatialState === 'OUTSIDE' && !vl._isInPrepareRange && !isGroupPriority && vl.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          vl.rejectionReason = 'OUTSIDE_INTERIOR_VOLUME';
          vl.targetMultiplier = 0.0;
          vl.isLightInRange = false;
          vl.isShadowInRange = false;
          return false;
        }
      }

      if (isGroupPriority) return true;
      if (vl.isLightInRange || vl._isInPrepareRange) return true;

      const deact = vl.entity.light.deactivationDistance ?? ((vl.entity.light.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS) + 10.0);
      if (vl.effectiveDistance <= (deact + 25.0)) return true;

      vl.rejectionReason = 'OUTSIDE_EFFECTIVE_RANGE';
      return false;
    });

    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);

      let score = 0;

      if (isInteriorVolumeMode) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = 10 + (boundaryDist * 2);
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = 60 + (boundaryDist * 4);
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 120 + (boundaryDist * 6);
        } else if (group && (preactivatingGroups.has(group.id) || group.isPredictedTarget)) {
          score = 200 + (boundaryDist * 8); 
        } else if (vl._isInPrepareRange) {
          score = 350 + (boundaryDist * 10);
        } else {
          score = 999999;
        }
      } else {
        const dist = vl.effectiveDistance;
        const distSq = dist * dist;
        const predictedDistSq = Vector3.DistanceSquared(predictedPos, this._tempPos);

        let directionalDotBonus = 1.0;
        if (speed > 0.2 && dist > 1.0) {
          const toLightDir = this._tempPos.subtract(refPos).normalize();
          const dot = Vector3.Dot(moveDir, toLightDir);
          if (dot > 0.15) {
            directionalDotBonus = Math.max(0.55, 1.0 - (dot * 0.45));
          } else if (dot < -0.2) {
            directionalDotBonus = 1.4;
          }
        }

        score = 180 + ((distSq * 0.5) + (predictedDistSq * 0.5)) * directionalDotBonus;
      }

      // Estabilidad estricta para evitar alternancia de slots
      if (assignedUidsSet.has(vl.entity.uid)) {
        score *= 0.5;
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    validCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    const MAX_ACTIVE = LIGHT_SPATIAL_CONSTANTS.MAX_PHYSICAL_ACTIVE_LIGHTS;
    const MAX_PREPARED = LIGHT_SPATIAL_CONSTANTS.MAX_PREPARED_LIGHTS;

    const selectedActive: VirtualLight[] = [];
    for (let i = 0; i < validCandidates.length && selectedActive.length < MAX_ACTIVE; i++) {
      selectedActive.push(validCandidates[i]);
    }

    const preparedCandidates = validCandidates.filter(vl => !selectedActive.includes(vl)).slice(0, MAX_PREPARED);
    const dormantCandidates = validCandidates.filter(vl => !selectedActive.includes(vl) && !preparedCandidates.includes(vl));

    const activeUids = new Set(selectedActive.map(x => x.entity.uid));
    const tiers: ShadowTier[] = ['HIGH', 'HIGH', 'HIGH'];

    selectedActive.forEach((vl, rankIdx) => {
      vl.poolRank = rankIdx + 1;
      vl.rejectionReason = undefined;
      vl.shadowRank = rankIdx + 1;
      vl.shadowTier = tiers[rankIdx];

      const pool = this.lightPool.getPoolByType(vl.entity.type);
      if (pool.length === 0) return;

      const existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);
      if (existingSlot) {
        existingSlot.shadowTier = vl.shadowTier;
        this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
        existingSlot.light.position.copyFrom(this._tempPos);

        if (existingSlot.type === 'spot') {
          const spot = existingSlot.light as SpotLight;
          spot.direction.copyFrom(this._tempDir);
          spot.angle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
        } else if (existingSlot.type === 'directional') {
          const dirL = existingSlot.light as DirectionalLight;
          dirL.direction.copyFrom(this._tempDir);
        }

        if (existingSlot.type !== 'directional') {
          const range = vl.entity.light?.range || 50;
          (existingSlot.light as any).range = range;
          existingSlot.light.shadowMaxZ = range;
        }
      }
    });

    selectedActive.forEach((vl) => {
      const pool = this.lightPool.getPoolByType(vl.entity.type);
      if (pool.length === 0) return;

      let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);
      if (!existingSlot) {
        const freeSlot = pool.find(s => s.assignedEntityUid === null);
        if (freeSlot) {
          freeSlot.assignedEntityUid = vl.entity.uid;
          freeSlot.currentIntensity = 0;
          freeSlot.light.intensity = 0;
          freeSlot._isNewAssignment = true;
          freeSlot.isWarmedUp = false;
          freeSlot.shadowTier = vl.shadowTier;
          existingSlot = freeSlot;
        } else {
          const replaceable = pool.find(s => {
            if (activeUids.has(s.assignedEntityUid || '')) return false;
            const currentVl = activeVirtuals.find(v => v.entity.uid === s.assignedEntityUid);
            return !currentVl || currentVl.currentMultiplier <= 0.05;
          }) || pool.find(s => !activeUids.has(s.assignedEntityUid || ''));

          if (replaceable) {
            this.lightPool.forceHardRelease(replaceable);
            replaceable.assignedEntityUid = vl.entity.uid;
            replaceable.currentIntensity = 0;
            replaceable.light.intensity = 0;
            replaceable._isNewAssignment = true;
            replaceable.isWarmedUp = false;
            replaceable.shadowTier = vl.shadowTier;
            existingSlot = replaceable;
          }
        }

        if (existingSlot) {
          existingSlot.shadowTier = vl.shadowTier;
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          existingSlot.light.position.copyFrom(this._tempPos);

          if (existingSlot.type === 'spot') {
            const spot = existingSlot.light as SpotLight;
            spot.direction.copyFrom(this._tempDir);
            spot.angle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
          } else if (existingSlot.type === 'directional') {
            const dirL = existingSlot.light as DirectionalLight;
            dirL.direction.copyFrom(this._tempDir);
          }

          if (existingSlot.type !== 'directional') {
            const range = vl.entity.light?.range || 50;
            (existingSlot.light as any).range = range;
            existingSlot.light.shadowMaxZ = range;
          }
        }
      }
    });

    preparedCandidates.forEach((vl, prepIdx) => {
      vl.poolRank = MAX_ACTIVE + prepIdx + 1;
      vl.shadowTier = 'DISABLED';
      vl.shadowRank = undefined;
      vl.isShadowInRange = false;

      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        vl.targetMultiplier = 0.0;
        vl.lifecycleStage = 'FADING_OUT';
        vl.decisionText = `FADING OUT (STANDBY #${prepIdx + 1})`;
      } else {
        const oldSlot = this.lightPool.findSlotByUid(vl.entity.uid);
        if (oldSlot) {
          this.lightPool.forceHardRelease(oldSlot);
        }
        vl.targetMultiplier = 0.0;
        vl.currentMultiplier = 0.0;
        vl.lifecycleStage = 'PREPARED';
        vl.decisionText = `PREPARED #${prepIdx + 1} (LISTA PARA ROTACIÓN)`;
        vl.rejectionReason = 'PREPARED_IN_STANDBY';
      }
    });

    dormantCandidates.forEach((vl, dormIdx) => {
      vl.poolRank = MAX_ACTIVE + MAX_PREPARED + dormIdx + 1;
      vl.shadowTier = undefined;
      vl.shadowRank = undefined;
      vl.isShadowInRange = false;

      if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
        vl.targetMultiplier = 0.0;
        vl.lifecycleStage = 'FADING_OUT';
        vl.decisionText = 'FADING OUT (DORMANT)';
      } else {
        const oldSlot = this.lightPool.findSlotByUid(vl.entity.uid);
        if (oldSlot) {
          this.lightPool.forceHardRelease(oldSlot);
        }
        vl.targetMultiplier = 0.0;
        vl.currentMultiplier = 0.0;
        vl.lifecycleStage = 'INACTIVE';
        vl.rejectionReason = 'LOWER_PRIORITY_RANK';
        vl.decisionText = 'DORMANT (FUERA DE PRESUPUESTO)';
      }
    });

    activeVirtuals.forEach(vl => {
      if (!activeUids.has(vl.entity.uid) && !preparedCandidates.includes(vl) && !dormantCandidates.includes(vl)) {
        if (vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          vl.targetMultiplier = 0.0;
          vl.lifecycleStage = 'FADING_OUT';
        } else {
          vl.poolRank = 0;
          vl.shadowTier = undefined;
          vl.shadowRank = undefined;
          vl.isShadowInRange = false;
          vl.targetMultiplier = 0.0;
          vl.currentMultiplier = 0.0;
          vl.lifecycleStage = 'INACTIVE';
        }
      }
    });

    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, activeUids);
    });
  }
}