
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
      mesh.computeWorldMatrix(true);
      const worldMatrix = mesh.getWorldMatrix();
      
      if (entity.type.startsWith('light_') || (mesh as any).metadata?.isLightVisual) {
        pivotNode.position.copyFrom(mesh.getAbsolutePosition());
        pivotNode.rotationQuaternion = Quaternion.FromRotationMatrix(worldMatrix.getRotationMatrix());
        pivotNode.scaling.set(1, 1, 1);
        this.compensarEscalaVisual(mesh);
        return pivotNode;
      }

      entity.getVisualCenterAbsoluteToRef(BaseEntityGizmoAdapter._tempWorldCenter);
      pivotNode.position.copyFrom(BaseEntityGizmoAdapter._tempWorldCenter);
      
      pivotNode.rotationQuaternion = Quaternion.FromRotationMatrix(worldMatrix.getRotationMatrix());
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
        
        if (mesh.parent) {
            const parentRotMat = mesh.parent.getWorldMatrix().getRotationMatrix();
            const parentQuat = Quaternion.FromRotationMatrix(parentRotMat);
            parentQuat.invertInPlace();
            mesh.rotationQuaternion = parentQuat.multiply(pivotNode.rotationQuaternion);
        } else {
            mesh.rotationQuaternion.copyFrom(pivotNode.rotationQuaternion);
        }
      }

      this.compensarEscalaVisual(mesh);
      return;
    }

    if (pivotNode.rotationQuaternion) {
      if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
      
      if (mesh.parent) {
          const parentRotMat = mesh.parent.getWorldMatrix().getRotationMatrix();
          const parentQuat = Quaternion.FromRotationMatrix(parentRotMat);
          parentQuat.invertInPlace();
          mesh.rotationQuaternion = parentQuat.multiply(pivotNode.rotationQuaternion);
      } else {
          mesh.rotationQuaternion.copyFrom(pivotNode.rotationQuaternion);
      }
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

    const targetWorldPos = pivotNode.position.subtract(BaseEntityGizmoAdapter._tempWorldOffset);

    if (mesh.parent) {
      mesh.parent.computeWorldMatrix(true);
      const invParent = Matrix.Invert(mesh.parent.getWorldMatrix());
      mesh.position = Vector3.TransformCoordinates(targetWorldPos, invParent);
    } else {
      mesh.position.copyFrom(targetWorldPos);
    }

    mesh.getChildMeshes().forEach(m => {
      if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
        this.compensarEscalaVisual(m.parent as AbstractMesh || m);
      }
    });
  }

  /**
   * Garantiza que el multiplicador del tamaño visual (0.4m) sea perfecto y sin deformaciones.
   * Ahora sólo recomputa la matriz si la escala es genuinamente divergente.
   */
  public compensarEscalaVisual(mesh: AbstractMesh): void {
    if (!mesh) return;
    const visual = mesh.getChildMeshes().find(m => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
    
    if (visual) {
      mesh.computeWorldMatrix(true);
      const absScale = new Vector3();
      mesh.getWorldMatrix().decompose(absScale);
      
      const safeX = Math.max(0.0001, Math.abs(absScale.x));
      const safeY = Math.max(0.0001, Math.abs(absScale.y));
      const safeZ = Math.max(0.0001, Math.abs(absScale.z));

      const targetX = 0.4 / safeX;
      const targetY = 0.4 / safeY;
      const targetZ = 0.4 / safeZ;

      if (Math.abs(visual.scaling.x - targetX) > 0.001 ||
          Math.abs(visual.scaling.y - targetY) > 0.001 ||
          Math.abs(visual.scaling.z - targetZ) > 0.001) {
          
          visual.scaling.set(targetX, targetY, targetZ);
          visual.computeWorldMatrix(true); 
          visual.renderingGroupId = 1;
      }
    }
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    entity.syncTransformFromView();
    entity.syncToView();
    this.compensarEscalaVisual(mesh);
  }
}