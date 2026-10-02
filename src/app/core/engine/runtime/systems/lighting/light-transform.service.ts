import { Injectable } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../entities/game.entity';
 
@Injectable({ providedIn: 'root' })
export class LightTransformService {
    
  private static readonly _Z_AXIS = new Vector3(0, 0, 1);

  /**
   * Resuelve la posición absoluta y dirección en el mundo 3D de una luz virtual,
   * respetando los anclajes (huesos/nodos) y la jerarquía.
   * Utiliza vectores pre-asignados (outPos, outDir) para evitar allocations por frame.
   */
  public getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
      if (!entity.view) {
          outPos.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
          outDir.copyFrom(LightTransformService._Z_AXIS);
          return;
      }

      let targetNode: any = entity.view;

      if (entity.light?.attachedNodeName) {
          const searchRoot = entity.view.parent || entity.view;
          const boneNode = searchRoot.getDescendants(false).find(n => n.name === entity.light!.attachedNodeName);
          if (boneNode) {
              targetNode = boneNode;
          }
      }

      targetNode.computeWorldMatrix(true);
      outPos.copyFrom(targetNode.getAbsolutePosition());
      
      if (targetNode.getDirectionToRef) {
          targetNode.getDirectionToRef(LightTransformService._Z_AXIS, outDir);
      } else if (targetNode.getDirection) {
          outDir.copyFrom(targetNode.getDirection(LightTransformService._Z_AXIS));
      } else {
          outDir.copyFrom(LightTransformService._Z_AXIS);
      }
      outDir.normalize();
  }
}