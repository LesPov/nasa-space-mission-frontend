import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Ray, Scene, Tags, Mesh } from '@babylonjs/core';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

export interface PlacementResult {
  position: Vector3;
  color: 'green' | 'yellow' | 'blue' | 'red';
  parent: AbstractMesh | null;
}

@Injectable({ providedIn: 'root' })
export class PlacementCalculatorService {
  private entityManager = inject(EntityManagerService);

  // 🔥 NUEVO: Escala por la jerarquía hasta encontrar el Nodo Raíz real del objeto, 
  // asegurando que las medidas se tomen del modelo completo y no de una sub-malla.
  private resolveEntityMesh(mesh: AbstractMesh): AbstractMesh {
      let current: any = mesh;
      while (current && current.name !== '__root__') {
          const entity = this.entityManager.getEntityByMesh(current);
          if (entity && entity.view) return entity.view as AbstractMesh;
          current = current.parent;
      }
      return mesh;
  }

  public calculatePlacement(
    scene: Scene,
    ray: Ray,
    playerMesh: AbstractMesh | null | undefined,
    ghostBounds: { min: Vector3; max: Vector3; extends: Vector3; center: Vector3 } | null,
    isAltPressed: boolean,
    isGPressed: boolean,
    buildDistance: number
  ): PlacementResult {
    
    const hit = scene.pickWithRay(ray, (mesh) => {
      if (!mesh.isPickable || !mesh.isVisible) return false;
      if (Tags.MatchesQuery(mesh, "system_element || fog_element || editor_only || proxy_collider || ghost_preview")) return false;
      if (playerMesh && (mesh === playerMesh || mesh.isDescendantOf(playerMesh))) return false;
      return true;
    });

    if (hit && hit.hit && hit.pickedMesh && hit.pickedPoint && hit.getNormal) {
      const normal = hit.getNormal(true, true) || Vector3.Up();
      const pickedPoint = hit.pickedPoint.clone();
      
      const rootMesh = this.resolveEntityMesh(hit.pickedMesh);
      const snapNormal = this.getCardinalNormal(normal);

      if (isAltPressed && rootMesh && ghostBounds) {
        const perfectPos = this.calculatePerfectSnapPosition(rootMesh, ghostBounds, snapNormal);
        return { position: perfectPos, color: 'blue', parent: null };
      } 
      else if (isGPressed) {
        const offsetPos = this.calculateSurfaceRestPosition(pickedPoint, snapNormal, ghostBounds);
        return { position: offsetPos, color: 'yellow', parent: rootMesh };
      } 
      else {
        const offsetPos = this.calculateSurfaceRestPosition(pickedPoint, snapNormal, ghostBounds);
        return { position: offsetPos, color: 'green', parent: null };
      }
    } 

    if (isAltPressed && ghostBounds && playerMesh) {
        const referenceMesh = this.findMeshUnderPlayer(scene, playerMesh);
        
        if (referenceMesh) {
            const camDir = ray.direction.clone();
            const snapNormal = Vector3.Zero();
            
            const absX = Math.abs(camDir.x);
            const absY = Math.abs(camDir.y);
            const absZ = Math.abs(camDir.z);

            if (absY > Math.max(absX, absZ) * 1.5) snapNormal.y = Math.sign(camDir.y);
            else if (absX > absZ) snapNormal.x = Math.sign(camDir.x);
            else snapNormal.z = Math.sign(camDir.z);

            const perfectPos = this.calculatePerfectSnapPosition(referenceMesh, ghostBounds, snapNormal);
            return { position: perfectPos, color: 'blue', parent: null };
        }
    }

    return {
        position: ray.origin.add(ray.direction.scale(buildDistance)),
        color: 'blue',
        parent: null
    };
  }

  private getAccurateBoundingInfo(targetMesh: AbstractMesh): { center: Vector3, extends: Vector3, min: Vector3, max: Vector3 } {
    let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new Vector3(Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE);
    let hasValidMesh = false;

    const childMeshes = targetMesh.getChildMeshes(false);
    const allMeshes = targetMesh instanceof Mesh ? [targetMesh, ...childMeshes] : childMeshes;

    allMeshes.forEach(m => {
        if (!m.isVisible) return;
        if (m.getTotalVertices() === 0) return;
        if (Tags.MatchesQuery(m, "system_element || fog_element || editor_only || proxy_collider || ghost_preview")) return;

        m.computeWorldMatrix(true);
        const vectors = m.getBoundingInfo().boundingBox.vectorsWorld;
        vectors.forEach(v => {
            min = Vector3.Minimize(min, v);
            max = Vector3.Maximize(max, v);
        });
        hasValidMesh = true;
    });

    if (!hasValidMesh) {
        targetMesh.computeWorldMatrix(true);
        min = targetMesh.getBoundingInfo().boundingBox.minimumWorld;
        max = targetMesh.getBoundingInfo().boundingBox.maximumWorld;
    }

    return {
        min, max,
        center: max.add(min).scale(0.5),
        extends: max.subtract(min).scale(0.5)
    };
  }

  private calculatePerfectSnapPosition(targetMesh: AbstractMesh, ghostBounds: any, snapNormal: Vector3): Vector3 {
    const tInfo = this.getAccurateBoundingInfo(targetMesh);
    const gInfo = ghostBounds; 

    let posX = 0;
    let posY = 0;
    let posZ = 0;

    if (snapNormal.x > 0.5) posX = tInfo.max.x - gInfo.min.x; 
    else if (snapNormal.x < -0.5) posX = tInfo.min.x - gInfo.max.x; 
    else posX = tInfo.center.x - gInfo.center.x; 

    if (snapNormal.z > 0.5) posZ = tInfo.max.z - gInfo.min.z;
    else if (snapNormal.z < -0.5) posZ = tInfo.min.z - gInfo.max.z;
    else posZ = tInfo.center.z - gInfo.center.z;

    if (snapNormal.y > 0.5) {
        posY = tInfo.max.y - gInfo.min.y; 
    } else if (snapNormal.y < -0.5) {
        posY = tInfo.min.y - gInfo.max.y; 
    } else {
        posY = tInfo.min.y - gInfo.min.y; 
    }

    return new Vector3(posX, posY, posZ);
  }

  private calculateSurfaceRestPosition(pickedPoint: Vector3, snapNormal: Vector3, bounds: any): Vector3 {
      if (!bounds) return pickedPoint.clone();

      const offset = new Vector3(0, 0, 0);
      
      if (snapNormal.x > 0.5) offset.x = -bounds.min.x;
      else if (snapNormal.x < -0.5) offset.x = -bounds.max.x;
      
      if (snapNormal.y > 0.5) offset.y = -bounds.min.y;
      else if (snapNormal.y < -0.5) offset.y = -bounds.max.y;
      
      if (snapNormal.z > 0.5) offset.z = -bounds.min.z;
      else if (snapNormal.z < -0.5) offset.z = -bounds.max.z;

      return pickedPoint.add(offset);
  }

  private getCardinalNormal(normal: Vector3): Vector3 {
      const absX = Math.abs(normal.x);
      const absY = Math.abs(normal.y);
      const absZ = Math.abs(normal.z);
      const snapNormal = Vector3.Zero();
      if (absX > absY && absX > absZ) snapNormal.x = Math.sign(normal.x);
      else if (absY > absX && absY > absZ) snapNormal.y = Math.sign(normal.y);
      else snapNormal.z = Math.sign(normal.z);
      return snapNormal;
  }

  private findMeshUnderPlayer(scene: Scene, playerMesh: AbstractMesh): AbstractMesh | null {
      const origin = playerMesh.getAbsolutePosition().clone();
      origin.y += 1.0; 
      
      const ray = new Ray(origin, new Vector3(0, -1, 0), 5.0);
      
      const hit = scene.pickWithRay(ray, (mesh) => {
          if (Tags.MatchesQuery(mesh, "ghost_preview || editor_only || fog_element")) return false;
          if (!mesh.isPickable && !mesh.checkCollisions) return false;
          if (mesh === playerMesh || mesh.isDescendantOf(playerMesh)) return false;
          return true;
      });

      if (hit && hit.hit && hit.pickedMesh) {
          return this.resolveEntityMesh(hit.pickedMesh);
      }

      let closestMesh: AbstractMesh | null = null;
      let minDistance = 15;
      const playerPos = playerMesh.getAbsolutePosition();

      scene.meshes.forEach(mesh => {
          if (!mesh.isPickable || !mesh.isVisible) return;
          if (Tags.MatchesQuery(mesh, "system_element || fog_element || editor_only || proxy_collider || ghost_preview")) return;
          if (mesh === playerMesh || mesh.isDescendantOf(playerMesh)) return;

          mesh.computeWorldMatrix(true);
          const boundingInfo = mesh.getBoundingInfo();
          
          const min = boundingInfo.boundingBox.minimumWorld;
          const max = boundingInfo.boundingBox.maximumWorld;
          let dx = Math.max(min.x - playerPos.x, 0, playerPos.x - max.x);
          let dy = Math.max(min.y - playerPos.y, 0, playerPos.y - max.y);
          let dz = Math.max(min.z - playerPos.z, 0, playerPos.z - max.z);
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          
          if (dist < minDistance) {
              minDistance = dist;
              closestMesh = mesh;
          }
      });

      if (closestMesh) {
          return this.resolveEntityMesh(closestMesh);
      }

      return null;
  }
}