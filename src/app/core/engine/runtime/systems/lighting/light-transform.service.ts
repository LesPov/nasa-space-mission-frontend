// file: src/app/core/engine/runtime/systems/lighting/light-transform.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Tags, Matrix, Quaternion } from '@babylonjs/core';
import { GameEntity } from '../../../entities/game.entity';
import { EntityManagerService } from '../../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class LightTransformService {
  private entityManager = inject(EntityManagerService);
  private static readonly _Z_AXIS = new Vector3(0, 0, 1);

  // Buffers temporales estáticos para cero allocations en el loop de render
  private static _tempLocalPos = Vector3.Zero();
  private static _tempParentMatrix = Matrix.Identity();
  private static _tempParentRot = Quaternion.Identity();
  private static _tempParentScale = Vector3.One();
  private static _tempParentPos = Vector3.Zero();

  /**
   * Resuelve de forma unificada y canónica la posición mundial real de cualquier entidad.
   * Maneja los tres escenarios posibles:
   * 1. La entidad tiene vista física enlazada a la jerarquía de Babylon.js.
   * 2. La entidad tiene vista física pero aún no está emparentada físicamente (resuelve vía padre lógico).
   * 3. La entidad aún no tiene vista física (resuelve componiendo matrices lógicas hacia arriba).
   */
  public getEntityWorldPosition(entity: GameEntity, outPos: Vector3): Vector3 {
    if (!entity) {
      outPos.setAll(0);
      return outPos;
    }

    // CASO 1: La entidad tiene una malla viva en la escena de BabylonJS
    if (entity.view && !entity.view.isDisposed()) {
      // Si tiene padre físico en BabylonJS, forzamos la actualización de la cadena de ancestros
      if (entity.view.parent) {
        entity.view.computeWorldMatrix(true);
        outPos.copyFrom(entity.view.getAbsolutePosition());
        return outPos;
      }

      // Si tiene vista pero está en la raíz de BabylonJS mientras que lógicamente tiene un parentId
      const parentUid: string | null | undefined = entity.parentId || entity.light?.containerEntityUid;
      if (parentUid) {
        const parentEnt = this.entityManager.getEntityByUid(parentUid);
        if (parentEnt && parentEnt.view && !parentEnt.view.isDisposed()) {
          parentEnt.view.computeWorldMatrix(true);
          LightTransformService._tempLocalPos.set(
            entity.transform.position.x,
            entity.transform.position.y,
            entity.transform.position.z
          );
          Vector3.TransformCoordinatesToRef(
            LightTransformService._tempLocalPos,
            parentEnt.view.getWorldMatrix(),
            outPos
          );
          return outPos;
        }
      }

      // Vista física en el espacio raíz
      entity.view.computeWorldMatrix(true);
      outPos.copyFrom(entity.view.getAbsolutePosition());
      return outPos;
    }

    // CASO 2: La entidad NO tiene vista física aún, pero tiene padre lógico
    const parentUid: string | null | undefined = entity.parentId || entity.light?.containerEntityUid;
    if (parentUid) {
      const parentEnt = this.entityManager.getEntityByUid(parentUid);
      if (parentEnt) {
        // Si el padre lógico tiene vista física, transformamos con su matriz mundial
        if (parentEnt.view && !parentEnt.view.isDisposed()) {
          parentEnt.view.computeWorldMatrix(true);
          LightTransformService._tempLocalPos.set(
            entity.transform.position.x,
            entity.transform.position.y,
            entity.transform.position.z
          );
          Vector3.TransformCoordinatesToRef(
            LightTransformService._tempLocalPos,
            parentEnt.view.getWorldMatrix(),
            outPos
          );
          return outPos;
        }

        // Si ni el padre tiene vista física, componemos recursivamente a nivel lógico
        this.composeLogicalHierarchyPosition(entity, outPos);
        return outPos;
      }
    }

    // CASO 3: Entidad raíz sin padre
    outPos.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
    return outPos;
  }

  /**
   * Resuelve la posición y dirección mundial de una luz (Point, Spot o Directional),
   * contemplando anclajes a huesos/nodos específicos de modelos GLB y esferas visuales de luz.
   */
  public getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
    if (!entity.view || entity.view.isDisposed()) {
      this.getEntityWorldPosition(entity, outPos);
      outDir.copyFrom(LightTransformService._Z_AXIS);
      return;
    }

    let targetNode: any = entity.view;
    targetNode.computeWorldMatrix(true);

    const visualSphere = entity.view.getChildMeshes(false).find(
      (m: AbstractMesh) => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual
    );

    // Si la luz está anclada a un nodo específico dentro de la jerarquía de un modelo GLB
    if (entity.light?.attachedNodeName) {
      const searchRoot = entity.view.parent || entity.view;
      if (searchRoot && typeof searchRoot.computeWorldMatrix === 'function') {
        searchRoot.computeWorldMatrix(true);
      }
      const boneNode = searchRoot.getDescendants(false).find((n: any) => n.name === entity.light!.attachedNodeName);
      if (boneNode) {
        targetNode = boneNode;
      }
    } else if (visualSphere && !entity.visual.assetId) {
      targetNode = visualSphere;
    }

    targetNode.computeWorldMatrix(true);
    outPos.copyFrom(targetNode.getAbsolutePosition());

    // Si la vista es hija de otra entidad pero no está emparentada en Babylon, resolver vía entidad padre
    if (!targetNode.parent && entity.parentId) {
      const parentEnt = this.entityManager.getEntityByUid(entity.parentId);
      if (parentEnt && parentEnt.view && !parentEnt.view.isDisposed()) {
        parentEnt.view.computeWorldMatrix(true);
        LightTransformService._tempLocalPos.set(
          entity.transform.position.x,
          entity.transform.position.y,
          entity.transform.position.z
        );
        Vector3.TransformCoordinatesToRef(
          LightTransformService._tempLocalPos,
          parentEnt.view.getWorldMatrix(),
          outPos
        );
      }
    }
    
    if (targetNode.getDirectionToRef) {
      targetNode.getDirectionToRef(LightTransformService._Z_AXIS, outDir);
    } else if (targetNode.getDirection) {
      outDir.copyFrom(targetNode.getDirection(LightTransformService._Z_AXIS));
    } else {
      outDir.copyFrom(LightTransformService._Z_AXIS);
    }
    outDir.normalize();
  }

  /**
   * Compone matemáticamente la jerarquía de transformaciones de entidades lógicas
   * cuando los nodos de Babylon.js aún no han sido instanciados o la escena está cargando en background.
   */
  private composeLogicalHierarchyPosition(entity: GameEntity, outPos: Vector3): void {
    const chain: GameEntity[] = [];
    let current: GameEntity | undefined = entity;

    // Recolectar cadena de ancestros (hijo -> padre -> abuelo -> raíz)
    while (current) {
      chain.unshift(current); // Colocar raíz primero
      const pUid: string | null | undefined = current.parentId || current.light?.containerEntityUid;
      if (pUid) {
        current = this.entityManager.getEntityByUid(pUid);
      } else {
        current = undefined;
      }
    }

    let accumulatedMatrix = Matrix.Identity();

    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      const pos = node.transform.position;
      const rot = node.transform.rotation;
      const scale = node.transform.scale;

      LightTransformService._tempParentPos.set(pos.x, pos.y, pos.z);
      LightTransformService._tempParentScale.set(scale.x || 1, scale.y || 1, scale.z || 1);

      if (node.transform.rotationQuaternion) {
        LightTransformService._tempParentRot.set(
          node.transform.rotationQuaternion.x,
          node.transform.rotationQuaternion.y,
          node.transform.rotationQuaternion.z,
          node.transform.rotationQuaternion.w
        );
      } else {
        Quaternion.FromEulerAnglesToRef(rot.x, rot.y, rot.z, LightTransformService._tempParentRot);
      }

      Matrix.ComposeToRef(
        LightTransformService._tempParentScale,
        LightTransformService._tempParentRot,
        LightTransformService._tempParentPos,
        LightTransformService._tempParentMatrix
      );

      accumulatedMatrix = accumulatedMatrix.multiply(LightTransformService._tempParentMatrix);
    }

    outPos.copyFrom(accumulatedMatrix.getTranslation());
  }
}