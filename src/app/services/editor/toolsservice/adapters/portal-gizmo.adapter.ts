// file: src/app/services/editor/toolsservice/adapters/portal-gizmo.adapter.ts
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Vector3, Matrix, Quaternion } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class PortalGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null, mesh?: AbstractMesh | null): boolean {
    return subSelected === 'portal' || (!!mesh && (mesh.name.startsWith('debugPortal_') || mesh.name.startsWith('portalGizmoPivot_')));
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    const selectedPortal = (debugSvc as any).portalsSvc?.getSelectedPortalMesh();
    if (selectedPortal && pivotNode) {
      selectedPortal.computeWorldMatrix(true);
      pivotNode.position.copyFrom(selectedPortal.getAbsolutePosition());
      if (selectedPortal.rotationQuaternion) {
        pivotNode.rotationQuaternion = selectedPortal.rotationQuaternion.clone();
      } else {
        pivotNode.rotationQuaternion = Quaternion.FromEulerAngles(
          selectedPortal.rotation.x,
          selectedPortal.rotation.y,
          selectedPortal.rotation.z
        );
      }
      pivotNode.scaling.copyFrom(selectedPortal.scaling);
      return pivotNode;
    }
    return selectedPortal || mesh;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    const selectedPortal = (debugSvc as any).portalsSvc?.getSelectedPortalMesh();
    return selectedPortal ? selectedPortal.getAbsolutePosition() : (mesh ? mesh.getAbsolutePosition() : null);
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (!entity || !entity.light || !entity.view) return;
    const portalsSvc = (debugSvc as any).portalsSvc;
    if (!portalsSvc) return;

    const portal = portalsSvc.getSelectedPortal();
    if (!portal) return;

    entity.view.computeWorldMatrix(true);
    const invParent = Matrix.Invert(entity.view.getWorldMatrix());
    const localDelta = Vector3.TransformNormal(delta, invParent);

    portal.localPosition.x += localDelta.x;
    portal.localPosition.y += localDelta.y;
    portal.localPosition.z += localDelta.z;

    entity.isDirty = true;
    portalsSvc.syncVisuals();
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void {
    if (!pivotNode || !entity || !entity.light || !entity.view) return;
    const portalsSvc = (this as any)._portalsSvc;

    const portals = entity.light.portals;
    if (!portals || portals.length === 0) return;

    entity.view.computeWorldMatrix(true);
    const invParent = Matrix.Invert(entity.view.getWorldMatrix());

    // 1. Sincronizar posición local
    const localPos = Vector3.TransformCoordinates(pivotNode.position, invParent);

    // 2. Sincronizar rotación y normal local
    let localNormal = new Vector3(0, 0, 1);
    if (pivotNode.rotationQuaternion) {
      const parentRotMat = entity.view.getWorldMatrix().getRotationMatrix();
      const parentQuat = Quaternion.FromRotationMatrix(parentRotMat).invertInPlace();
      const localQuat = parentQuat.multiply(pivotNode.rotationQuaternion);
      localNormal = new Vector3(0, 0, 1).rotateByQuaternionToRef(localQuat, new Vector3());
    }

    // 3. Sincronizar escala del radio
    const avgScale = (pivotNode.scaling.x + pivotNode.scaling.y) * 0.5;

    // Buscar portal activo y aplicar cambios numéricos
    const activePortalId = (mesh as any).metadata?.portalId;
    const targetPortal = portals.find(p => p.id === activePortalId) || portals[0];

    if (targetPortal) {
      targetPortal.localPosition.x = localPos.x;
      targetPortal.localPosition.y = localPos.y;
      targetPortal.localPosition.z = localPos.z;

      targetPortal.localNormal.x = localNormal.x;
      targetPortal.localNormal.y = localNormal.y;
      targetPortal.localNormal.z = localNormal.z;

      if (avgScale > 0.05) {
        targetPortal.radius = Math.max(0.2, targetPortal.radius * avgScale);
        targetPortal.width = targetPortal.radius * 2;
        pivotNode.scaling.set(1, 1, 1);
      }

      entity.isDirty = true;
    }
  }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    if (!entity || !entity.light) return;
    entity.isDirty = true;
    (debugSvc as any).portalsSvc?.syncVisuals();
  }
}