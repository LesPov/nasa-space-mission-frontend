
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

  public allocatePoolSlots(
    activeVirtuals: VirtualLight[], 
    refPos: Vector3, 
    moveDir: Vector3, 
    speed: number, 
    selectedUid: string | null
  ): void {
    const lookAheadTime = Math.min(1.5, Math.max(0.4, speed * 0.12));
    const predictedPos = refPos.add(moveDir.scale(speed * lookAheadTime));

    const assignedSet = new Set<string>();
    this.lightPool.getAllSlots().forEach(s => {
      if (s.assignedEntityUid) assignedSet.add(s.assignedEntityUid);
    });

    const activeGroupId = this.spatialGroups.getActiveGroupId();
    const preparedGroups = this.spatialGroups.getPreparedGroupIds();
    const preactivatingGroups = this.spatialGroups.getPreactivatingGroupIds();

    // 1. Filtrar candidatos válidos
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      // Stickiness para luces activas desvaneciéndose
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
        // 🔥 REGLA DE PRIORIDAD: Si está fuera del volumen interior y no es prioritario, descartarlo.
        // Nunca compite contra exteriores si el Player está fuera de su pasillo.
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

    // 2. Cálculo de Score Espacial Unificado
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);

      let score = 0;

      // Base Scoring Positivo: Menor es más prioritario
      if (isInteriorVolumeMode) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = 0; // Prioridad Absoluta
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = 100 + (boundaryDist * 10); // Muy Alta Prioridad
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 500 + (boundaryDist * 20); // Prioridad Media
        } else if (group && (preactivatingGroups.has(group.id) || group.isPredictedTarget)) {
          // Luz interior, el Player está fuera, pero se acerca al contenedor.
          // Prioridad BAJA (peor que exteriores activos) para no robar slots, pero lista para saltar.
          score = 5000 + (boundaryDist * 25); 
        } else if (vl._isInPrepareRange) {
          score = 10000 + (boundaryDist * 20);
        } else {
          score = 999999;
        }
      } else {
        const dist = vl.effectiveDistance;
        const distSq = dist * dist;
        const isFadingOut = assignedSet.has(vl.entity.uid) && vl.targetMultiplier === 0 && vl.currentMultiplier > 0.01;
        const predictedDistSq = isFadingOut ? distSq : Vector3.DistanceSquared(predictedPos, this._tempPos);

        if (vl.targetMultiplier > 0 || (vl.isLightInRange && !isFadingOut)) {
          // Luces Exteriores Activas
          score = 1000 + (distSq * 0.6) + (predictedDistSq * 0.4);
        } else {
          // Luces Exteriores Inactivas
          score = 5000 + (distSq * 0.6) + (predictedDistSq * 0.4);
        }
      }

      // Slot Stickiness para evitar Churn
      if (assignedSet.has(vl.entity.uid)) {
        if (vl.isLightInRange || vl._isInPrepareRange || vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          score *= 0.85; 
        }
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    // 3. Ordenar candidatos por prioridad (menor score = mejor ranking)
    validCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    // 4. Seleccionar el Top de luces para los slots físicos
    const poolSize = LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS; // 4 Slots (3 full, 1 fade)
    const activeAllowed = 3; 

    const topVirtuals = validCandidates.slice(0, poolSize);
    const topUids = new Set(topVirtuals.map(x => x.entity.uid));

    // Candidatos Descartados por Ranking Inferior
    validCandidates.slice(poolSize).forEach((vl, idx) => {
      vl.rejectionReason = 'LOWER_PRIORITY_RANK';
      vl.poolRank = poolSize + idx + 1;
      vl.shadowTier = undefined;
      vl.shadowRank = undefined;
      
      if (vl.targetMultiplier > 0) {
        vl.targetMultiplier = 0.0;
        if (vl.lifecycleStage === 'ACTIVE' || vl.lifecycleStage === 'FADING_IN') {
           vl.previousLifecycleStage = vl.lifecycleStage;
           vl.lifecycleStage = 'FADING_OUT';
           vl.decisionText = 'FADING OUT (BUMPED FROM POOL)';
        }
      }
    });

    // Limpieza de estados huérfanos
    activeVirtuals.forEach(vl => {
      if (!topUids.has(vl.entity.uid)) {
        if (!validCandidates.includes(vl)) {
          vl.poolRank = 0;
          vl.shadowTier = undefined;
          vl.shadowRank = undefined;
          if (vl.targetMultiplier > 0) {
             vl.targetMultiplier = 0.0;
             if (vl.lifecycleStage === 'ACTIVE' || vl.lifecycleStage === 'FADING_IN') {
                vl.previousLifecycleStage = vl.lifecycleStage;
                vl.lifecycleStage = 'FADING_OUT';
                vl.decisionText = 'FADING OUT (REMOVED)';
             }
          }
        }
      }
    });

    // 5. Liberar slots excedentes
    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, topUids);
    });

    // 6. Asignación estable en Pool Físico
    const tiers: ShadowTier[] = ['HIGH', 'MEDIUM', 'LOW', 'LOW'];

    topVirtuals.forEach((vl, rankIndex) => {
      vl.poolRank = rankIndex + 1;

      // 🔥 REGLA DE LA LUZ EXPULSADA: El 4to slot se apaga forzosamente
      if (rankIndex >= activeAllowed) {
         if (vl.targetMultiplier > 0) {
            vl.rejectionReason = 'FADING_OUT_TRANSITION';
            vl.targetMultiplier = 0.0;
            if (vl.lifecycleStage === 'ACTIVE' || vl.lifecycleStage === 'FADING_IN') {
               vl.previousLifecycleStage = vl.lifecycleStage;
               vl.lifecycleStage = 'FADING_OUT';
               vl.decisionText = 'FADING OUT (4TH SLOT)';
            }
         }
         vl.isShadowInRange = false;
         vl.shadowTier = undefined;
      } else {
         vl.rejectionReason = undefined;
         const tier: ShadowTier = tiers[rankIndex];
         vl.shadowRank = rankIndex + 1;
         vl.shadowTier = tier;
      }

      const pool = this.lightPool.getPoolByType(vl.entity.type);
      if (pool.length === 0) return;

      let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

      if (!existingSlot) {
        const freeSlot = pool.find(s => s.assignedEntityUid === null);
        if (freeSlot) {
          freeSlot.assignedEntityUid = vl.entity.uid;
          freeSlot.currentIntensity = 0;
          freeSlot.light.intensity = 0;
          if (!freeSlot.light.isEnabled()) freeSlot.light.setEnabled(true);
          freeSlot._isNewAssignment = true;
          freeSlot.isWarmedUp = false;
          freeSlot.shadowTier = vl.shadowTier;
          existingSlot = freeSlot;
        } else {
          const replaceable = pool.find(s => !topUids.has(s.assignedEntityUid || ''));
          if (replaceable) {
            this.lightPool.forceHardRelease(replaceable);
            replaceable.assignedEntityUid = vl.entity.uid;
            replaceable.currentIntensity = 0;
            replaceable.light.intensity = 0;
            if (!replaceable.light.isEnabled()) replaceable.light.setEnabled(true);
            replaceable._isNewAssignment = true;
            replaceable.isWarmedUp = false;
            replaceable.shadowTier = vl.shadowTier;
            existingSlot = replaceable;
          }
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
    });
  }
}