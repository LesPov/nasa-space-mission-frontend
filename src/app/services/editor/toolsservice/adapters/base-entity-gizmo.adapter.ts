
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Vector3, Quaternion, Matrix, Tags } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class BaseEntityGizmoAdapter implements IGizmoTargetAdapter {
  private static _tempLocal = Vector3.Zero();
  private static _tempWorldOffset = Vector3.Zero();
  private static _tempWorldCenter = Vector3.Zero();

  supports(subSelected: string | null, entity: GameEntity | null, mesh?: AbstractMesh | null): boolean {
    return !subSelected && (!mesh || !entity || mesh === entity.view || (mesh as any).metadata?.isLightVisual);
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    if (mesh && pivotNode && entity) {
      // Si es una entidad de luz, el gizmo se ancla directamente sobre su posición absoluta
      if (entity.type.startsWith('light_') || (mesh as any).metadata?.isLightVisual) {
        mesh.computeWorldMatrix(true);
        pivotNode.position.copyFrom(mesh.getAbsolutePosition());
        if (mesh.rotationQuaternion) {
          pivotNode.rotationQuaternion = mesh.rotationQuaternion.clone();
        } else {
          pivotNode.rotation = mesh.rotation.clone();
        }
        pivotNode.scaling.set(1, 1, 1);
        this.compensarEscalaVisual(mesh);
        return pivotNode;
      }

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
      if (entity.type.startsWith('light_') || (mesh as any).metadata?.isLightVisual) {
        mesh.computeWorldMatrix(true);
        this.compensarEscalaVisual(mesh);
        return mesh.getAbsolutePosition();
      }
      entity.getVisualCenterAbsoluteToRef(BaseEntityGizmoAdapter._tempWorldCenter);
      return BaseEntityGizmoAdapter._tempWorldCenter;
    }
    return null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (mesh.parent) {
      const invParent = mesh.parent.getWorldMatrix().clone().invert();
      const localDelta = Vector3.TransformNormal(delta, invParent);
      mesh.position.addInPlace(localDelta);
    } else {
      mesh.position.addInPlace(delta);
    }
    this.compensarEscalaVisual(mesh);
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void {
    if (!pivotNode || !entity) return;

    // Si es una entidad de luz (anclada o libre):
    if (entity.type.startsWith('light_') || (mesh as any).metadata?.isLightVisual) {
      if (mesh.parent) {
        mesh.parent.computeWorldMatrix(true);
        const invParent = Matrix.Invert(mesh.parent.getWorldMatrix());
        mesh.position = Vector3.TransformCoordinates(pivotNode.position, invParent);
      } else {
        mesh.position.copyFrom(pivotNode.position);
      }

      if (pivotNode.rotationQuaternion) {
        if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
        mesh.rotationQuaternion.copyFrom(pivotNode.rotationQuaternion);
      } else {
        mesh.rotation.copyFrom(pivotNode.rotation);
      }

      this.compensarEscalaVisual(mesh);
      return;
    }

    if (pivotNode.rotationQuaternion) {
      if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
      mesh.rotationQuaternion.copyFrom(pivotNode.rotationQuaternion);
    } else {
      mesh.rotation.copyFrom(pivotNode.rotation);
    }
    mesh.scaling.copyFrom(pivotNode.scaling);

    entity.getVisualCenterLocalToRef(BaseEntityGizmoAdapter._tempLocal);

    BaseEntityGizmoAdapter._tempLocal.x *= mesh.scaling.x;
    BaseEntityGizmoAdapter._tempLocal.y *= mesh.scaling.y;
    BaseEntityGizmoAdapter._tempLocal.z *= mesh.scaling.z;

    const rotMatrix = Matrix.Identity();
    if (mesh.rotationQuaternion) {
       mesh.rotationQuaternion.toRotationMatrix(rotMatrix);
    } else {
       Matrix.RotationYawPitchRollToRef(mesh.rotation.y, mesh.rotation.x, mesh.rotation.z, rotMatrix);
    }

    Vector3.TransformCoordinatesToRef(BaseEntityGizmoAdapter._tempLocal, rotMatrix, BaseEntityGizmoAdapter._tempWorldOffset);

    mesh.position.copyFrom(pivotNode.position).subtractInPlace(BaseEntityGizmoAdapter._tempWorldOffset);

    mesh.getChildMeshes().forEach(m => {
      if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
        this.compensarEscalaVisual(m.parent as AbstractMesh || m);
      }
    });
  }

  public compensarEscalaVisual(mesh: AbstractMesh): void {
    if (!mesh) return;
    const visual = mesh.getChildMeshes().find(m => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
    if (visual && mesh.parent) {
      mesh.parent.computeWorldMatrix(true);
      const parentScale = new Vector3();
      mesh.parent.getWorldMatrix().decompose(parentScale);
      
      const safeX = Math.max(0.0001, Math.abs(parentScale.x * mesh.scaling.x));
      const safeY = Math.max(0.0001, Math.abs(parentScale.y * mesh.scaling.y));
      const safeZ = Math.max(0.0001, Math.abs(parentScale.z * mesh.scaling.z));

      // Mantener tamaño constante de 0.4m mundiales sin importar la escala diminuta del padre
      visual.scaling.set(0.4 / safeX, 0.4 / safeY, 0.4 / safeZ);
      visual.renderingGroupId = 1;
    } else if (visual) {
      const safeX = Math.max(0.0001, Math.abs(mesh.scaling.x));
      const safeY = Math.max(0.0001, Math.abs(mesh.scaling.y));
      const safeZ = Math.max(0.0001, Math.abs(mesh.scaling.z));
      visual.scaling.set(0.4 / safeX, 0.4 / safeY, 0.4 / safeZ);
      visual.renderingGroupId = 1;
    }
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    entity.syncTransformFromView();
    entity.syncToView();

    if (entity.light) {
      entity.light.lightPosX = entity.transform.position.x;
      entity.light.lightPosY = entity.transform.position.y;
      entity.light.lightPosZ = entity.transform.position.z;
      entity.light.lightRotX = entity.transform.rotation.x * (180 / Math.PI);
      entity.light.lightRotY = entity.transform.rotation.y * (180 / Math.PI);
      entity.light.lightRotZ = entity.transform.rotation.z * (180 / Math.PI);
    }
    this.compensarEscalaVisual(mesh);
  }
}