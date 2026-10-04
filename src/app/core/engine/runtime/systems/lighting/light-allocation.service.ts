// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { VirtualLight, PoolSlot, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);
  private ownership = inject(CameraOwnershipService);

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
    const lookAheadTime = Math.min(1.5, Math.max(0.3, speed * 0.15));
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

    // 1. Filtrar candidatos según su rango de activación individual real
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }
      if (vl.entity.uid === selectedUid) return true;
      if (vl.isLightInRange || vl._isInPrepareRange) return true;
      
      const deact = vl.entity.light.deactivationDistance ?? (vl.entity.light.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS) + 5.0;
      if (vl.effectiveDistance <= deact) return true;

      vl.rejectionReason = 'OUTSIDE_EFFECTIVE_RANGE';
      return false;
    });

    // 2. Priorización dinámica y predictiva
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const vecToLight = this._tempPos.subtract(refPos);
      const dist = vl.effectiveDistance;
      const distSq = dist * dist;
      const predictedDistSq = Vector3.DistanceSquared(predictedPos, this._tempPos);

      let score = (distSq * 0.6) + (predictedDistSq * 0.4);

      if (dist > 0.5) {
        const dirToLight = vecToLight.normalizeToNew();
        const viewDot = Vector3.Dot(this._cameraForward, dirToLight);
        if (viewDot > 0.2) {
          score *= (1.0 - (viewDot * 0.25));
        } else if (viewDot < -0.2) {
          score *= (1.0 + (Math.abs(viewDot) * 0.25));
        }
      }

      if (vl.isInterior && vl.insideVolume) {
        score *= 0.35;
      } else if (vl.isInterior && vl.inPreEntryZone) {
        score *= 0.60;
      }

      // Histéresis de retención
      const isAssigned = assignedSet.has(vl.entity.uid);
      if (isAssigned && vl.currentMultiplier > 0.02) {
        score *= 0.80;
      }

      if (selectedUid === vl.entity.uid) {
        score = -999999;
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    // 3. Ordenamiento por Score ascendente
    validCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    // 4. Selección del TOP 3 de hardware
    const topVirtuals = validCandidates.slice(0, LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS);
    const topUids = new Set(topVirtuals.map(x => x.entity.uid));

    validCandidates.slice(LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS).forEach((vl, idx) => {
      vl.rejectionReason = 'LOWER_PRIORITY_RANK';
      vl.poolRank = LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS + idx + 1;
    });

    let shadowsAssignedCount = 0;

    activeVirtuals.forEach(vl => {
      if (!topUids.has(vl.entity.uid)) {
        if (!validCandidates.includes(vl)) {
          vl.poolRank = 0;
        }
      }
    });

    // 5. Liberar slots que salieron del Top 3
    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, topUids);
    });

    // 6. Asignar slots a las luces ganadoras
    topVirtuals.forEach((vl, rankIndex) => {
      vl.poolRank = rankIndex + 1;
      vl.rejectionReason = undefined;

      const pool = this.lightPool.getPoolByType(vl.entity.type);
      const wantsShadow = vl.isShadowInRange && (shadowsAssignedCount < LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_SHADOWS);
      if (wantsShadow) {
        shadowsAssignedCount++;
      } else {
        vl.isShadowInRange = false;
      }

      let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

      if (!existingSlot) {
        let freeSlot: PoolSlot | null = null;
        if (wantsShadow) {
          freeSlot = pool.find(s => s.sg !== null && s.assignedEntityUid === null) || null;
        }
        if (!freeSlot) {
          freeSlot = pool.find(s => s.assignedEntityUid === null) || null;
        }

        if (freeSlot) {
          freeSlot.assignedEntityUid = vl.entity.uid;
          freeSlot.currentIntensity = 0;
          freeSlot.light.intensity = 0;
          freeSlot._isNewAssignment = true;
          freeSlot.isWarmedUp = false;
          existingSlot = freeSlot;
        }
      }

      if (existingSlot) {
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