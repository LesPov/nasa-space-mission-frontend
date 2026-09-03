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

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null): AbstractMesh | null {
    return debugSvc.debugCameraBox;
  }

  getCenterDragTarget(debugSvc: ToolsDebugService, mesh: AbstractMesh | null): AbstractMesh | null {
    return debugSvc.debugCameraBox;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh): void {
    if (debugSvc.debugCameraBox) {
      debugSvc.debugCameraBox.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null): void { }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    if (debugSvc.debugCameraBox) {
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(debugSvc.debugCameraBox.getAbsolutePosition(), invMat);
      
      // 🔥 FIX 1: Se eliminó el doble escalado que destrozaba la posición del Anchor de Cámara.
      // Se utiliza la coordenada local pura. TransformCoordinates ya maneja la escala.
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