
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Vector3, Quaternion, Matrix } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class BaseEntityGizmoAdapter implements IGizmoTargetAdapter {
  private static _tempLocal = Vector3.Zero();
  private static _tempWorldOffset = Vector3.Zero();
  private static _tempWorldCenter = Vector3.Zero();

  supports(subSelected: string | null, entity: GameEntity | null): boolean {
    return !subSelected;
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    if (mesh && pivotNode && entity) {
      // 🔥 FIX: Posicionar el pivote exactamente en el Visual Center (Pecho del actor)
      entity.getVisualCenterAbsoluteToRef(BaseEntityGizmoAdapter._tempWorldCenter);
      pivotNode.position.copyFrom(BaseEntityGizmoAdapter._tempWorldCenter);
      
      if (mesh.rotationQuaternion) {
        pivotNode.rotationQuaternion = mesh.rotationQuaternion.clone();
      } else {
        pivotNode.rotation = mesh.rotation.clone();
      }
      pivotNode.scaling.copyFrom(mesh.scaling);
      return pivotNode;
    }
    return null;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    if (mesh && entity) {
      entity.getVisualCenterAbsoluteToRef(BaseEntityGizmoAdapter._tempWorldCenter);
      return BaseEntityGizmoAdapter._tempWorldCenter;
    }
    return null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    mesh.position.addInPlace(delta);
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void {
    if (pivotNode && entity) {
      // 1. Clocar la Rotación y Escala directamente al Mesh base
      if (pivotNode.rotationQuaternion) {
        if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
        mesh.rotationQuaternion.copyFrom(pivotNode.rotationQuaternion);
      } else {
        mesh.rotation.copyFrom(pivotNode.rotation);
      }
      mesh.scaling.copyFrom(pivotNode.scaling);

      // 2. Calcular la posición del Mesh base compensando el Visual Center
      entity.getVisualCenterLocalToRef(BaseEntityGizmoAdapter._tempLocal);

      // Aplicar escala a la coordenada local
      BaseEntityGizmoAdapter._tempLocal.x *= mesh.scaling.x;
      BaseEntityGizmoAdapter._tempLocal.y *= mesh.scaling.y;
      BaseEntityGizmoAdapter._tempLocal.z *= mesh.scaling.z;

      // Transformar a World Space usando la rotación del Pivot
      const rotMatrix = Matrix.Identity();
      if (mesh.rotationQuaternion) {
         mesh.rotationQuaternion.toRotationMatrix(rotMatrix);
      } else {
         Matrix.RotationYawPitchRollToRef(mesh.rotation.y, mesh.rotation.x, mesh.rotation.z, rotMatrix);
      }

      Vector3.TransformCoordinatesToRef(BaseEntityGizmoAdapter._tempLocal, rotMatrix, BaseEntityGizmoAdapter._tempWorldOffset);

      // 3. Mesh Position (Pies) = Pivot Position (Pecho) - Offset Rotado
      mesh.position.copyFrom(pivotNode.position).subtractInPlace(BaseEntityGizmoAdapter._tempWorldOffset);
    }
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    entity.syncTransformFromView();
    entity.syncToView();
  }
}