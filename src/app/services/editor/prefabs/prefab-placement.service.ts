
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Vector3, Quaternion } from '@babylonjs/core';
import { EditorSceneService } from '../editor-scene.service';
import { SceneObjectBuilderService } from '../sceneservice/scene-object-builder.service';

@Injectable({ providedIn: 'root' })
export class PrefabPlacementService {
    private sceneSvc = inject(EditorSceneService);
    private builderSvc = inject(SceneObjectBuilderService);

    public async place(asset: any, pos: Vector3, rot: Quaternion, scale: Vector3, parent: AbstractMesh | null): Promise<void> {
        const euler = rot.toEulerAngles();
        
        if (asset.isPrefab || asset.properties?.prefabHierarchy) {
            this.sceneSvc.instanciarPrefabFull(asset, pos, euler, scale, parent || undefined);
        } else {
            const tipo = asset.type || 'cube';
            const nombre = `${tipo}_${Math.floor(Math.random() * 100000)}`;
            
            // 🔥 FIX: En primitivas simples, sí tenemos que multiplicar la base x el mult.
            const sX = (asset.scale?.x ?? 1) * scale.x;
            const sY = (asset.scale?.y ?? 1) * scale.y;
            const sZ = (asset.scale?.z ?? 1) * scale.z;

            await this.builderSvc.agregarObjetoCustom(
                tipo, nombre, 'prop', '#ffffff', 
                sX, sY, sZ,   
                asset, true, true, '',        
                parent, pos, euler
            );
        }
    }
}