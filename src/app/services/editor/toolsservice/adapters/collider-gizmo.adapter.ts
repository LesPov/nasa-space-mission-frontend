
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Matrix, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class ColliderGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null): boolean {
    return subSelected === 'collider';
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null): AbstractMesh | null {
    return debugSvc.debugCollider;
  }

  getCenterDragTarget(debugSvc: ToolsDebugService, mesh: AbstractMesh | null): AbstractMesh | null {
    return debugSvc.debugCollider;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh): void {
    if (debugSvc.debugCollider) {
      debugSvc.debugCollider.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null): void {
    // Already handled natively because it attaches directly to debugCollider
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    if (debugSvc.debugCollider) {
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(debugSvc.debugCollider.getAbsolutePosition(), invMat);
      entity.collider.offsetX = localPos.x;
      entity.collider.offsetY = localPos.y;
      entity.collider.offsetZ = localPos.z;
      entity.syncToView();
    }
  }
}