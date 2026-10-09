// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { 
  VirtualLight, PoolSlot, ShadowTier, ActiveLogicalSlot, 
  PreparedLogicalSlot, LIGHT_SPATIAL_CONSTANTS 
} from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';
import { SpatialStreamingGroupService } from '../../../spatial/spatial-streaming-group.service';
import { LightShadowService } from './light-shadow.service';
import { LightDistanceService } from './light-distance.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);
  private spatialGroups = inject(SpatialStreamingGroupService);
  private lightShadows = inject(LightShadowService);
  private lightDistance = inject(LightDistanceService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  private activeSlots: ActiveLogicalSlot[] = [
    { id: 0, assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 1, assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 2, assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 }
  ];

  private preparedSlots: PreparedLogicalSlot[] = [
    { id: 3, candidateUid: null, score: 999999, isReady: false },
    { id: 4, candidateUid: null, score: 999999, isReady: false }
  ];

  public getActiveSlots(): ActiveLogicalSlot[] {
    return this.activeSlots;
  }

  public getPreparedSlots(): PreparedLogicalSlot[] {
    return this.preparedSlots;
  }

  public hasPendingTransitions(): boolean {
    return this.activeSlots.some(s => s.state === 'FADING_OUT' || s.state === 'FADING_IN' || s.pendingUid !== null);
  }

  public reset(): void {
    for (const slot of this.activeSlots) {
      if (slot.physicalSlot) {
        this.lightPool.forceHardRelease(slot.physicalSlot);
      }
      slot.assignedUid = null;
      slot.physicalSlot = null;
      slot.state = 'EMPTY';
      slot.pendingUid = null;
      slot.assignedTime = 0;
      slot.lastStateChangeTime = 0;
    }
    for (const prep of this.preparedSlots) {
      prep.candidateUid = null;
      prep.score = 999999;
      prep.isReady = false;
    }
  }

  public releaseEntity(uid: string): void {
    for (const slot of this.activeSlots) {
      if (slot.assignedUid === uid) {
        if (slot.physicalSlot) {
          this.lightPool.forceHardRelease(slot.physicalSlot);
        }
        slot.assignedUid = null;
        slot.physicalSlot = null;
        slot.state = 'EMPTY';
        slot.pendingUid = null;
      }
      if (slot.pendingUid === uid) {
        slot.pendingUid = null;
      }
    }
    for (const prep of this.preparedSlots) {
      if (prep.candidateUid === uid) {
        prep.candidateUid = null;
        prep.score = 999999;
        prep.isReady = false;
      }
    }
  }

  private getPoolType(entityType: string): 'point' | 'spot' | 'directional' {
    if (entityType === 'light_point') return 'point';
    if (entityType === 'light_spot') return 'spot';
    if (entityType === 'light_directional') return 'directional';
    return 'point';
  }

  public allocatePoolSlots(
    activeVirtuals: VirtualLight[], 
    refPos: Vector3, 
    moveDir: Vector3, 
    speed: number, 
    selectedUid: string | null
  ): void {
    const now = performance.now();
    const macroZone = this.lightDistance.getMacroZone();

    const currentlyAssignedUids = new Set<string>();
    for (const slot of this.activeSlots) {
      if (slot.assignedUid) {
        currentlyAssignedUids.add(slot.assignedUid);
      }
    }

    // 1. Filtrado de candidatos con elegibilidad de macro-zona
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      if (vl.rejectionReason === 'TOPOLOGICALLY_DISCONNECTED') {
        if (!currentlyAssignedUids.has(vl.entity.uid)) {
          return false;
        }
      }

      if (currentlyAssignedUids.has(vl.entity.uid)) {
        return true;
      }

      // Si el jugador está en el EXTERIOR, las luces interiores fuera de preentrada
      // van directo a preparación, no compiten por slots activos
      if (macroZone === 'EXTERIOR' && vl.isInterior) {
        if (!vl.inPreEntryZone && !vl.insideVolume) {
          return false; // Candidata a preparación en slots 3 y 4
        }
      }

      if (vl.isLightInRange || vl._isInPrepareRange) {
        return true;
      }

      return false;
    });

    // 2. Cálculo de puntuación priorizada por Macro-Zona
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInterior = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      const hop = vl.topologicalHop ?? 0;

      let score = 0;

      if (isInterior) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        
        if (vl.spatialState === 'INSIDE') {
          score = (macroZone === 'INTERIOR_ACTIVE') ? 5 + (boundaryDist * 2) : 50 + (boundaryDist * 2);
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = (macroZone === 'EXTERIOR') ? 120 + (boundaryDist * 4) : 25 + (boundaryDist * 3);
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 40 + (boundaryDist * 3);
        } else if (vl._isInPrepareRange) {
          score = 400 + (boundaryDist * 5);
        } else {
          score = 999999;
        }

        score += hop * 2000;
      } else {
        // Luces exteriores (GLOBAL): Prioridad máxima en el EXTERIOR
        const dist = vl.effectiveDistance;
        let baseScore = (macroZone === 'EXTERIOR') ? 5.0 : 80.0;
        score = baseScore + (dist * 1.2);
      }

      // Inercia de permanencia (Stickiness)
      if (currentlyAssignedUids.has(vl.entity.uid)) {
        score *= LIGHT_SPATIAL_CONSTANTS.STICKINESS_SCORE_MULTIPLIER;
      }

      if (selectedUid && vl.entity.uid === selectedUid) {
        score *= 0.5;
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    validCandidates.sort((a, b) => {
      const diff = (a._sortScore ?? 0) - (b._sortScore ?? 0);
      if (Math.abs(diff) > 0.01) return diff;
      return a.entity.uid.localeCompare(b.entity.uid);
    });

    const MAX_ACTIVE = LIGHT_SPATIAL_CONSTANTS.MAX_PHYSICAL_ACTIVE_LIGHTS; // 3
    const desiredActiveCandidates = validCandidates.slice(0, MAX_ACTIVE);
    const desiredPreparedCandidates = validCandidates.slice(MAX_ACTIVE, MAX_ACTIVE + LIGHT_SPATIAL_CONSTANTS.MAX_PREPARED_LIGHTS);

    // 3. Máquina de estados de los 3 slots activos
    for (let i = 0; i < this.activeSlots.length; i++) {
      const slot = this.activeSlots[i];

      if (slot.assignedUid) {
        const occupant = activeVirtuals.find(v => v.entity.uid === slot.assignedUid);

        if (!occupant || !occupant.entity.light || !occupant.entity.light.enabled) {
          this.executeSlotHandover(slot, occupant || null, activeVirtuals, now);
        } else if (slot.state === 'FADING_OUT') {
          const fadeOutTime = now - slot.lastStateChangeTime;
          if (occupant.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD || fadeOutTime > 800) {
            this.executeSlotHandover(slot, occupant, activeVirtuals, now);
          } else {
            const isBackInTop = desiredActiveCandidates.some(c => c.entity.uid === occupant.entity.uid);
            if (isBackInTop && occupant.targetMultiplier > 0.01) {
              slot.pendingUid = null;
              slot.state = 'FADING_IN';
              occupant.lifecycleStage = 'FADING_IN';
            }
          }
        } else if (slot.state === 'FADING_IN') {
          if (occupant.currentMultiplier >= (occupant.targetMultiplier - 0.02)) {
            slot.state = 'ACTIVE';
            occupant.lifecycleStage = 'ACTIVE';
          }
        } else if (slot.state === 'ACTIVE') {
          const isStillInTop = desiredActiveCandidates.some(c => c.entity.uid === occupant.entity.uid);
          if (!isStillInTop) {
            const candidateToPromote = desiredActiveCandidates.find(c =>
              !this.activeSlots.some(s => s.assignedUid === c.entity.uid || s.pendingUid === c.entity.uid)
            );

            if (candidateToPromote) {
              const holdTimeSatisfied = (now - slot.assignedTime) >= LIGHT_SPATIAL_CONSTANTS.MIN_SLOT_HOLD_TIME_MS;
              const isSignificantlyBetter = (candidateToPromote._sortScore ?? 0) < ((occupant._sortScore ?? 0) * LIGHT_SPATIAL_CONSTANTS.REPLACEMENT_SCORE_ADVANTAGE);
              const isOccupantOutOfRange = occupant.rejectionReason !== undefined && occupant.rejectionReason !== 'NONE';

              if ((holdTimeSatisfied && isSignificantlyBetter) || isOccupantOutOfRange) {
                slot.state = 'FADING_OUT';
                slot.pendingUid = candidateToPromote.entity.uid;
                slot.lastStateChangeTime = now;

                occupant.targetMultiplier = 0.0;
                occupant.lifecycleStage = 'FADING_OUT';

                candidateToPromote.lifecycleStage = 'PREPARED';
              }
            }
          }
        }
      }
    }

    // Asignación de slots vacíos (conservando targetMultiplier calculado espacialmente)
    for (let i = 0; i < this.activeSlots.length; i++) {
      const slot = this.activeSlots[i];
      if (slot.state === 'EMPTY') {
        const candidateToBind = desiredActiveCandidates.find(c =>
          !this.activeSlots.some(s => s.assignedUid === c.entity.uid || s.pendingUid === c.entity.uid)
        );

        if (candidateToBind) {
          const pool = this.lightPool.getPoolByType(candidateToBind.entity.type);
          const freeSlot = pool.find(s => s.assignedEntityUid === null);

          if (freeSlot) {
            freeSlot.assignedEntityUid = candidateToBind.entity.uid;
            freeSlot.logicalSlotIndex = slot.id;
            freeSlot.currentIntensity = 0;
            freeSlot.light.intensity = 0;
            freeSlot._isNewAssignment = true;
            freeSlot.isWarmedUp = false;

            slot.physicalSlot = freeSlot;
            slot.assignedUid = candidateToBind.entity.uid;
            slot.pendingUid = null;
            slot.state = 'FADING_IN';
            slot.assignedTime = now;
            slot.lastStateChangeTime = now;

            candidateToBind.logicalSlotIndex = slot.id;
            candidateToBind.lifecycleStage = 'FADING_IN';
            candidateToBind.isLightInRange = true;
          }
        }
      }
    }

    // 4. Asignación de Tiers de sombra a slots activos
    const assignedActiveSlots = this.activeSlots.filter(s => s.assignedUid !== null);
    assignedActiveSlots.sort((a, b) => {
      const vlA = activeVirtuals.find(v => v.entity.uid === a.assignedUid);
      const vlB = activeVirtuals.find(v => v.entity.uid === b.assignedUid);
      return (vlA?._sortScore ?? 0) - (vlB?._sortScore ?? 0);
    });

    const tiers: ShadowTier[] = ['HIGH', 'MEDIUM', 'LOW'];
    assignedActiveSlots.forEach((slot, rankIdx) => {
      const vl = activeVirtuals.find(v => v.entity.uid === slot.assignedUid);
      if (vl) {
        vl.poolRank = rankIdx + 1;
        vl.logicalSlotIndex = slot.id;
        vl.shadowRank = rankIdx + 1;
        vl.shadowTier = tiers[rankIdx];
        if (slot.physicalSlot) {
          slot.physicalSlot.shadowTier = tiers[rankIdx];
          slot.physicalSlot.logicalSlotIndex = slot.id;

          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          slot.physicalSlot.light.position.copyFrom(this._tempPos);

          if (slot.physicalSlot.type === 'spot') {
            const spot = slot.physicalSlot.light as SpotLight;
            spot.direction.copyFrom(this._tempDir);
            spot.angle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
          } else if (slot.physicalSlot.type === 'directional') {
            const dirL = slot.physicalSlot.light as DirectionalLight;
            dirL.direction.copyFrom(this._tempDir);
          }

          if (slot.physicalSlot.type !== 'directional') {
            const range = vl.entity.light?.range || 50;
            (slot.physicalSlot.light as any).range = range;
            slot.physicalSlot.light.shadowMaxZ = range;
          }
        }
      }
    });

    // 5. Gestión de los 2 Slots de Preparación (3 y 4)
    const activeUids = new Set(this.activeSlots.map(s => s.assignedUid).filter(Boolean) as string[]);
    const prepCandidates = desiredPreparedCandidates.filter(c => !activeUids.has(c.entity.uid)).slice(0, 2);

    for (let idx = 0; idx < this.preparedSlots.length; idx++) {
      const prepSlot = this.preparedSlots[idx];
      const vl = prepCandidates[idx];

      if (vl) {
        prepSlot.candidateUid = vl.entity.uid;
        prepSlot.score = vl._sortScore ?? 999999;
        prepSlot.isReady = true;

        vl.poolRank = 3 + idx + 1;
        vl.logicalSlotIndex = prepSlot.id;
        vl.shadowRank = undefined;
        vl.shadowTier = 'DISABLED';
        vl.isLightInRange = false;
        vl.isShadowInRange = false;
        vl.lifecycleStage = 'PREPARED';

        this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
        const range = vl.entity.light?.range || 50;
        this.lightShadows.prepareStaticCastersCache(vl.entity.uid, vl.entity.type, this._tempPos, range);
      } else {
        prepSlot.candidateUid = null;
        prepSlot.score = 999999;
        prepSlot.isReady = false;
      }
    }

    // 6. Limpieza de luces inactivas
    const prepUids = new Set(this.preparedSlots.map(p => p.candidateUid).filter(Boolean) as string[]);
    activeVirtuals.forEach(vl => {
      if (!activeUids.has(vl.entity.uid) && !prepUids.has(vl.entity.uid)) {
        vl.poolRank = 0;
        vl.logicalSlotIndex = null;
        vl.shadowRank = undefined;
        vl.shadowTier = undefined;
        vl.isLightInRange = false;
        vl.isShadowInRange = false;
        vl.targetMultiplier = 0.0;
        if (vl.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
          vl.currentMultiplier = 0.0;
          vl.lifecycleStage = 'INACTIVE';
        }
      }
    });

    // 7. Salvaguarda estricta
    const activePhysicalSlots = this.lightPool.getAllSlots().filter(s => s.assignedEntityUid !== null && s.currentIntensity > 0);
    if (activePhysicalSlots.length > LIGHT_SPATIAL_CONSTANTS.MAX_PHYSICAL_ACTIVE_LIGHTS) {
      activePhysicalSlots.sort((a, b) => a.currentIntensity - b.currentIntensity);
      while (activePhysicalSlots.length > LIGHT_SPATIAL_CONSTANTS.MAX_PHYSICAL_ACTIVE_LIGHTS) {
        const excess = activePhysicalSlots.shift();
        if (excess) {
          this.lightPool.forceHardRelease(excess);
        }
      }
    }
  }

  private executeSlotHandover(
    slot: ActiveLogicalSlot, 
    outgoingVl: VirtualLight | null, 
    activeVirtuals: VirtualLight[], 
    now: number
  ): void {
    if (outgoingVl) {
      outgoingVl.currentMultiplier = 0.0;
      outgoingVl._lastRenderedMultiplier = 0.0;
      outgoingVl.isLightInRange = false;
      outgoingVl.isShadowInRange = false;
      outgoingVl.lifecycleStage = outgoingVl.isInterior ? 'OUTSIDE' : 'INACTIVE';
      outgoingVl.decisionText = 'RELEVADA Y APAGADA';
    }

    const oldPhysical = slot.physicalSlot;

    if (slot.pendingUid) {
      const incomingVl = activeVirtuals.find(v => v.entity.uid === slot.pendingUid);
      if (incomingVl && incomingVl.entity.light && incomingVl.entity.light.enabled) {
        let newPhysical: PoolSlot | null = null;
        const targetType = this.getPoolType(incomingVl.entity.type);

        if (oldPhysical && oldPhysical.type === targetType) {
          newPhysical = oldPhysical;
        } else {
          if (oldPhysical) {
            this.lightPool.forceHardRelease(oldPhysical);
          }
          const pool = this.lightPool.getPoolByType(incomingVl.entity.type);
          newPhysical = pool.find(s => s.assignedEntityUid === null) || null;
        }

        if (newPhysical) {
          newPhysical.assignedEntityUid = incomingVl.entity.uid;
          newPhysical.logicalSlotIndex = slot.id;
          newPhysical.currentIntensity = 0;
          newPhysical.light.intensity = 0;
          newPhysical._isNewAssignment = true;
          newPhysical.isWarmedUp = false;

          slot.physicalSlot = newPhysical;
          slot.assignedUid = incomingVl.entity.uid;
          slot.pendingUid = null;
          slot.state = 'FADING_IN';
          slot.assignedTime = now;
          slot.lastStateChangeTime = now;

          incomingVl.logicalSlotIndex = slot.id;
          incomingVl.lifecycleStage = 'FADING_IN';
          incomingVl.isLightInRange = true;
          incomingVl.decisionText = `PROMOCIONADA A SLOT ${slot.id} (ENCENDIENDO)`;
          return;
        }
      }
    }

    if (oldPhysical) {
      this.lightPool.forceHardRelease(oldPhysical);
    }
    slot.physicalSlot = null;
    slot.assignedUid = null;
    slot.pendingUid = null;
    slot.state = 'EMPTY';
    slot.lastStateChangeTime = now;
  }
}