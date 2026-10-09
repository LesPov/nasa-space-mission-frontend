// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { 
  VirtualLight, PoolSlot, ShadowTier, ActiveLogicalSlot, 
  PreparedLogicalSlot, LIGHT_SPATIAL_CONSTANTS, LightEvictionReason, LightPromotionReason,
  SpatialContextDomain 
} from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';
import { LightShadowService } from './light-shadow.service';
import { LightDistanceService } from './light-distance.service';
import { EngineProfilerService } from '../../../telemetry/engine-profiler.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);
  private lightShadows = inject(LightShadowService);
  private lightDistance = inject(LightDistanceService);
  private profiler = inject(EngineProfilerService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  // Partición del Presupuesto Físico: 3 Slots Funcionales Principales + 1 Slot de Transición/Relevo
  private activeSlots: ActiveLogicalSlot[] = [
    { id: 0, role: 'PRIMARY_PROTECTED_1', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 1, role: 'PRIMARY_PROTECTED_2', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 2, role: 'TARGET_ZONE_PRIMARY', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 },
    { id: 3, role: 'TRANSITION_HANDOVER', assignedUid: null, physicalSlot: null, state: 'EMPTY', pendingUid: null, assignedTime: 0, lastStateChangeTime: 0 }
  ];

  // 2 Slots Lógicos de Preparación Anticipada (4 y 5)
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

    // 1. Determinar el Dominio Espacial Principal del Jugador
    const macroZone = this.lightDistance.getMacroZone();
    const isInteriorConfirmed = macroZone === 'INTERIOR_ACTIVE';
    const dominantDomain: SpatialContextDomain = isInteriorConfirmed ? 'INTERIOR' : 'EXTERIOR';

    const currentlyAssignedUids = new Set<string>();
    for (const slot of this.activeSlots) {
      if (slot.assignedUid) {
        currentlyAssignedUids.add(slot.assignedUid);
      }
    }

    // 2. Filtrado de candidatos elegibles
    const validCandidates = activeVirtuals.filter(vl => {
      if (!vl.entity.light || !vl.entity.light.enabled) {
        vl.rejectionReason = 'DISABLED';
        return false;
      }

      if (currentlyAssignedUids.has(vl.entity.uid)) {
        return true;
      }

      if (vl.isInterior) {
        // En exterior, las luces del pasillo SOLO compiten si el jugador está a las puertas (< 6 metros de la entrada)
        if (dominantDomain === 'EXTERIOR' && !vl.inPreEntryZone) {
          return false;
        }
        return vl.insideVolume || vl.inPreEntryZone || vl.inPreExitZone || vl._isInPrepareRange;
      }

      return vl.isLightInRange || vl._isInPrepareRange;
    });

    // 3. Cálculo de puntuación priorizada por distancia euclidiana pura
    validCandidates.forEach(vl => {
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
      const isInterior = vl.isInterior && vl.interiorActivationMode !== 'DISTANCE';
      
      let score = 0;

      if (isInterior) {
        const boundaryDist = vl.distanceToBoundary ?? 0;
        if (vl.spatialState === 'INSIDE') {
          score = 5.0 + (boundaryDist * 1.0);
        } else if (vl.spatialState === 'PRE_ENTRY') {
          score = 15.0 + (boundaryDist * 1.5);
        } else if (vl.spatialState === 'PRE_EXIT') {
          score = 25.0 + (boundaryDist * 1.5);
        } else {
          score = 80.0 + (boundaryDist * 2.0);
        }
      } else {
        // Luces exteriores: puntuación directa por distancia
        const dist = vl.effectiveDistance;
        score = dist * 1.0;

        if (vl.dotWithCameraForward !== undefined && vl.dotWithCameraForward < LIGHT_SPATIAL_CONSTANTS.BEHIND_CAMERA_DOT_THRESHOLD && dist > 20.0) {
          score += 30.0;
        }
      }

      // Histéresis de retención firme
      if (currentlyAssignedUids.has(vl.entity.uid)) {
        score *= LIGHT_SPATIAL_CONSTANTS.STICKINESS_SCORE_MULTIPLIER;
      }

      if (selectedUid && vl.entity.uid === selectedUid) {
        score *= 0.1;
      }

      vl._sortScore = parseFloat(score.toFixed(2));
    });

    // 4. Separación de Candidatos por Dominio
    const primaryCandidates: VirtualLight[] = [];
    const targetCandidates: VirtualLight[] = [];

    for (let i = 0; i < validCandidates.length; i++) {
      const vl = validCandidates[i];
      if (dominantDomain === 'EXTERIOR') {
        if (!vl.isInterior) {
          primaryCandidates.push(vl); // Postes de luz de la calle
        } else if (vl.inPreEntryZone || vl.spatialState === 'PRE_ENTRY') {
          targetCandidates.push(vl);  // Entrada al pasillo
        }
      } else {
        // En el interior del pasillo
        if (vl.isInterior && (vl.insideVolume || vl.spatialState === 'INSIDE' || vl.spatialState === 'PRE_EXIT')) {
          primaryCandidates.push(vl);
        } else {
          targetCandidates.push(vl);
        }
      }
    }

    primaryCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));
    targetCandidates.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

    // 5. ASIGNACIÓN JUSTA DE SLOTS:
    // Si estás en el EXTERIOR y tienes 3 postes cercanos, ¡los 3 postes deben encenderse!
    // Solo si una luz interior está verdaderamente en PRE_ENTRY (< 8m), ocupa el Slot 2.
    let desiredMainSlots: (VirtualLight | null)[];
    
    if (dominantDomain === 'EXTERIOR') {
      const hasCloseInteriorEntry = targetCandidates.length > 0 && (targetCandidates[0].distanceToBoundary ?? 99) <= 8.0;
      
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

    // 6. Transición y Protección en los Slots Funcionales Principales (0, 1, 2)
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
            this.executeSlotHandover(slot, occupant, activeVirtuals, now, 'REPLACED_BY_HIGHER_PRIORITY');
          } else {
            const isRestored = desiredCandidate && desiredCandidate.entity.uid === occupant.entity.uid;
            if (isRestored && occupant.targetMultiplier > 0.01) {
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

          if (!isStillAssigned && desiredCandidate) {
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
          }
        }
      }
    }

    // 7. Mantenimiento del Slot 3 (Puesto Transitorio de Relevo)
    const handoverSlot = this.activeSlots[3];
    if (handoverSlot.assignedUid) {
      const occupant = activeVirtuals.find(v => v.entity.uid === handoverSlot.assignedUid) || null;
      const isFinished = !occupant || !occupant.entity.light?.enabled || occupant.currentMultiplier <= LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
      const isTimeout = (now - handoverSlot.lastStateChangeTime) > 750;

      if (isFinished || isTimeout) {
        this.executeSlotHandover(handoverSlot, occupant, activeVirtuals, now, 'TRANSITION_HANDOVER');
      }
    }

    // 8. Vinculación de Slots Vacíos a los Candidatos Deseados
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const slot = this.activeSlots[sIdx];
      const candidateToBind = desiredMainSlots[sIdx];

      if (slot.state === 'EMPTY' && candidateToBind) {
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

    // 9. Estratificación de Sombras
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

    // 10. Slots de Preparación Anticipada (Slots 4 y 5)
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

    // 11. Limpieza de luces inactivas
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