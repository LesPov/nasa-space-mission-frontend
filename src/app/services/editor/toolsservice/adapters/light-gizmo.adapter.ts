
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Matrix, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class LightGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null): boolean {
    return subSelected === 'light' && !!entity?.light;
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    return debugSvc.debugLightBox;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    return debugSvc.debugLightBox ? debugSvc.debugLightBox.getAbsolutePosition() : null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (debugSvc.debugLightBox) {
      debugSvc.debugLightBox.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void { }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    if (debugSvc.debugLightBox && entity.light) {
      let targetParent: AbstractMesh = mesh;
      if (entity.light.attachedNodeName) {
          const found = mesh.getDescendants(false).find(n => n.name === entity.light!.attachedNodeName);
          if (found) targetParent = found as AbstractMesh;
      }
      
      targetParent.computeWorldMatrix(true);
      const invMat = Matrix.Invert(targetParent.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(debugSvc.debugLightBox.getAbsolutePosition(), invMat);
      
      entity.light.lightPosX = localPos.x;
      entity.light.lightPosY = localPos.y;
      entity.light.lightPosZ = localPos.z;
      entity.syncToView();
    }
  }
}