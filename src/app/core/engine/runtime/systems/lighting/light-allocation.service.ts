
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { VirtualLight, PoolSlot } from './lighting-types';
import { LightPoolService } from './light-pool.service';
import { LightTransformService } from './light-transform.service';

@Injectable({ providedIn: 'root' })
export class LightAllocationService {
  private lightPool = inject(LightPoolService);
  private lightTransform = inject(LightTransformService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public allocatePoolSlots(
      activeVirtuals: VirtualLight[], 
      refPos: Vector3, 
      moveDir: Vector3, 
      speed: number, 
      selectedUid: string | null
  ): void {
      const lookAheadTime = Math.min(2.0, speed * 0.15);
      const predictedPos = refPos.add(moveDir.scale(speed * lookAheadTime));

      const assignedSet = new Set<string>();
      this.lightPool.getAllSlots().forEach(s => {
          if (s.assignedEntityUid) assignedSet.add(s.assignedEntityUid);
      });

      // 1. Ponderación y ordenación de candidatos
      activeVirtuals.forEach(vl => {
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          const vecToLight = this._tempPos.subtract(refPos);
          const distSq = vecToLight.lengthSquared();
          const predictedDistSq = Vector3.DistanceSquared(predictedPos, this._tempPos);
          
          let score = (distSq * 0.4) + (predictedDistSq * 0.6);

          // Bonificación contextual para luces interiores activas donde está el actor
          if (vl.isInterior && vl.insideVolume) {
              score *= 0.25; // Prioridad alta: ilumina el espacio actual del jugador
          } else if (vl.isInterior && vl.inPreEntryZone) {
              score *= 0.50; // Pre-entrada relevante
          }

          if (speed > 0.5) {
              vecToLight.normalize();
              const dot = Vector3.Dot(moveDir, vecToLight);
              if (dot > 0) {
                  score *= (1.0 - (dot * 0.3)); 
              } else {
                  score *= (1.0 + (Math.abs(dot) * 0.3)); 
              }
          }

          const isAssigned = assignedSet.has(vl.entity.uid);
          if (isAssigned) {
              score *= 0.4; 
              if (vl.currentMultiplier > 0.8) {
                  score *= 0.3; 
              }
          }
          
          if (selectedUid === vl.entity.uid) {
              score = -1; // Máxima prioridad si el usuario la tiene seleccionada en el editor
          }

          vl._sortScore = score;
      });

      // 2. Ranking global unificado (Sin segregación de tipos)
      activeVirtuals.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

      // REGLA ABSOLUTA: Un único corte global de MÁXIMO 3 luces dinámicas locales
      const MAX_ACTIVE_LOCAL_LIGHTS = 3;
      const topVirtuals = activeVirtuals.slice(0, MAX_ACTIVE_LOCAL_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      // Resetear rankings de todas las luces virtuales
      activeVirtuals.forEach(vl => {
          vl.poolRank = 0;
      });

      // Liberar cualquier slot que ya no esté en el Top 3
      this.lightPool.getAllSlots().forEach(s => {
          this.lightPool.releaseSlot(s, topUids);
      });

      // 3. Asignación atómica de slots para el Top 3
      topVirtuals.forEach((vl, rankIndex) => {
          vl.poolRank = rankIndex + 1;

          const pool = this.lightPool.getPoolByType(vl.entity.type);
          const wantsShadow = vl.isShadowInRange;

          let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

          if (!existingSlot) {
              // Buscar primero slot con shadow generator si se requieren sombras
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