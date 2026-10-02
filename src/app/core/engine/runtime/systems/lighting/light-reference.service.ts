
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { GameMode } from '../../../session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class LightReferenceService {
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  private static _fallbackPos = Vector3.Zero();

  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
      const mode = this.context.mode();
      const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

      if (isEditorPure) {
          const editorCam = this.motor3d.getEditorCamera();
          return editorCam ? editorCam.globalPosition : LightReferenceService._fallbackPos;
      }

      const refMode = customMode || 'AUTO';

      if (refMode === 'CAMERA') {
          const camera = this.ownership.getCamera();
          return camera ? camera.globalPosition : LightReferenceService._fallbackPos;
      }

      if (refMode === 'PLAYER') {
          const playerEntity = this.context.activePlayerEntity();
          if (playerEntity && playerEntity.view) {
              return playerEntity.view.getAbsolutePosition();
          }
      }

      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }

      const camera = this.ownership.getCamera();
      if (camera) return camera.globalPosition;

      return LightReferenceService._fallbackPos;
  }
}