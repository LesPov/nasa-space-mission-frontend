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
    const lookAheadTime = Math.min(2.0, Math.max(0.5, speed * 0.2));
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

    // 1. Filtrado de candidatos válidos
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      if (vl.entity.uid === selectedUid) return true;

      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      if (isInteriorVolumeMode) {
        if (vl.spatialState === 'OUTSIDE') {
          vl.rejectionReason = 'OUTSIDE_INTERIOR_VOLUME';
          vl.targetMultiplier = 0.0;
          vl.isLightInRange = false;
          vl.isShadowInRange = false;
          return false;
        }
      }

      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);
      const isGroupActiveOrPrepared = group && (group.id === activeGroupId || preparedGroups.has(group.id));

      if (isGroupActiveOrPrepared) return true;
      if (vl.isLightInRange || vl._isInPrepareRange) return true;

      const deact = vl.entity.light.deactivationDistance ?? ((vl.entity.light.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS) + 6.0);
      if (vl.effectiveDistance <= deact) return true;

      vl.rejectionReason = 'OUTSIDE_EFFECTIVE_RANGE';
      return false;
    });

    // 2. Cálculo determinista de prioridad y Score
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';

      let score = 0;

      if (isInteriorVolumeMode) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = -50000 + boundaryDist;
        } else if (vl.spatialState === 'PRE_ENTRY' || vl.spatialState === 'PRE_EXIT') {
          score = -10000 + (boundaryDist * 10);
        } else {
          score = 999999;
        }
      } else {
        const dist = vl.effectiveDistance;
        const distSq = dist * dist;
        const predictedDistSq = Vector3.DistanceSquared(predictedPos, this._tempPos);

        score = (distSq * 0.5) + (predictedDistSq * 0.5);

        if (dist > 0.5) {
          const dirToLight = this._tempPos.subtract(refPos).normalize();
          const viewDot = Vector3.Dot(this._cameraForward, dirToLight);
          if (viewDot > 0.1) {
            score *= (1.0 - (viewDot * 0.3));
          } else if (viewDot < -0.1) {
            score *= (1.0 + (Math.abs(viewDot) * 0.3));
          }
        }
      }

      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);
      if (group) {
        if (group.id === activeGroupId) {
          score *= 0.1;
        } else if (preparedGroups.has(group.id)) {
          score *= 0.3;
        }
      }

      // Inmunidad a los valles de pulso/flicker: la luz conserva su slot si está en rango espacial
      if (assignedSet.has(vl.entity.uid) && vl.isLightInRange) {
        score *= 0.5; // Fuerte retención de slot
      }

      if (selectedUid === vl.entity.uid) {
        score = -999999;
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    // 3. Ordenar por score ascendente
    validCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    // 4. Seleccionar el Top 3 estricto
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

    // 5. Liberar slots que salieron del Top 3
    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, topUids);
    });

    // 6. Asignar slots de forma estable evitando intercambios innecesarios entre luces
    topVirtuals.forEach((vl, rankIndex) => {
      vl.poolRank = rankIndex + 1;
      vl.rejectionReason = undefined;

      const tier: ShadowTier = rankIndex === 0 ? 'HIGH' : (rankIndex === 1 ? 'MEDIUM' : 'LOW');
      vl.shadowRank = rankIndex + 1;
      vl.shadowTier = tier;

      const pool = this.lightPool.getPoolByType(vl.entity.type);
      let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

      // Si la luz ya tiene un slot en este pool, MANTENERLA en ese slot (no rotar índices)
      if (!existingSlot) {
        let freeSlot: PoolSlot | null = null;
        
        // Si requiere sombras y el slot maestro 0 está libre, tomar el slot 0
        if (vl.isShadowInRange && pool[0] && pool[0].assignedEntityUid === null) {
          freeSlot = pool[0];
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
          freeSlot.shadowTier = tier;
          existingSlot = freeSlot;
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