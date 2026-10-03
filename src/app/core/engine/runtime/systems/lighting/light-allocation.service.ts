// file: src/app/core/engine/runtime/systems/lighting/light-allocation.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight, Camera } from '@babylonjs/core';
import { VirtualLight, PoolSlot } from './lighting-types';
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
      const lookAheadTime = Math.min(2.5, Math.max(0.5, speed * 0.2));
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

      // 1. Scoring heurístico ponderado
      activeVirtuals.forEach(vl => {
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          const vecToLight = this._tempPos.subtract(refPos);
          const dist = vecToLight.length();
          const distSq = dist * dist;
          const predictedDistSq = Vector3.DistanceSquared(predictedPos, this._tempPos);
          
          let score = (distSq * 0.35) + (predictedDistSq * 0.45);

          // Ponderación por orientación de cámara (visión frontal vs detrás del jugador)
          if (dist > 0.1) {
            const dirToLight = vecToLight.normalizeToNew();
            const viewDot = Vector3.Dot(this._cameraForward, dirToLight);
            if (viewDot > 0.2) {
              score *= (1.0 - (viewDot * 0.4)); // Hasta un 40% de bonificación en cono de visión
            } else if (viewDot < -0.3) {
              score *= (1.0 + (Math.abs(viewDot) * 0.5)); // Penalización para luces traseras
            }
          }

          // Prioridad de contexto interior
          if (vl.isInterior && vl.insideVolume) {
              score *= 0.2; // Alta prioridad: luz del espacio actual
          } else if (vl.isInterior && vl.inPreEntryZone) {
              score *= 0.45;
          }

          // Inercia de movimiento
          if (speed > 0.5 && dist > 0.1) {
              const moveDot = Vector3.Dot(moveDir, vecToLight.normalizeToNew());
              if (moveDot > 0) {
                  score *= (1.0 - (moveDot * 0.3)); 
              } else {
                  score *= (1.0 + (Math.abs(moveDot) * 0.35)); 
              }
          }

          // Estabilidad (evitar fluctuaciones en los bordes)
          const isAssigned = assignedSet.has(vl.entity.uid);
          if (isAssigned) {
              score *= 0.35; 
              if (vl.currentMultiplier > 0.1) {
                  score *= 0.25; 
              }
          }
          
          if (selectedUid === vl.entity.uid) {
              score = -1; // Prioridad máxima en el editor
          }

          vl._sortScore = score;
      });

      // 2. Ranking global unificado
      activeVirtuals.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

      // REGLA: Exactamente 3 luces dinámicas locales activas en GPU simultáneamente
      const MAX_ACTIVE_LOCAL_LIGHTS = 3;
      const topVirtuals = activeVirtuals.slice(0, MAX_ACTIVE_LOCAL_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      activeVirtuals.forEach(vl => {
          vl.poolRank = 0;
      });

      // Liberar slots que salieron del Top 3
      this.lightPool.getAllSlots().forEach(s => {
          this.lightPool.releaseSlot(s, topUids);
      });

      // 3. Asignación ordenada en el pool
      topVirtuals.forEach((vl, rankIndex) => {
          vl.poolRank = rankIndex + 1;

          const pool = this.lightPool.getPoolByType(vl.entity.type);
          const wantsShadow = vl.isShadowInRange;

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