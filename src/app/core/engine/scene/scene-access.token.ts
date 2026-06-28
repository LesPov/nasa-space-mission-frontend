
import { InjectionToken, forwardRef, inject } from '@angular/core';
import { Scene, Engine, ArcRotateCamera, UniversalCamera, DefaultRenderingPipeline } from '@babylonjs/core';
import { Motor3dService } from '../../../services/motor-3d.service';

export interface ISceneAccess {
  getScene(): Scene;
  getEngine(): Engine;
  getEditorCamera(): ArcRotateCamera;
  getPlayerCameraFPS(): UniversalCamera;
  getPlayerCameraTPS(): ArcRotateCamera;
  getRenderingPipeline(): DefaultRenderingPipeline;
  getCurrentFps(): number;
  setVisualMode(mode: 'normal' | 'bw'): void;
  forceResize(): void;
}

export const SCENE_ACCESS_TOKEN = new InjectionToken<ISceneAccess>('SCENE_ACCESS_TOKEN', {
  providedIn: 'root',
  factory: () => inject(forwardRef(() => Motor3dService))
});