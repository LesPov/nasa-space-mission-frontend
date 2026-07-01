
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Vector3, Quaternion } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class BaseEntityGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null): boolean {
    return !subSelected;
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null): AbstractMesh | null {
    if (mesh && pivotNode) {
      pivotNode.position.copyFrom(mesh.getAbsolutePosition());
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

  getCenterDragTarget(debugSvc: ToolsDebugService, mesh: AbstractMesh | null): AbstractMesh | null {
    return mesh;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh): void {
    mesh.position.addInPlace(delta);
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null): void {
    if (pivotNode) {
      mesh.position.copyFrom(pivotNode.position);
      if (pivotNode.rotationQuaternion) {
        if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
        mesh.rotationQuaternion.copyFrom(pivotNode.rotationQuaternion);
      } else {
        mesh.rotation.copyFrom(pivotNode.rotation);
      }
      mesh.scaling.copyFrom(pivotNode.scaling);
    }
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    entity.syncTransformFromView();
    entity.syncToView();
  }
}