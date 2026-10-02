
import { Injectable, inject } from '@angular/core';
import { Vector3, SpotLight, DirectionalLight } from '@babylonjs/core';
import { VirtualLight } from './lighting-types';
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

      activeVirtuals.forEach(vl => {
          this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          const vecToLight = this._tempPos.subtract(refPos);
          const distSq = vecToLight.lengthSquared();
          const predictedDistSq = Vector3.DistanceSquared(predictedPos, this._tempPos);
          
          let score = (distSq * 0.4) + (predictedDistSq * 0.6);

          if (speed > 0.5) {
              vecToLight.normalize();
              const dot = Vector3.Dot(moveDir, vecToLight);
              if (dot > 0) {
                  score *= (1.0 - (dot * 0.4)); 
              } else {
                  score *= (1.0 + (Math.abs(dot) * 0.4)); 
              }
          }

          const isAssigned = assignedSet.has(vl.entity.uid);
          if (isAssigned) {
              score *= 0.3; 
              if (vl.currentMultiplier > 0.8) {
                  score *= 0.2; 
              } else if (vl.currentMultiplier > 0.1) {
                  score *= 0.5;
              }
          }
          
          if (selectedUid === vl.entity.uid) {
              score = -1; 
          }

          vl._sortScore = score;
      });

      activeVirtuals.sort((a, b) => (a._sortScore ?? 0) - (b._sortScore ?? 0));

      const pointVirtuals = activeVirtuals.filter(vl => vl.entity.type === 'light_point');
      const spotVirtuals = activeVirtuals.filter(vl => vl.entity.type === 'light_spot');
      const dirVirtuals = activeVirtuals.filter(vl => vl.entity.type === 'light_directional');

      const topPoint = pointVirtuals.slice(0, this.lightPool.getPointPool().length);
      const topSpot = spotVirtuals.slice(0, this.lightPool.getSpotPool().length);
      const topDir = dirVirtuals.slice(0, this.lightPool.getDirPool().length);

      const topVirtuals = [...topPoint, ...topSpot, ...topDir];
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      this.lightPool.getPointPool().forEach(s => this.lightPool.releaseSlot(s, topUids));
      this.lightPool.getSpotPool().forEach(s => this.lightPool.releaseSlot(s, topUids));
      this.lightPool.getDirPool().forEach(s => this.lightPool.releaseSlot(s, topUids));

      topVirtuals.forEach(vl => {
          const pool = this.lightPool.getPoolByType(vl.entity.type);
          const wantsShadow = vl.isShadowInRange;

          let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

          if (!existingSlot) {
              let freeSlot = null;
              if (wantsShadow) freeSlot = pool.find(s => s.sg !== null && s.assignedEntityUid === null);
              if (!freeSlot) freeSlot = pool.find(s => s.sg === null && s.assignedEntityUid === null);
              if (!freeSlot) freeSlot = pool.find(s => s.assignedEntityUid === null);

              if (freeSlot) {
                  freeSlot.assignedEntityUid = vl.entity.uid;
                  freeSlot.currentIntensity = 0; freeSlot.light.intensity = 0; 
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