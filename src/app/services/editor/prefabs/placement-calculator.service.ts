
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Ray, Scene, Tags, Mesh, Quaternion, Matrix } from '@babylonjs/core';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

export interface PlacementResult {
  position: Vector3;
  rotation: Vector3;
  color: 'green' | 'yellow' | 'blue' | 'red';
  parent: AbstractMesh | null;
  debugTargetPos?: Vector3;
  debugGhostPos?: Vector3;
}

@Injectable({ providedIn: 'root' })
export class PlacementCalculatorService {
  private entityManager = inject(EntityManagerService);

  private resolveEntityMesh(mesh: AbstractMesh): AbstractMesh {
      let current: any = mesh;
      while (current && current.name !== '__root__') {
          const entity = this.entityManager.getEntityByMesh(current);
          if (entity && entity.view) return entity.view as AbstractMesh;
          current = current.parent;
      }
      return mesh;
  }

  private getLocalBoundingInfo(targetMesh: AbstractMesh): { min: Vector3, max: Vector3, center: Vector3 } {
    let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new Vector3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);
    let hasValidMesh = false;

    const childMeshes = targetMesh.getChildMeshes(false);
    const allMeshes = targetMesh instanceof Mesh ? [targetMesh, ...childMeshes] : childMeshes;

    targetMesh.computeWorldMatrix(true);
    const invWorld = targetMesh.getWorldMatrix().clone().invert();

    allMeshes.forEach(m => {
        if (!m.isVisible || m.getTotalVertices() === 0) return;
        if (Tags.MatchesQuery(m, "system_element || fog_element || editor_only || proxy_collider || ghost_preview")) return;

        m.computeWorldMatrix(true);
        const vectorsWorld = m.getBoundingInfo().boundingBox.vectorsWorld;
        vectorsWorld.forEach(vw => {
            const vLocal = Vector3.TransformCoordinates(vw, invWorld);
            min = Vector3.Minimize(min, vLocal);
            max = Vector3.Maximize(max, vLocal);
        });
        hasValidMesh = true;
    });

    if (!hasValidMesh) { min = Vector3.Zero(); max = Vector3.Zero(); }
    return { min, max, center: max.add(min).scale(0.5) };
  }

  private getDynamicConnectors(localMin: Vector3, localMax: Vector3) {
    const center = localMin.add(localMax).scale(0.5);
    return [
      { id: 'FRONT',  localPos: new Vector3(center.x, localMin.y, localMax.z), localNormal: new Vector3(0,0,1) },
      { id: 'BACK',   localPos: new Vector3(center.x, localMin.y, localMin.z), localNormal: new Vector3(0,0,-1) },
      { id: 'RIGHT',  localPos: new Vector3(localMax.x, localMin.y, center.z), localNormal: new Vector3(1,0,0) },
      { id: 'LEFT',   localPos: new Vector3(localMin.x, localMin.y, center.z), localNormal: new Vector3(-1,0,0) },
      { id: 'TOP',    localPos: new Vector3(center.x, localMax.y, center.z), localNormal: new Vector3(0,1,0) },
      { id: 'BOTTOM', localPos: new Vector3(center.x, localMin.y, center.z), localNormal: new Vector3(0,-1,0) }
    ];
  }

  public calculatePlacement(
    scene: Scene,
    ray: Ray,
    playerMesh: AbstractMesh | null | undefined,
    currentRotation: Vector3,
    ghostScale: Vector3,
    isAltPressed: boolean,
    isGPressed: boolean,
    isFPressed: boolean,
    buildDistance: number,
    ghostConnIndex: number,
    ghostLocalBoundsGetter: () => { min: Vector3, max: Vector3 } | null,
    manualOffset: Vector3 // 🔥 NUEVO: Recibe el offset manual
  ): PlacementResult {
    
    let rawResult: PlacementResult;

    const hit = scene.pickWithRay(ray, (mesh) => {
      if (!mesh.isPickable || !mesh.isVisible) return false;
      if (Tags.MatchesQuery(mesh, "ghost_preview || proxy_collider || fog_element || debug_element")) return false;
      if (Tags.MatchesQuery(mesh, "system_element") && !Tags.MatchesQuery(mesh, "invisible_floor")) return false;
      if (playerMesh && (mesh === playerMesh || mesh.isDescendantOf(playerMesh))) return false;
      return true;
    });

    const ghostLocalBounds = ghostLocalBoundsGetter();

    if (hit && hit.hit && hit.pickedMesh && hit.pickedPoint && hit.getNormal) {
      const normal = hit.getNormal(true, true) || Vector3.Up();
      const pickedPoint = hit.pickedPoint.clone();
      const rootMesh = this.resolveEntityMesh(hit.pickedMesh);
      const snapNormal = this.getCardinalNormal(normal);

      if (isFPressed && ghostLocalBounds) {
        const restPos = this.calculateSurfaceRestPosition(pickedPoint, snapNormal, ghostLocalBounds, currentRotation, ghostScale);
        rawResult = { position: restPos, rotation: currentRotation.clone(), color: 'yellow', parent: null };
      }
      else if (isAltPressed && rootMesh && ghostLocalBounds) {
        rawResult = this.calculateModularSnap(rootMesh, ghostLocalBounds, currentRotation, ghostScale, pickedPoint, ghostConnIndex);
      } else {
        rawResult = { position: pickedPoint, rotation: currentRotation.clone(), color: 'green', parent: null };
      }
    } 
    else {
      const defaultPos = ray.origin.add(ray.direction.scale(buildDistance));
      
      if (isAltPressed && playerMesh && ghostLocalBounds) {
          const referenceMesh = this.findMeshUnderPlayer(scene, playerMesh);
          if (referenceMesh) {
              rawResult = this.calculateModularSnapFallback(referenceMesh, ghostLocalBounds, currentRotation, ghostScale, ray.direction, ghostConnIndex);
          } else {
              rawResult = { position: defaultPos, rotation: currentRotation.clone(), color: 'green', parent: null };
          }
      } else {
          rawResult = { position: defaultPos, rotation: currentRotation.clone(), color: 'green', parent: null };
      }
    }

    // 🔥 APLICAR OFFSET MANUAL EN ESPACIO LOCAL 
    // Esto garantiza que si mueves X hacia la "derecha", sea la derecha DEL GHOST, sin importar si lo rotaste.
    if (!manualOffset.equals(Vector3.Zero())) {
        const rotQuat = Quaternion.FromEulerAngles(rawResult.rotation.x, rawResult.rotation.y, rawResult.rotation.z);
        const rotMatrix = new Matrix();
        rotQuat.toRotationMatrix(rotMatrix);
        
        // Transformar el Vector Local del Offset al Espacio Mundial (alineado al Ghost)
        const worldOffset = Vector3.TransformCoordinates(manualOffset, rotMatrix);
        
        // Sumar al resultado final
        rawResult.position.addInPlace(worldOffset);

        // Si tenemos marcadores visuales debug, moverlos también para que el punto visual coincida
        if (rawResult.debugGhostPos) {
            rawResult.debugGhostPos.addInPlace(worldOffset);
        }
    }

    return rawResult;
  }

  private calculateModularSnap(
      targetMesh: AbstractMesh, ghostBounds: { min: Vector3, max: Vector3 }, 
      baseRotation: Vector3, ghostScale: Vector3, hitPoint: Vector3, ghostConnIndex: number
  ): PlacementResult {
      
      const targetBounds = this.getLocalBoundingInfo(targetMesh);
      const targetConnectorsLocal = this.getDynamicConnectors(targetBounds.min, targetBounds.max);
      targetMesh.computeWorldMatrix(true);
      const targetWorldMatrix = targetMesh.getWorldMatrix();
      
      const targetConnectorsWorld = targetConnectorsLocal.map(c => ({
          pos: Vector3.TransformCoordinates(c.localPos, targetWorldMatrix),
          normal: Vector3.TransformNormal(c.localNormal, targetWorldMatrix).normalize()
      }));

      let bestTargetConn = targetConnectorsWorld[0];
      let minDist = Number.MAX_VALUE;
      for (const tc of targetConnectorsWorld) {
          const d = Vector3.DistanceSquared(tc.pos, hitPoint);
          if (d < minDist) { minDist = d; bestTargetConn = tc; }
      }

      const ghostConnectorsLocal = this.getDynamicConnectors(ghostBounds.min, ghostBounds.max);
      let selectedGhostConnLocal;
      let finalYaw = baseRotation.y;

      if (ghostConnIndex !== -1 && ghostConnIndex < ghostConnectorsLocal.length) {
          selectedGhostConnLocal = ghostConnectorsLocal[ghostConnIndex];
          
          if (Math.abs(bestTargetConn.normal.y) < 0.5) { 
              const angleTarget = Math.atan2(-bestTargetConn.normal.x, -bestTargetConn.normal.z);
              const angleLocal = Math.atan2(selectedGhostConnLocal.localNormal.x, selectedGhostConnLocal.localNormal.z);
              finalYaw = angleTarget - angleLocal;
          }
      } else {
          const ghostRotQuat = Quaternion.FromEulerAngles(baseRotation.x, baseRotation.y, baseRotation.z);
          const ghostRotScaleMatrix = Matrix.Compose(ghostScale, ghostRotQuat, Vector3.Zero());

          let bestGhostConn = ghostConnectorsLocal[0];
          let maxOppositeDot = -Number.MAX_VALUE;

          for (const gc of ghostConnectorsLocal) {
              const worldNormal = Vector3.TransformNormal(gc.localNormal, ghostRotScaleMatrix).normalize();
              const dot = Vector3.Dot(worldNormal, bestTargetConn.normal.scale(-1));
              if (dot > maxOppositeDot) {
                  maxOppositeDot = dot;
                  bestGhostConn = gc;
              }
          }
          selectedGhostConnLocal = bestGhostConn;
      }

      const finalRotVec = new Vector3(baseRotation.x, finalYaw, baseRotation.z);
      const finalRotQuat = Quaternion.FromEulerAngles(finalRotVec.x, finalRotVec.y, finalRotVec.z);
      const finalRotScaleMatrix = Matrix.Compose(ghostScale, finalRotQuat, Vector3.Zero());

      const rotatedLocalPos = Vector3.TransformCoordinates(selectedGhostConnLocal.localPos, finalRotScaleMatrix);
      const finalPos = bestTargetConn.pos.subtract(rotatedLocalPos);

      const ghostConnWorldPos = Vector3.TransformCoordinates(selectedGhostConnLocal.localPos, finalRotScaleMatrix).add(finalPos);

      return { 
          position: finalPos, 
          rotation: finalRotVec, 
          color: 'blue', 
          parent: null,
          debugTargetPos: bestTargetConn.pos,
          debugGhostPos: ghostConnWorldPos
      };
  }

  private calculateModularSnapFallback(targetMesh: AbstractMesh, ghostBounds: { min: Vector3, max: Vector3 }, baseRotation: Vector3, ghostScale: Vector3, camDirection: Vector3, ghostConnIndex: number): PlacementResult {
      const snapNormal = Vector3.Zero();
      const absX = Math.abs(camDirection.x); const absY = Math.abs(camDirection.y); const absZ = Math.abs(camDirection.z);

      if (absY > Math.max(absX, absZ) * 1.5) snapNormal.y = Math.sign(camDirection.y);
      else if (absX > absZ) snapNormal.x = Math.sign(camDirection.x);
      else snapNormal.z = Math.sign(camDirection.z);

      snapNormal.scaleInPlace(-1);

      const targetBounds = this.getLocalBoundingInfo(targetMesh);
      const targetConnectorsLocal = this.getDynamicConnectors(targetBounds.min, targetBounds.max);
      targetMesh.computeWorldMatrix(true);
      const targetWorldMatrix = targetMesh.getWorldMatrix();
      
      const targetConnectorsWorld = targetConnectorsLocal.map(c => ({
          pos: Vector3.TransformCoordinates(c.localPos, targetWorldMatrix),
          normal: Vector3.TransformNormal(c.localNormal, targetWorldMatrix).normalize()
      }));

      let bestTargetConn = targetConnectorsWorld[0];
      let maxDotTarget = -Number.MAX_VALUE;
      for (const tc of targetConnectorsWorld) {
          const dot = Vector3.Dot(tc.normal, snapNormal);
          if (dot > maxDotTarget) { maxDotTarget = dot; bestTargetConn = tc; }
      }

      return this.calculateModularSnap(targetMesh, ghostBounds, baseRotation, ghostScale, bestTargetConn.pos, ghostConnIndex);
  }

  private calculateSurfaceRestPosition(pickedPoint: Vector3, snapNormal: Vector3, ghostBounds: { min: Vector3, max: Vector3 }, rotation: Vector3, scale: Vector3): Vector3 {
      const min = ghostBounds.min; const max = ghostBounds.max;
      const corners = [
          new Vector3(min.x, min.y, min.z), new Vector3(max.x, min.y, min.z),
          new Vector3(max.x, max.y, min.z), new Vector3(min.x, max.y, min.z),
          new Vector3(min.x, min.y, max.z), new Vector3(max.x, min.y, max.z),
          new Vector3(max.x, max.y, max.z), new Vector3(min.x, max.y, max.z)
      ];

      const rotQuat = Quaternion.FromEulerAngles(rotation.x, rotation.y, rotation.z);
      const rotScaleMatrix = Matrix.Compose(scale, rotQuat, Vector3.Zero());

      let rotatedMin = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
      let rotatedMax = new Vector3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);

      corners.forEach(c => {
          const transformed = Vector3.TransformCoordinates(c, rotScaleMatrix);
          rotatedMin = Vector3.Minimize(rotatedMin, transformed);
          rotatedMax = Vector3.Maximize(rotatedMax, transformed);
      });

      const offset = new Vector3(0, 0, 0);
      if (snapNormal.y > 0.5) offset.y = -rotatedMin.y; else if (snapNormal.y < -0.5) offset.y = -rotatedMax.y;
      if (snapNormal.x > 0.5) offset.x = -rotatedMin.x; else if (snapNormal.x < -0.5) offset.x = -rotatedMax.x;
      if (snapNormal.z > 0.5) offset.z = -rotatedMin.z; else if (snapNormal.z < -0.5) offset.z = -rotatedMax.z;

      return pickedPoint.add(offset);
  }

  private getCardinalNormal(normal: Vector3): Vector3 {
      const absX = Math.abs(normal.x); const absY = Math.abs(normal.y); const absZ = Math.abs(normal.z);
      const snapNormal = Vector3.Zero();
      if (absX > absY && absX > absZ) snapNormal.x = Math.sign(normal.x);
      else if (absY > absX && absY > absZ) snapNormal.y = Math.sign(normal.y);
      else snapNormal.z = Math.sign(normal.z);
      return snapNormal;
  }

  private findMeshUnderPlayer(scene: Scene, playerMesh: AbstractMesh): AbstractMesh | null {
      const origin = playerMesh.getAbsolutePosition().clone(); origin.y += 1.0; 
      const ray = new Ray(origin, new Vector3(0, -1, 0), 5.0);
      
      const hit = scene.pickWithRay(ray, (mesh) => {
          if (Tags.MatchesQuery(mesh, "ghost_preview || editor_only || fog_element")) return false;
          if (!mesh.isPickable && !mesh.checkCollisions) return false;
          if (mesh === playerMesh || mesh.isDescendantOf(playerMesh)) return false;
          return true;
      });

      if (hit && hit.hit && hit.pickedMesh) return this.resolveEntityMesh(hit.pickedMesh);
      return null;
  }
}

