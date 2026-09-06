
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Matrix, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class CameraGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null): boolean {
    return subSelected === 'camera';
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    return debugSvc.debugCameraBox;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    return debugSvc.debugCameraBox ? debugSvc.debugCameraBox.getAbsolutePosition() : null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (debugSvc.debugCameraBox) {
      debugSvc.debugCameraBox.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void { }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    if (debugSvc.debugCameraBox) {
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(debugSvc.debugCameraBox.getAbsolutePosition(), invMat);
      
      entity.camOffset.x = localPos.x;
      entity.camOffset.y = localPos.y; 
      entity.camOffset.z = localPos.z;
      
      if (entity.characterConfig && entity.playerConfig) {
          entity.playerConfig.camera.fpsEyeLevel = localPos.y;
      }
      entity.syncToView();
    }
  }
}