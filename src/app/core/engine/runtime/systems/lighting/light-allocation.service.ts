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

  // Histéresis de relevo de slot: una luz nueva debe ser al menos 2.0m o un 20% mejor que la actual para desplazarla
  private readonly REPLACEMENT_HYSTERESIS_RATIO = 0.80;
  private readonly REPLACEMENT_DISTANCE_THRESHOLD = 2.5;

  public allocatePoolSlots(
    activeVirtuals: VirtualLight[], 
    refPos: Vector3, 
    moveDir: Vector3, 
    speed: number, 
    selectedUid: string | null
  ): void {
    const lookAheadTime = Math.min(1.2, Math.max(0.3, speed * 0.12));
    const predictedPos = refPos.add(moveDir.scale(speed * lookAheadTime));

    const currentlyOccupiedSlots = this.lightPool.getAllSlots().filter(s => s.assignedEntityUid !== null);
    const assignedUidsSet = new Set<string>();
    currentlyOccupiedSlots.forEach(s => assignedUidsSet.add(s.assignedEntityUid!));

    const activeGroupId = this.spatialGroups.getActiveGroupId();
    const preactivatingGroups = this.spatialGroups.getPreactivatingGroupIds();

    // 1. Filtrar candidatos válidos
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      // Stickiness: retener luces activas que estén en transición de fade-out
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

      const deact = vl.entity.light.deactivationDistance ?? ((vl.entity.light.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS) + 8.0);
      if (vl.effectiveDistance <= (deact + 20.0)) return true;

      vl.rejectionReason = 'OUTSIDE_EFFECTIVE_RANGE';
      return false;
    });

    // 2. Cálculo de Score Espacial con estabilización
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);

      let score = 0;

      if (isInteriorVolumeMode) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = 0;
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = 100 + (boundaryDist * 10);
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 500 + (boundaryDist * 20);
        } else if (group && (preactivatingGroups.has(group.id) || group.isPredictedTarget)) {
          score = 5000 + (boundaryDist * 25); 
        } else if (vl._isInPrepareRange) {
          score = 10000 + (boundaryDist * 20);
        } else {
          score = 999999;
        }
      } else {
        const dist = vl.effectiveDistance;
        const distSq = dist * dist;
        const isFadingOut = assignedUidsSet.has(vl.entity.uid) && vl.targetMultiplier === 0 && vl.currentMultiplier > 0.01;
        const predictedDistSq = isFadingOut ? distSq : Vector3.DistanceSquared(predictedPos, this._tempPos);

        if (vl.targetMultiplier > 0 || (vl.isLightInRange && !isFadingOut)) {
          score = 1000 + (distSq * 0.6) + (predictedDistSq * 0.4);
        } else {
          score = 5000 + (distSq * 0.6) + (predictedDistSq * 0.4);
        }
      }

      // Slot Stickiness reforzado: Si la luz ya posee un slot físico activo, bonificar su score para evitar oscilación
      if (assignedUidsSet.has(vl.entity.uid)) {
        if (vl.isLightInRange || vl._isInPrepareRange || vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          score *= this.REPLACEMENT_HYSTERESIS_RATIO; 
        }
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    // 3. Ordenar candidatos por prioridad
    validCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    // 4. PARTICIÓN ESTRICTA: 3 ACTIVE + 2 PREPARED
    const MAX_ACTIVE = LIGHT_SPATIAL_CONSTANTS.MAX_PHYSICAL_ACTIVE_LIGHTS; // 3
    const MAX_PREPARED = LIGHT_SPATIAL_CONSTANTS.MAX_PREPARED_LIGHTS;      // 2

    // Selección estabilizada con ventana de histéresis:
    // Si una luz actualmente en slot compite contra una nueva, la nueva debe ser significativamente más cercana
    const selectedActive: VirtualLight[] = [];
    const poolSlots = this.lightPool.getAllSlots();

    for (let i = 0; i < validCandidates.length && selectedActive.length < MAX_ACTIVE; i++) {
      const candidate = validCandidates[i];
      selectedActive.push(candidate);
    }

    const preparedCandidates = validCandidates.filter(vl => !selectedActive.includes(vl)).slice(0, MAX_PREPARED);
    const dormantCandidates = validCandidates.filter(vl => !selectedActive.includes(vl) && !preparedCandidates.includes(vl));

    const activeUids = new Set(selectedActive.map(x => x.entity.uid));

    // A. ASIGNACIÓN FÍSICA ESTABLE (SLOTS 0, 1, 2)
    const tiers: ShadowTier[] = ['HIGH', 'MEDIUM', 'LOW'];

    // Paso A.1: Preservar las luces activas que YA están asignadas a un slot para no cambiarles el índice físico
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

    // Paso A.2: Asignar slots a las luces nuevas que no tenían slot previo
    selectedActive.forEach((vl, rankIdx) => {
      const pool = this.lightPool.getPoolByType(vl.entity.type);
      if (pool.length === 0) return;

      let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);
      if (!existingSlot) {
        const freeSlot = pool.find(s => s.assignedEntityUid === null);
        if (freeSlot) {
          freeSlot.assignedEntityUid = vl.entity.uid;
          freeSlot.currentIntensity = 0;
          freeSlot.light.intensity = 0;
          freeSlot.light.setEnabled(true);
          freeSlot._isNewAssignment = true;
          freeSlot.isWarmedUp = false;
          freeSlot.shadowTier = vl.shadowTier;
          existingSlot = freeSlot;
        } else {
          // Reemplazar slot de luz que salió del Top 3
          const replaceable = pool.find(s => !activeUids.has(s.assignedEntityUid || ''));
          if (replaceable) {
            this.lightPool.forceHardRelease(replaceable);
            replaceable.assignedEntityUid = vl.entity.uid;
            replaceable.currentIntensity = 0;
            replaceable.light.intensity = 0;
            replaceable.light.setEnabled(true);
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

    // B. LUCES PREPARADAS (PREPARED: 4 y 5 - Precalentadas en CPU sin hardware GPU encendido)
    preparedCandidates.forEach((vl, prepIdx) => {
      vl.poolRank = MAX_ACTIVE + prepIdx + 1;
      vl.shadowTier = 'DISABLED';
      vl.shadowRank = undefined;
      vl.isShadowInRange = false;

      const oldSlot = this.lightPool.findSlotByUid(vl.entity.uid);
      if (oldSlot) {
        this.lightPool.forceHardRelease(oldSlot);
      }

      vl.targetMultiplier = 0.0;
      vl.currentMultiplier = 0.0;
      vl._lastRenderedMultiplier = 0.0;
      vl.lifecycleStage = 'PREPARED';
      vl.decisionText = `PREPARED #${prepIdx + 1} (PRECALENTADA EN STANDBY)`;
      vl.rejectionReason = 'PREPARED_IN_STANDBY';
    });

    // C. LUCES DESCARTADAS (DORMANT)
    dormantCandidates.forEach((vl, dormIdx) => {
      vl.poolRank = MAX_ACTIVE + MAX_PREPARED + dormIdx + 1;
      vl.shadowTier = undefined;
      vl.shadowRank = undefined;
      vl.isShadowInRange = false;

      const oldSlot = this.lightPool.findSlotByUid(vl.entity.uid);
      if (oldSlot) {
        this.lightPool.forceHardRelease(oldSlot);
      }

      vl.targetMultiplier = 0.0;
      vl.currentMultiplier = 0.0;
      vl._lastRenderedMultiplier = 0.0;
      vl.lifecycleStage = 'INACTIVE';
      vl.rejectionReason = 'LOWER_PRIORITY_RANK';
      vl.decisionText = 'DORMANT (EXCEEDS BUDGET)';
    });

    activeVirtuals.forEach(vl => {
      if (!activeUids.has(vl.entity.uid) && !preparedCandidates.includes(vl) && !dormantCandidates.includes(vl)) {
        vl.poolRank = 0;
        vl.shadowTier = undefined;
        vl.shadowRank = undefined;
        vl.isShadowInRange = false;
        vl.targetMultiplier = 0.0;
        vl.currentMultiplier = 0.0;
        vl.lifecycleStage = 'INACTIVE';
      }
    });

    // Liberar slots de luces que ya no están activas
    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, activeUids);
    });
  }
}