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

  private readonly REPLACEMENT_HYSTERESIS_RATIO = 0.82;

  public allocatePoolSlots(
    activeVirtuals: VirtualLight[], 
    refPos: Vector3, 
    moveDir: Vector3, 
    speed: number, 
    selectedUid: string | null
  ): void {
    // Proyección frontal basada en velocidad (Lookahead Direccional de 10m a 45m)
    const lookAheadTime = Math.min(1.8, Math.max(0.5, speed * 0.15));
    const lookAheadDist = Math.min(45.0, Math.max(8.0, speed * lookAheadTime * 2.0));
    const predictedPos = refPos.add(moveDir.scale(lookAheadDist));

    const currentlyOccupiedSlots = this.lightPool.getAllSlots().filter(s => s.assignedEntityUid !== null);
    const assignedUidsSet = new Set<string>();
    currentlyOccupiedSlots.forEach(s => assignedUidsSet.add(s.assignedEntityUid!));

    const activeGroupId = this.spatialGroups.getActiveGroupId();
    const preactivatingGroups = this.spatialGroups.getPreactivatingGroupIds();

    // Determinar si el jugador se encuentra actualmente dentro de una zona interior
    let isPlayerInsideInterior = false;
    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      if (vl.isInterior && vl.spatialState === 'INSIDE') {
        isPlayerInsideInterior = true;
        break;
      }
    }

    // 1. Filtrar candidatos válidos
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

      const deact = vl.entity.light.deactivationDistance ?? ((vl.entity.light.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS) + 8.0);
      if (vl.effectiveDistance <= (deact + 25.0)) return true;

      vl.rejectionReason = 'OUTSIDE_EFFECTIVE_RANGE';
      return false;
    });

    // 2. Scoring espacial continuo con semántica Interior vs Exterior
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInteriorVolumeMode = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      const group = this.spatialGroups.getGroupForEntity(vl.entity.uid);

      let score = 0;

      if (isInteriorVolumeMode) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = 0; // Prioridad absoluta
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = 80 + (boundaryDist * 8);
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 450 + (boundaryDist * 15);
        } else if (group && (preactivatingGroups.has(group.id) || group.isPredictedTarget)) {
          score = 2500 + (boundaryDist * 20); 
        } else if (vl._isInPrepareRange) {
          score = 6000 + (boundaryDist * 20);
        } else {
          score = 999999;
        }
      } else {
        const dist = vl.effectiveDistance;
        const distSq = dist * dist;
        const isFadingOut = assignedUidsSet.has(vl.entity.uid) && vl.targetMultiplier === 0 && vl.currentMultiplier > 0.01;
        const predictedDistSq = isFadingOut ? distSq : Vector3.DistanceSquared(predictedPos, this._tempPos);

        // Alineación direccional con el vector de avance
        let directionalDotBonus = 1.0;
        if (speed > 0.2 && dist > 1.0) {
          const toLightDir = this._tempPos.subtract(refPos).normalize();
          const dot = Vector3.Dot(moveDir, toLightDir);
          if (dot > 0.3) {
            directionalDotBonus = Math.max(0.65, 1.0 - (dot * 0.35)); // Hasta 35% de ventaja por alineación frontal
          } else if (dot < -0.3) {
            directionalDotBonus = 1.35; // Penalización por quedar atrás
          }
        }

        if (vl.targetMultiplier > 0 || (vl.isLightInRange && !isFadingOut)) {
          score = 1000 + ((distSq * 0.55) + (predictedDistSq * 0.45)) * directionalDotBonus;
        } else {
          score = 5000 + ((distSq * 0.55) + (predictedDistSq * 0.45)) * directionalDotBonus;
        }

        // PENALIZACIÓN EXTERIOR: Si el jugador está dentro de un interior, relegar luces globales
        if (isPlayerInsideInterior) {
          score += 35000;
        }
      }

      // Slot Stickiness: bonificación para evitar oscilación en bordes
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

    const selectedActive: VirtualLight[] = [];
    for (let i = 0; i < validCandidates.length && selectedActive.length < MAX_ACTIVE; i++) {
      selectedActive.push(validCandidates[i]);
    }

    const preparedCandidates = validCandidates.filter(vl => !selectedActive.includes(vl)).slice(0, MAX_PREPARED);
    const dormantCandidates = validCandidates.filter(vl => !selectedActive.includes(vl) && !preparedCandidates.includes(vl));

    const activeUids = new Set(selectedActive.map(x => x.entity.uid));
    const tiers: ShadowTier[] = ['HIGH', 'MEDIUM', 'LOW'];

    // Paso A.1: Sincronizar luces activas que ya conservaban su slot
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

    // Paso A.2: Asignar slots libres a nuevas luces activas
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

    // B. LUCES PREPARADAS (PREPARED: 4 y 5 - Precalentadas en CPU listas para rotación inmediata)
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
      vl.decisionText = `PREPARED #${prepIdx + 1} (LISTA PARA ROTACIÓN)`;
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
      vl.decisionText = 'DORMANT (FUERA DE PRESUPUESTO)';
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

    this.lightPool.getAllSlots().forEach(s => {
      this.lightPool.releaseSlot(s, activeUids);
    });
  }
}