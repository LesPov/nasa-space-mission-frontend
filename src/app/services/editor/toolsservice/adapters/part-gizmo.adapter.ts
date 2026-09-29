import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { GameEntity, PartOverridesComponent } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class PartGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null, mesh?: AbstractMesh | null): boolean {
    return !subSelected && !!entity && !!mesh && entity.view !== mesh;
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    return mesh; 
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    if (mesh) {
        mesh.computeWorldMatrix(true);
        return mesh.getAbsolutePosition();
    }
    return null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (mesh.parent) {
       const invMat = mesh.parent.getWorldMatrix().clone().invert();
       const localDelta = Vector3.TransformNormal(delta, invMat);
       mesh.position.addInPlace(localDelta);
    } else {
       mesh.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void {
     // Nativo
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
      // 🔥 FIX: Instanciación limpia, segura, inmutable y correcta a nivel TypeScript.
      let comp = entity.partOverrides;
      if (!comp) {
          comp = new PartOverridesComponent();
          entity.partOverrides = comp;
      }
      if (!comp.overrides[mesh.name]) {
          comp.overrides[mesh.name] = {};
      }
      const override = comp.overrides[mesh.name];

      override.position = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
      
      if (mesh.rotationQuaternion) {
          const euler = mesh.rotationQuaternion.toEulerAngles();
          override.rotation = { x: euler.x, y: euler.y, z: euler.z };
      } else {
          override.rotation = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
      }
      
      override.scale = { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z };
      entity.isDirty = true;
  }
}