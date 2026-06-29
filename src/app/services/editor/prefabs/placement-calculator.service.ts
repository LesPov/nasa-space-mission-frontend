
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Ray, Scene, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

export interface PlacementResult {
  position: Vector3;
  color: 'green' | 'yellow' | 'blue' | 'red';
  parent: AbstractMesh | null;
}

@Injectable({ providedIn: 'root' })
export class PlacementCalculatorService {
  private entityManager = inject(EntityManagerService);

  /**
   * Calcula la posición exacta del fantasma usando Raycast Híbrido + Grid Snap.
   */
  public calculatePlacement(
    scene: Scene,
    ray: Ray,
    playerMesh: AbstractMesh | null | undefined,
    ghostBounds: { min: Vector3; max: Vector3; extends: Vector3 } | null,
    isAltPressed: boolean,
    isGPressed: boolean,
    buildDistance: number
  ): PlacementResult {
    
    // 1. Disparar Raycast estándar
    const hit = scene.pickWithRay(ray, (mesh) => {
      if (!mesh.isPickable || !mesh.isVisible) return false;
      if (Tags.MatchesQuery(mesh, "system_element || fog_element || editor_only || proxy_collider || ghost_preview")) return false;
      if (playerMesh && (mesh === playerMesh || mesh.isDescendantOf(playerMesh))) return false;
      return true;
    });

    const pivotToBottom = ghostBounds ? -ghostBounds.min.y : 0.5;

    // ==========================================
    // ESCENARIO A: EL RAYO GOLPEA UN OBJETO FÍSICO
    // ==========================================
    if (hit && hit.hit && hit.pickedMesh && hit.pickedPoint && hit.getNormal) {
      const normal = hit.getNormal(true, true) || Vector3.Up();
      const pickedPoint = hit.pickedPoint.clone();
      
      const entity = this.entityManager.getEntityByMesh(hit.pickedMesh);
      const rootMesh = entity ? (entity.view as AbstractMesh) : hit.pickedMesh;

      // Normales Cardinales (Estrictas) para evitar bugs microscópicos
      const snapNormal = this.getCardinalNormal(normal);

      if (isAltPressed && rootMesh && ghostBounds) {
        // [MODO AZUL] SNAP ADYACENTE: Pegar cara a cara
        rootMesh.computeWorldMatrix(true);
        const tInfo = rootMesh.getBoundingInfo().boundingBox;
        
        const perfectCenter = new Vector3(
            tInfo.centerWorld.x + snapNormal.x * (tInfo.maximumWorld.x - tInfo.centerWorld.x + ghostBounds.extends.x),
            tInfo.centerWorld.y + snapNormal.y * (tInfo.maximumWorld.y - tInfo.centerWorld.y + ghostBounds.extends.y),
            tInfo.centerWorld.z + snapNormal.z * (tInfo.maximumWorld.z - tInfo.centerWorld.z + ghostBounds.extends.z)
        );

        const ghostCenterOffset = ghostBounds.min.add(ghostBounds.max).scale(0.5);
        return { 
            position: perfectCenter.subtract(ghostCenterOffset), 
            color: 'blue', 
            parent: null 
        };
      } 
      else if (isGPressed) {
        // [MODO AMARILLO] PARENTESCO: Apoyar y hacer hijo
        let pushDistance = this.getPushDistance(snapNormal, ghostBounds);
        return { 
            position: pickedPoint.add(snapNormal.scale(pushDistance)), 
            color: 'yellow', 
            parent: rootMesh 
        };
      } 
      else {
        // [MODO VERDE] APOYO LIBRE: Apoyar en la superficie libremente
        let pushDistance = this.getPushDistance(snapNormal, ghostBounds);
        return { 
            position: pickedPoint.add(snapNormal.scale(pushDistance)), 
            color: 'green', 
            parent: null 
        };
      }
    } 

    // ==========================================
    // ESCENARIO B: EL RAYO APUNTA AL VACÍO (CIELO/AIRE)
    // ==========================================
    if (isAltPressed && ghostBounds && playerMesh) {
        // [MODO AZUL MAGIA] CONSTRUIR HACIA ADELANTE EN EL VACÍO (Estilo Fortnite)
        const referenceMesh = this.findClosestStructuralMesh(scene, playerMesh);
        
        if (referenceMesh) {
            // Buscamos la dirección en la que está mirando la cámara
            const camDir = ray.direction.clone();
            const snapNormal = Vector3.Zero();
            
            // Evaluamos hacia dónde quiere expandir el usuario (Priorizando horizontal)
            const absX = Math.abs(camDir.x);
            const absY = Math.abs(camDir.y);
            const absZ = Math.abs(camDir.z);

            // Si mira muy arriba o muy abajo, construye piso arriba o abajo, si no, puente adelante
            if (absY > Math.max(absX, absZ) * 1.5) snapNormal.y = Math.sign(camDir.y);
            else if (absX > absZ) snapNormal.x = Math.sign(camDir.x);
            else snapNormal.z = Math.sign(camDir.z);

            referenceMesh.computeWorldMatrix(true);
            const tInfo = referenceMesh.getBoundingInfo().boundingBox;
            
            const perfectCenter = new Vector3(
                tInfo.centerWorld.x + snapNormal.x * (tInfo.maximumWorld.x - tInfo.centerWorld.x + ghostBounds.extends.x),
                tInfo.centerWorld.y + snapNormal.y * (tInfo.maximumWorld.y - tInfo.centerWorld.y + ghostBounds.extends.y),
                tInfo.centerWorld.z + snapNormal.z * (tInfo.maximumWorld.z - tInfo.centerWorld.z + ghostBounds.extends.z)
            );

            const ghostCenterOffset = ghostBounds.min.add(ghostBounds.max).scale(0.5);
            return { 
                position: perfectCenter.subtract(ghostCenterOffset), 
                color: 'blue', 
                parent: null 
            };
        }
    }

    // [MODO AZUL] FLOTANDO EN EL AIRE NORMAL
    return {
        position: ray.origin.add(ray.direction.scale(buildDistance)),
        color: 'blue',
        parent: null
    };
  }

  /**
   * Obtiene la normal más dominante (X, Y o Z pura) para evitar diagonales raras.
   */
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

  /**
   * Calcula cuánto se debe empujar el objeto para que el borde toque la pared y no el centro.
   */
  private getPushDistance(snapNormal: Vector3, bounds: any): number {
      if (!bounds) return 0.5;
      if (snapNormal.x > 0.5) return Math.abs(bounds.min.x);
      if (snapNormal.x < -0.5) return Math.abs(bounds.max.x);
      if (snapNormal.y > 0.5) return Math.abs(bounds.min.y);
      if (snapNormal.y < -0.5) return Math.abs(bounds.max.y);
      if (snapNormal.z > 0.5) return Math.abs(bounds.min.z);
      if (snapNormal.z < -0.5) return Math.abs(bounds.max.z);
      return 0.5;
  }

  /**
   * Encuentra el objeto estructural más cercano a los pies del jugador
   * para usarlo como punto de anclaje (Grid) al construir en el vacío.
   */
  private findClosestStructuralMesh(scene: Scene, playerMesh: AbstractMesh): AbstractMesh | null {
      const playerPos = playerMesh.getAbsolutePosition();
      let closestMesh: AbstractMesh | null = null;
      let minDist = 15; // Rango máximo para buscar un piso de apoyo

      scene.meshes.forEach(mesh => {
          if (!mesh.isPickable || !mesh.isVisible) return;
          if (Tags.MatchesQuery(mesh, "system_element || fog_element || editor_only || proxy_collider || ghost_preview")) return;
          if (mesh === playerMesh || mesh.isDescendantOf(playerMesh)) return;

          const dist = Vector3.Distance(playerPos, mesh.getAbsolutePosition());
          if (dist < minDist) {
              minDist = dist;
              closestMesh = mesh;
          }
      });

      return closestMesh;
  }
}