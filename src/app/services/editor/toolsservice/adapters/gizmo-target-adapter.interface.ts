
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { ToolsDebugService } from '../tools-debug.service';
import { EditorStateService } from '../../editor-state.service';
import { ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

export interface IGizmoTargetAdapter {
  supports(subSelected: string | null, entity: GameEntity | null): boolean;
  
  getAttachTarget(debugSvc: ToolsDebugService, pivotNode: AbstractMesh | null, mesh: AbstractMesh | null): AbstractMesh | null;
  
  getCenterDragTarget(debugSvc: ToolsDebugService, mesh: AbstractMesh | null): AbstractMesh | null;
  
  applyDragDelta(delta: Vector3, debugSvc: ToolsDebugService, mesh: AbstractMesh): void;
  
  onGizmoDragged(mesh: AbstractMesh, pivotNode: AbstractMesh | null): void;
  
  syncEntity(mesh: AbstractMesh, entity: GameEntity, debugSvc: ToolsDebugService, state: EditorStateService, motor3d: ISceneAccess): void;
}