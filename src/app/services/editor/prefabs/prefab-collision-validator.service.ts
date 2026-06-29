
import { Injectable, inject } from '@angular/core';
import { Scene, AbstractMesh, Mesh, Tags } from '@babylonjs/core';
import { PrefabGhostService } from './prefab-ghost.service';

@Injectable({ providedIn: 'root' })
export class PrefabCollisionValidator {
    private ghostSvc = inject(PrefabGhostService);

    public isValid(scene: Scene, ignoreMesh: AbstractMesh | null): boolean {
        if (!this.ghostSvc.ghostMesh) return false;
        
        if (this.ghostSvc.ghostMesh.position.y < -0.1) return false;

        // 🔥 ESCALA: Encogemos la caja un 5% (0.95) para que tocar las paredes exactamente no sea colisión ilegal
        const originalScale = this.ghostSvc.ghostMesh.scaling.clone();
        this.ghostSvc.ghostMesh.scaling.scaleInPlace(0.95);
        this.ghostSvc.ghostMesh.computeWorldMatrix(true);

        const ghostMeshes = this.ghostSvc.ghostMesh.getChildMeshes().filter((m: AbstractMesh) => m instanceof Mesh) as Mesh[];
        if (this.ghostSvc.ghostMesh instanceof Mesh) {
            ghostMeshes.push(this.ghostSvc.ghostMesh);
        }
        
        const colliders = scene.meshes.filter((m: AbstractMesh) => 
            m.checkCollisions && 
            m.isVisible && 
            !m.isDescendantOf(this.ghostSvc.ghostMesh!) &&
            m !== this.ghostSvc.ghostMesh &&
            m !== ignoreMesh &&
            !Tags.MatchesQuery(m, "system_element || editor_only || fog_element || debug_element || proxy_collider || ghost")
        );

        let colliding = false;
        for (const g of ghostMeshes) {
            for (const c of colliders) {
                if (g.intersectsMesh(c, false)) {
                    colliding = true;
                    break;
                }
            }
            if (colliding) break;
        }

        // 🔥 Restauramos la escala original para no dañar el visual
        this.ghostSvc.ghostMesh.scaling.copyFrom(originalScale);
        this.ghostSvc.ghostMesh.computeWorldMatrix(true);

        return !colliding;
    }
}