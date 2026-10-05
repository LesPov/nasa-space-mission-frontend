// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { VirtualLight, PoolSlot, ShadowTier, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);
  private ownership = inject(CameraOwnershipService);
  private spatialGroups = inject(SpatialStreamingGroupService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();
  private _cameraForward = Vector3.Zero();

  public allocatePoolSlots(
    activeVirtuals: VirtualLight[], 
    refPos: Vector3, 
    moveDir: Vector3, 
    speed: number, 
    selectedUid: string | null
  ): void {
    const lookAheadTime = Math.min(1.5, Math.max(0.4, speed * 0.12));
    const predictedPos = refPos.add(moveDir.scale(speed * lookAheadTime));

    const activeCam = this.ownership.getCamera();
    if (activeCam) {
      if (activeCam.getDirectionToRef) {
        activeCam.getDirectionToRef(Vector3.Forward(), this._cameraForward);
      } else {
        this._cameraForward.copyFrom(activeCam.getDirection(Vector3.Forward()));
      }
      this._cameraForward.y = 0;
      this._cameraForward.normalize();
    } else {
      this._cameraForward.set(0, 0, 1);
    }

    const assignedSet = new Set<string>();
    this.lightPool.getAllSlots().forEach(s => {
      if (s.assignedEntityUid) assignedSet.add(s.assignedEntityUid);
    });

    const activeGroupId = this.spatialGroups.getActiveGroupId();
    const preparedGroups = this.spatialGroups.getPreparedGroupIds();
    const preactivatingGroups = this.spatialGroups.getPreactivatingGroupIds();

    // 1. Filtrar candidatos válidos basados ESTRICTAMENTE en posición del Player/Actor y permanencia
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      // Inmunidad de desvanecimiento para luces que ya estaban en el pool y aún tienen presencia
      if (assignedSet.has(vl.entity.uid) && vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
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
        // En modo volumen interior, solo se descalifica si está totalmente fuera de la zona de retención
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

      const deact = vl.entity.light.deactivationDistance ?? ((vl.entity.light.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS) + 6.0);
      if (vl.effectiveDistance <= deact) return true;

      vl.rejectionReason = 'OUTSIDE_EFFECTIVE_RANGE';
      return false;
    });

    // 2. Cálculo determinista de Score espacial con bonificación de retención (Keep-Alive)
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);

      let score = 0;

      if (isInteriorVolumeMode) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = -50000 + boundaryDist;
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = -20000 + (boundaryDist * 10);
        } else if (vl.spatialState === 'PRE_EXIT') {
          // Puntuación favorable para pasillo anterior: compite limpiamente dentro de los 3 slots
          score = -15000 + (boundaryDist * 12);
        } else if (group && (preactivatingGroups.has(group.id) || group.isPredictedTarget)) {
          score = -5000 + (boundaryDist * 5);
        } else if (vl._isInPrepareRange) {
          score = 500 + (boundaryDist * 2);
        } else {
          score = 999999;
        }
      } else {
        const dist = vl.effectiveDistance;
        const distSq = dist * dist;
        const isFadingOut = assignedSet.has(vl.entity.uid) && vl.targetMultiplier === 0 && vl.currentMultiplier > 0.01;
        const predictedDistSq = isFadingOut ? distSq : Vector3.DistanceSquared(predictedPos, this._tempPos);

        score = (distSq * 0.6) + (predictedDistSq * 0.4);

        if (dist > 0.5) {
          const dirToLight = this._tempPos.subtract(refPos).normalize();
          const viewDot = Vector3.Dot(this._cameraForward, dirToLight);
          if (viewDot > 0.1) {
            score *= (1.0 - (viewDot * 0.25));
          } else if (viewDot < -0.1) {
            score *= (1.0 + (Math.abs(viewDot) * 0.25));
          }
        }
      }

      if (group) {
        if (group.id === activeGroupId) score *= 0.1;
        else if (preactivatingGroups.has(group.id) || group.isPredictedTarget) score *= 0.2;
        else if (preparedGroups.has(group.id)) score *= 0.4;
      }

      // Adherencia de slot (Slot Stickiness): reduce la alternancia entre pasillos contiguos
      if (assignedSet.has(vl.entity.uid)) {
        if (vl.isLightInRange || vl._isInPrepareRange || vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          score *= 0.70;
        }
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    // 3. Ordenar candidatos por prioridad física real
    validCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    // 4. Seleccionar el Top de luces para los slots físicos
    const topVirtuals = validCandidates.slice(0, LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS);
    const topUids = new Set(topVirtuals.map(x => x.entity.uid));

    validCandidates.slice(LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS).forEach((vl, idx) => {
      vl.rejectionReason = 'LOWER_PRIORITY_RANK';
      vl.poolRank = LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS + idx + 1;
      vl.shadowTier = undefined;
      vl.shadowRank = undefined;
    });

    activeVirtuals.forEach(vl => {
      if (!topUids.has(vl.entity.uid)) {
        if (!validCandidates.includes(vl)) {
          vl.poolRank = 0;
          vl.shadowTier = undefined;
          vl.shadowRank = undefined;
        }
      }
    });

    // 5. Liberar únicamente slots que salieron del Top y completaron su fade out
    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, topUids);
    });

    // 6. Asignación estable de slots
    const tiers: ShadowTier[] = ['HIGH', 'MEDIUM', 'LOW'];

    topVirtuals.forEach((vl, rankIndex) => {
      vl.poolRank = rankIndex + 1;
      vl.rejectionReason = undefined;

      const tier: ShadowTier = tiers[rankIndex];
      vl.shadowRank = rankIndex + 1;
      vl.shadowTier = tier;

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
          freeSlot.shadowTier = tier;
          existingSlot = freeSlot;
        } else {
          const replaceable = pool.find(s => !topUids.has(s.assignedEntityUid || ''));
          if (replaceable) {
            this.lightPool.forceHardRelease(replaceable);
            replaceable.assignedEntityUid = vl.entity.uid;
            replaceable.currentIntensity = 0;
            replaceable.light.intensity = 0;
            replaceable._isNewAssignment = true;
            replaceable.isWarmedUp = false;
            replaceable.shadowTier = tier;
            existingSlot = replaceable;
          }
        }
      }

      if (existingSlot) {
        existingSlot.shadowTier = tier;
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
  }
}