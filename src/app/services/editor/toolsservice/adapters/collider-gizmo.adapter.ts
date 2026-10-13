// file: src/app/services/editor/toolsservice/adapters/collider-gizmo.adapter.ts
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Matrix, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class ColliderGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null, mesh?: AbstractMesh | null): boolean {
    return subSelected === 'collider';
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    return (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    const target = (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
    return target ? target.getAbsolutePosition() : null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    const target = (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
    if (target) {
      target.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void {}

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    const target = (debugSvc as any).colliderSvc?.currentColliderTarget || debugSvc.debugCollider;
    if (target && mesh) {
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(target.getAbsolutePosition(), invMat);
      
      entity.collider.offsetX = localPos.x;
      entity.collider.offsetY = localPos.y;
      entity.collider.offsetZ = localPos.z;
      entity.isDirty = true;
      entity.syncToView();
    }
  }
}