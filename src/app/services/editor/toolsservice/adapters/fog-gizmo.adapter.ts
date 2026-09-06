
import { IGizmoTargetAdapter } from './gizmo-target-adapter.interface';
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export class FogGizmoAdapter implements IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null): boolean {
    return subSelected === 'fog' && !!entity?.playerConfig?.fog;
  }

  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null, entity: GameEntity | null): AbstractMesh | null {
    return debugSvc.debugFogStartSphere;
  }

  getCenterPosition(debugSvc: ToolsDebugService, mesh: AbstractMesh | null, entity: GameEntity | null): Vector3 | null {
    return debugSvc.debugFogStartSphere ? debugSvc.debugFogStartSphere.getAbsolutePosition() : null;
  }

  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh, entity: GameEntity | null): void {
    if (debugSvc.debugFogStartSphere) {
      debugSvc.debugFogStartSphere.position.addInPlace(delta);
    }
  }

  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null, entity: GameEntity | null): void { }

  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void {
    if (debugSvc.debugFogStartSphere) {
      const playerPos = mesh.getAbsolutePosition();
      const fogConfig = entity.playerConfig?.fog;
      if (!fogConfig || !entity.playerConfig) return;

      const isBW = motor3d.getScene()?.metadata?.globalVisualMode === 'bw';
      const isFPS = state.modoVistaPrueba === 'FPS';
      
      let fogHeightY = 4.0;
      if (isBW) {
          fogHeightY = Math.max(0.1, isFPS ? (fogConfig.fogHeightYStartFpsBW ?? 4.0) : (fogConfig.fogHeightYStartTpsBW ?? 4.0));
      } else {
          fogHeightY = Math.max(0.1, isFPS ? (fogConfig.fogHeightYStartFPS ?? 4.0) : (fogConfig.fogHeightYStartTPS ?? 4.0));
      }
      
      const shapeOffset = (fogConfig.fogShape === 'cylinder' ? (fogHeightY / 2) : 0);
      
      if (isFPS) {
          entity.playerConfig.fog.offsetXFPS = debugSvc.debugFogStartSphere.position.x - playerPos.x;
          entity.playerConfig.fog.offsetYFPS = debugSvc.debugFogStartSphere.position.y - playerPos.y - shapeOffset;
          entity.playerConfig.fog.offsetZFPS = debugSvc.debugFogStartSphere.position.z - playerPos.z;
      } else {
          entity.playerConfig.fog.offsetXTPS = debugSvc.debugFogStartSphere.position.x - playerPos.x;
          entity.playerConfig.fog.offsetYTPS = debugSvc.debugFogStartSphere.position.y - playerPos.y - shapeOffset;
          entity.playerConfig.fog.offsetZTPS = debugSvc.debugFogStartSphere.position.z - playerPos.z;
      }
      entity.syncToView();
    }
  }
}