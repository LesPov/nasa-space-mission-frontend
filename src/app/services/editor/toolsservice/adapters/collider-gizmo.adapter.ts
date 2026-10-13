// file: src/app/services/editor/toolsservice/adapters/collider-gizmo.adapter.ts
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Matrix, Vector3, Quaternion } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class ColliderGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null, mesh?: AbstractMesh | null): boolean {
    return subSelected === 'collider';
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    const target = (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
    if (target && pivotNode) {
      target.computeWorldMatrix(true);
      pivotNode.position.copyFrom(target.getAbsolutePosition());
      if (target.rotationQuaternion) {
        pivotNode.rotationQuaternion = target.rotationQuaternion.clone();
      } else {
        pivotNode.rotationQuaternion = Quaternion.FromEulerAngles(target.rotation.x, target.rotation.y, target.rotation.z);
      }
      pivotNode.scaling.copyFrom(target.scaling);
      return pivotNode;
    }
    return target;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    const target = (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
    return target ? target.getAbsolutePosition() : null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (!mesh || !entity) return;
    mesh.computeWorldMatrix(true);
    const invParent = Matrix.Invert(mesh.getWorldMatrix());
    const localDelta = Vector3.TransformNormal(delta, invParent);

    entity.collider.offsetX += localDelta.x;
    entity.collider.offsetY += localDelta.y;
    entity.collider.offsetZ += localDelta.z;
    entity.isDirty = true;
    entity.syncToView();
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void {
    if (!pivotNode || !mesh || !entity) return;

    mesh.computeWorldMatrix(true);
    const invMat = Matrix.Invert(mesh.getWorldMatrix());
    
    // 1. Sincronizar posición (Offset local relativo a la entidad)
    const localPos = Vector3.TransformCoordinates(pivotNode.position, invMat);
    entity.collider.offsetX = localPos.x;
    entity.collider.offsetY = localPos.y;
    entity.collider.offsetZ = localPos.z;

    // 2. Sincronizar rotación relativa
    if (pivotNode.rotationQuaternion) {
      const parentRotMat = mesh.getWorldMatrix().getRotationMatrix();
      const parentQuat = Quaternion.FromRotationMatrix(parentRotMat).invertInPlace();
      const localQuat = parentQuat.multiply(pivotNode.rotationQuaternion);
      const euler = localQuat.toEulerAngles();
      entity.collider.rotation = {
        x: euler.x * (180 / Math.PI),
        y: euler.y * (180 / Math.PI),
        z: euler.z * (180 / Math.PI)
      };
    }

    // 3. Sincronizar escala dimensional
    const scaleFactorX = pivotNode.scaling.x;
    const scaleFactorY = pivotNode.scaling.y;
    const scaleFactorZ = pivotNode.scaling.z;
    entity.collider.scale = {
      x: Math.max(0.01, scaleFactorX),
      y: Math.max(0.01, scaleFactorY),
      z: Math.max(0.01, scaleFactorZ)
    };

    entity.isDirty = true;
    entity.syncToView();
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    const target = (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
    if (target && mesh) {
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(target.getAbsolutePosition(), invMat);
      
      entity.collider.offsetX = localPos.x;
      entity.collider.offsetY = localPos.y;
      entity.collider.offsetZ = localPos.z;

      if (target.rotationQuaternion) {
        const parentRotMat = mesh.getWorldMatrix().getRotationMatrix();
        const parentQuat = Quaternion.FromRotationMatrix(parentRotMat).invertInPlace();
        const localQuat = parentQuat.multiply(target.rotationQuaternion);
        const euler = localQuat.toEulerAngles();
        entity.collider.rotation = {
          x: euler.x * (180 / Math.PI),
          y: euler.y * (180 / Math.PI),
          z: euler.z * (180 / Math.PI)
        };
      }

      entity.isDirty = true;
      entity.syncToView();
    }
  }
}