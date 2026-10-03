// RUTA: src/app/core/engine/runtime/systems/lighting/light-transform.service.ts
// ACCIÓN: MODIFICAR

import { Injectable } from '@angular/core';
import { Vector3, AbstractMesh, Tags } from '@babylonjs/core';
import { GameEntity } from '../../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class LightTransformService {
  private static readonly _Z_AXIS = new Vector3(0, 0, 1);

  /**
   * Resuelve la posición absoluta y dirección en el mundo 3D de una luz virtual,
   * forzando la computación de matrices mundiales si el nodo está emparentado a mallas.
   */
  public getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
      if (!entity.view || entity.view.isDisposed()) {
          outPos.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
          outDir.copyFrom(LightTransformService._Z_AXIS);
          return;
      }

      let targetNode: any = entity.view;

      // Si tiene una malla visual de luz hija (sphere/gizmo visual), esa es la posición óptica exacta
      const visualSphere = entity.view.getChildMeshes(false).find(
          (m: AbstractMesh) => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual
      );

      if (entity.light?.attachedNodeName) {
          const searchRoot = entity.view.parent || entity.view;
          const boneNode = searchRoot.getDescendants(false).find(n => n.name === entity.light!.attachedNodeName);
          if (boneNode) {
              targetNode = boneNode;
          }
      } else if (visualSphere && !entity.visual.assetId) {
          targetNode = visualSphere;
      }

      // Forzamos actualización de matrices jerárquicas para evitar lecturas de frames pasados
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