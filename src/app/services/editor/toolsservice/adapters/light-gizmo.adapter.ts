
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

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null): AbstractMesh | null {
    return debugSvc.debugLightBox;
  }

  getCenterDragTarget(debugSvc: ToolsDebugService, mesh: AbstractMesh | null): AbstractMesh | null {
    return debugSvc.debugLightBox;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh): void {
    if (debugSvc.debugLightBox) {
      debugSvc.debugLightBox.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null): void { }

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