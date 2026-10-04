// file: src/app/core/engine/runtime/systems/lighting/light-transform.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Tags } from '@babylonjs/core';
import { GameEntity } from '../../../entities/game.entity';
import { EntityManagerService } from '../../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class LightTransformService {
  private entityManager = inject(EntityManagerService);
  private static readonly _Z_AXIS = new Vector3(0, 0, 1);

  /**
   * Resuelve de forma unificada la posición mundial real de cualquier entidad,
   * respetando la jerarquía de mallas en Babylon.js o proyectando mediante su entidad padre.
   */
  public getEntityWorldPosition(entity: GameEntity, outPos: Vector3): Vector3 {
    if (entity.view && !entity.view.isDisposed()) {
      entity.view.computeWorldMatrix(true);
      outPos.copyFrom(entity.view.getAbsolutePosition());
      return outPos;
    }

    const parentUid = entity.parentId || entity.light?.containerEntityUid;
    if (parentUid) {
      const parentEnt = this.entityManager.getEntityByUid(parentUid);
      if (parentEnt && parentEnt.view && !parentEnt.view.isDisposed()) {
        parentEnt.view.computeWorldMatrix(true);
        const localPos = new Vector3(
          entity.transform.position.x,
          entity.transform.position.y,
          entity.transform.position.z
        );
        Vector3.TransformCoordinatesToRef(localPos, parentEnt.view.getWorldMatrix(), outPos);
        return outPos;
      }
    }

    outPos.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
    return outPos;
  }

  public getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
    if (!entity.view || entity.view.isDisposed()) {
      this.getEntityWorldPosition(entity, outPos);
      outDir.copyFrom(LightTransformService._Z_AXIS);
      return;
    }

    let targetNode: any = entity.view;

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