// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { 
  VirtualLight, PoolSlot, ShadowTier, ActiveLogicalSlot, 
  PreparedLogicalSlot, LIGHT_SPATIAL_CONSTANTS, LightEvictionReason,
  SpatialContextDomain 
} from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';
import { LightShadowService } from './light-shadow.service';
import { LightDistanceService } from './light-distance.service';
import { LightContainmentService } from './light-containment.service';
import { EngineProfilerService } from '../../../telemetry/engine-profiler.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);
  private lightShadows = inject(LightShadowService);
  private lightDistance = inject(LightDistanceService);
  private containmentSvc = inject(LightContainmentService);
  private profiler = inject(EngineProfilerService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  private activeSlots: ActiveLogicalSlot[] = [
    { id: 0, role: 'PRIMARY_PROTECTED_1', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 1, role: 'PRIMARY_PROTECTED_2', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 2, role: 'TARGET_ZONE_PRIMARY', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 3, role: 'TRANSITION_HANDOVER', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 }
  ];

  private preparedSlots: PreparedLogicalSlot[] = [
    { id: 4, candidateUid: null, score: 999999, isReady: false },
    { id: 5, candidateUid: null, score: 999999, isReady: false }
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
        this.profiler.recordTimelineEvent('LIGHT', 'LIGHT_SLOT_RELEASED', {
          slotId: slot.id,
          entityUid: uid,
          reason: 'EXPLICIT_RELEASE'
        }, {
          entityUid: uid,
          slotIndex: slot.id,
          reason: 'EXPLICIT_RELEASE'
        });

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
    const isInteriorConfirmed = macroZone === 'INTERIOR_ACTIVE';
    const dominantDomain: SpatialContextDomain = isInteriorConfirmed ? 'INTERIOR' : 'EXTERIOR';

    const currentlyAssignedUids = new Set<string>();
    for (const slot of this.activeSlots) {
      if (slot.assignedUid) {
        currentlyAssignedUids.add(slot.assignedUid);
      }
    }

    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      if (currentlyAssignedUids.has(vl.entity.uid)) {
        return true;
      }

      if (vl.isInterior) {
        if (dominantDomain === 'EXTERIOR') {
          return vl.inPreEntryZone || vl.spatialState === 'PRE_ENTRY' || vl._isInPrepareRange || vl.targetMultiplier > 0;
        }
        return vl.insideVolume || vl.inPreEntryZone || vl.inPreExitZone || vl._isInPrepareRange || vl.targetMultiplier > 0;
      }

      return vl.isLightInRange || vl._isInPrepareRange || vl.targetMultiplier > 0;
    });

    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInterior = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      
      let score = 0;

      if (isInterior) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = 5.0 + (boundaryDist * 1.0);
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = 8.0 + (boundaryDist * 0.5);
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 12.0 + (boundaryDist * 1.0);
        } else {
          score = 60.0 + (boundaryDist * 1.5);
        }
      } else {
        const dist = vl.effectiveDistance;
        score = dist * 1.0;

        if (vl.dotWithCameraForward !== undefined && vl.dotWithCameraForward < LIGHT_SPATIAL_CONSTANTS.BEHIND_CAMERA_DOT_THRESHOLD && dist > 20.0) {
          score += 30.0;
        }
      }

      if (currentlyAssignedUids.has(vl.entity.uid)) {
        score *= LIGHT_SPATIAL_CONSTANTS.STICKINESS_SCORE_MULTIPLIER;
      }

      if (selectedUid && vl.entity.uid === selectedUid) {
        score *= 0.1;
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    const primaryCandidates: VirtualLight[] = [];
    const targetCandidates: VirtualLight[] = [];

    for (let i = 0; i < validCandidates.length; i++) {
      const vl = validCandidates[i];
      if (dominantDomain === 'EXTERIOR') {
        if (!vl.isInterior) {
          primaryCandidates.push(vl);
        } else if (vl.inPreEntryZone || vl.spatialState === 'PRE_ENTRY' || vl._isInPrepareRange || vl.targetMultiplier > 0) {
          targetCandidates.push(vl);
        }
      } else {
        if (vl.isInterior && (vl.insideVolume || vl.spatialState === 'INSIDE' || vl.spatialState === 'PRE_EXIT')) {
          primaryCandidates.push(vl);
        } else {
          targetCandidates.push(vl);
        }
      }
    }

    primaryCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));
    targetCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    let desiredMainSlots: (VirtualLight | null)[];
    
    if (dominantDomain === 'EXTERIOR') {
      const hasCloseInteriorEntry = targetCandidates.length > 0 && (
        targetCandidates[0].inPreEntryZone || 
        targetCandidates[0].targetMultiplier > 0 ||
        (targetCandidates[0].distanceToBoundary ?? 99) <= 30.0
      );
      
      desiredMainSlots = [
        primaryCandidates[0] || null,
        primaryCandidates[1] || null,
        (hasCloseInteriorEntry ? targetCandidates[0] : (primaryCandidates[2] || targetCandidates[0] || null))
      ];
    } else {
      desiredMainSlots = [
        primaryCandidates[0] || null,
        primaryCandidates[1] || null,
        targetCandidates[0] || primaryCandidates[2] || null
      ];
    }

    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const slot = this.activeSlots[sIdx];
      const desiredCandidate = desiredMainSlots[sIdx];

      if (slot.assignedUid) {
        const occupant = activeVirtuals.find(v => v.entity.uid === slot.assignedUid) || null;

        if (!occupant || !occupant.entity.light || !occupant.entity.light.enabled) {
          this.executeSlotHandover(slot, occupant, activeVirtuals, now, 'DISABLED');
        } else if (slot.state === 'FADING_OUT') {
          const fadeOutTime = now - slot.lastStateChangeTime;
          if (occupant.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD || fadeOutTime > 700) {
            this.executeSlotHandover(slot, occupant, activeVirtuals, now, slot.pendingUid ? 'REPLACED_BY_HIGHER_PRIORITY' : 'OUT_OF_PROXIMITY');
          } else {
            const isRestored = desiredCandidate && desiredCandidate.entity.uid === occupant.entity.uid;
            if (isRestored && occupant.targetMultiplier > 0.00005) {
              slot.pendingUid = null;
              slot.state = 'FADING_IN';
              occupant.lifecycleStage = 'FADING_IN';
            }
          }
        } else if (slot.state === 'FADING_IN') {
          if (occupant.currentMultiplier >= (occupant.targetMultiplier - 0.03)) {
            slot.state = 'ACTIVE';
            occupant.lifecycleStage = 'ACTIVE';
          }
        } else if (slot.state === 'ACTIVE') {
          const isStillAssigned = desiredCandidate && desiredCandidate.entity.uid === occupant.entity.uid;

          if (!isStillAssigned) {
            if (desiredCandidate) {
              const holdTimeSatisfied = (now - slot.assignedTime) >= LIGHT_SPATIAL_CONSTANTS.MIN_SLOT_HOLD_TIME_MS;
              const isSignificantlyBetter = (desiredCandidate._sortScore ?? 0) < ((occupant._sortScore ?? 0) * LIGHT_SPATIAL_CONSTANTS.REPLACEMENT_SCORE_ADVANTAGE);
              const isOccupantOutOfRange = occupant.rejectionReason !== undefined && occupant.rejectionReason !== 'NONE';

              if ((holdTimeSatisfied && isSignificantlyBetter) || isOccupantOutOfRange) {
                const handoverSlot = this.activeSlots[3];
                const handoverOccupant = handoverSlot.assignedUid ? (activeVirtuals.find(v => v.entity.uid === handoverSlot.assignedUid) || null) : null;
                const isHandoverFree = handoverSlot.state === 'EMPTY' || (handoverOccupant !== null && handoverOccupant.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD);

                if (isHandoverFree) {
                  if (handoverSlot.assignedUid) {
                    this.executeSlotHandover(handoverSlot, handoverOccupant, activeVirtuals, now, 'TRANSITION_HANDOVER');
                  }
                  this.transferToHandoverSlot(slot, handoverSlot, occupant, now);
                } else {
                  slot.state = 'FADING_OUT';
                  slot.pendingUid = desiredCandidate.entity.uid;
                  slot.lastStateChangeTime = now;
                  occupant.targetMultiplier = 0.0;
                  occupant.lifecycleStage = 'FADING_OUT';
                }
              }
            } else {
              // No hay candidato que ocupe este slot (jugador se alejó a la oscuridad/exterior)
              const isOccupantOut = occupant.targetMultiplier === 0 || 
                                    occupant.lifecycleStage === 'OUTSIDE' || 
                                    occupant.lifecycleStage === 'INACTIVE' || 
                                    (occupant.rejectionReason !== undefined && occupant.rejectionReason !== 'NONE');
              if (isOccupantOut) {
                if (occupant.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
                  this.executeSlotHandover(slot, occupant, activeVirtuals, now, 'OUT_OF_PROXIMITY');
                } else {
                  slot.state = 'FADING_OUT';
                  slot.pendingUid = null;
                  slot.lastStateChangeTime = now;
                  occupant.targetMultiplier = 0.0;
                  occupant.lifecycleStage = 'FADING_OUT';
                }
              }
            }
          }
        }
      }
    }

    const handoverSlot = this.activeSlots[3];
    if (handoverSlot.assignedUid) {
      const occupant = activeVirtuals.find(v => v.entity.uid === handoverSlot.assignedUid) || null;
      const isFinished = !occupant || !occupant.entity.light?.enabled || occupant.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
      const isTimeout = (now - handoverSlot.lastStateChangeTime) > 750;

      if (isFinished || isTimeout) {
        this.executeSlotHandover(handoverSlot, occupant, activeVirtuals, now, 'TRANSITION_HANDOVER');
      }
    }

    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const slot = this.activeSlots[sIdx];
      const candidateToBind = desiredMainSlots[sIdx];

      if (slot.state === 'EMPTY' && candidateToBind) {
        let physicalToUse: PoolSlot | null = null;

        // 1. Si el candidato ya estaba asignado en el handoverSlot, promoverlo y reutilizarlo directamente
        const hSlot = this.activeSlots[3];
        if (hSlot.assignedUid === candidateToBind.entity.uid && hSlot.physicalSlot) {
          physicalToUse = hSlot.physicalSlot;
          hSlot.assignedUid = null;
          hSlot.physicalSlot = null;
          hSlot.state = 'EMPTY';
          hSlot.pendingUid = null;
        } else {
          // 2. Verificar si ya tiene un slot físico asignado en el pool para evitar asignaciones duales
          physicalToUse = this.lightPool.findSlotByUid(candidateToBind.entity.uid) || null;
          if (!physicalToUse) {
            const pool = this.lightPool.getPoolByType(candidateToBind.entity.type);
            physicalToUse = pool.find(s => s.assignedEntityUid === null) || null;
          }
        }

        if (physicalToUse) {
          physicalToUse.assignedEntityUid = candidateToBind.entity.uid;
          physicalToUse.logicalSlotIndex = slot.id;
          physicalToUse.currentIntensity = 0;
          physicalToUse.light.intensity = LIGHT_SPATIAL_CONSTANTS.PHYSICAL_IDLE_MIN_INTENSITY;
          physicalToUse.light.diffuse.set(0, 0, 0);
          physicalToUse.light.specular.set(0, 0, 0);
          physicalToUse._isNewAssignment = true;
          physicalToUse._framesSinceAssignment = 0;
          physicalToUse.isWarmedUp = false;

          slot.physicalSlot = physicalToUse;
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

    const assignedActiveSlots = this.activeSlots.filter(s => s.assignedUid !== null);
    assignedActiveSlots.sort((a, b) => {
      const vlA = activeVirtuals.find(v => v.entity.uid === a.assignedUid);
      const vlB = activeVirtuals.find(v => v.entity.uid === b.assignedUid);
      return (vlA?._sortScore ?? 0) - (vlB?._sortScore ?? 0);
    });

    const tiers: ShadowTier[] = ['HIGH', 'HIGH', 'MEDIUM', 'LOW'];
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
            const range = vl.entity.light?.range || 45;
            (slot.physicalSlot.light as any).range = range;
            slot.physicalSlot.light.shadowMaxZ = range;
          }
        }
      }
    });

    const activeUids = new Set(this.activeSlots.map(s => s.assignedUid).filter(Boolean) as string[]);
    const unassignedPrimary = primaryCandidates.filter(c => !activeUids.has(c.entity.uid));
    const unassignedTarget = targetCandidates.filter(c => !activeUids.has(c.entity.uid));
    const prepCandidates = [...unassignedPrimary, ...unassignedTarget].slice(0, LIGHT_SPATIAL_CONSTANTS.MAX_PREPARED_LIGHTS);

    for (let idx = 0; idx < this.preparedSlots.length; idx++) {
      const prepSlot = this.preparedSlots[idx];
      const vl = prepCandidates[idx];

      if (vl) {
        prepSlot.candidateUid = vl.entity.uid;
        prepSlot.score = vl._sortScore ?? 999999;
        prepSlot.isReady = true;

        vl.poolRank = 4 + idx + 1;
        vl.logicalSlotIndex = prepSlot.id;
        vl.shadowRank = undefined;
        vl.shadowTier = 'DISABLED';
        vl.isLightInRange = false;
        vl.isShadowInRange = false;
        vl.lifecycleStage = 'PREPARED';
        vl.decisionText = `PREPARADA (SLOT ${prepSlot.id})`;

        this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
        const range = vl.entity.light?.range || 45;
        this.lightShadows.prepareStaticCastersCache(vl.entity.uid, vl.entity.type, this._tempPos, range);
      } else {
        prepSlot.candidateUid = null;
        prepSlot.score = 999999;
        prepSlot.isReady = false;
      }
    }

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
  }

  private transferToHandoverSlot(
    sourceSlot: ActiveLogicalSlot,
    handoverSlot: ActiveLogicalSlot,
    occupant: VirtualLight,
    now: number
  ): void {
    handoverSlot.assignedUid = occupant.entity.uid;
    handoverSlot.physicalSlot = sourceSlot.physicalSlot;
    if (handoverSlot.physicalSlot) {
      handoverSlot.physicalSlot.logicalSlotIndex = handoverSlot.id;
    }
    handoverSlot.state = 'FADING_OUT';
    handoverSlot.assignedTime = sourceSlot.assignedTime;
    handoverSlot.lastStateChangeTime = now;
    handoverSlot.pendingUid = null;

    occupant.logicalSlotIndex = handoverSlot.id;
    occupant.targetMultiplier = 0.0;
    occupant.lifecycleStage = 'FADING_OUT';

    sourceSlot.assignedUid = null;
    sourceSlot.physicalSlot = null;
    sourceSlot.state = 'EMPTY';
    sourceSlot.pendingUid = null;
    sourceSlot.assignedTime = 0;
    sourceSlot.lastStateChangeTime = now;
  }

  private executeSlotHandover(
    slot: ActiveLogicalSlot, 
    outgoingVl: VirtualLight | null, 
    activeVirtuals: VirtualLight[], 
    now: number,
    evictionReason: LightEvictionReason = 'UNKNOWN'
  ): void {
    if (outgoingVl) {
      outgoingVl.currentMultiplier = 0.0;
      outgoingVl._lastRenderedMultiplier = 0.0;
      outgoingVl.isLightInRange = false;
      outgoingVl.isShadowInRange = false;
      outgoingVl.lifecycleStage = outgoingVl.isInterior ? 'OUTSIDE' : 'INACTIVE';
    }

    const oldPhysical = slot.physicalSlot;

    if (slot.pendingUid) {
      const incomingVl = activeVirtuals.find(v => v.entity.uid === slot.pendingUid);
      if (incomingVl && incomingVl.entity.light && incomingVl.entity.light.enabled) {
        let newPhysical: PoolSlot | null = null;
        const targetType = this.getPoolType(incomingVl.entity.type);

        if (oldPhysical && oldPhysical.type === targetType) {
          newPhysical = oldPhysical;
          // Limpiar de forma segura receptores previos y sombras del ocupante anterior
          if ((newPhysical.light as any).includedOnlyMeshes?.length > 0) {
            this.containmentSvc.clearContainment(newPhysical.light as any);
          }
          if (newPhysical.sg) {
            const sm = newPhysical.sg.getShadowMap();
            if (sm?.renderList) {
              sm.renderList.length = 0;
            }
          }
          newPhysical.dynamicCastersRegistered?.clear();
          newPhysical.hasDynamicCasters = false;
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
          newPhysical.light.intensity = LIGHT_SPATIAL_CONSTANTS.PHYSICAL_IDLE_MIN_INTENSITY;
          newPhysical.light.diffuse.set(0, 0, 0);
          newPhysical.light.specular.set(0, 0, 0);
          newPhysical._isNewAssignment = true;
          newPhysical._framesSinceAssignment = 0;
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