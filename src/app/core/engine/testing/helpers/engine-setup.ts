import { NullEngine, Scene, ArcRotateCamera, Vector3, UniversalCamera, DefaultRenderingPipeline } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { LoopManagerService } from '../../behaviors/services/loop-manager.service';

export function setupTestEngine(motor3d: Motor3dService, loopManager: LoopManagerService) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  
  motor3d.engine = engine;
  motor3d.scene = scene;
  
  // Instanciamos las cámaras requeridas en Headless Mode
  const edCam = new ArcRotateCamera('editorCamera', 0, 0, 10, Vector3.Zero(), scene);
  const fpsCam = new UniversalCamera('playerCameraFPS', Vector3.Zero(), scene);
  const tpsCam = new ArcRotateCamera('playerCameraTPS', 0, 0, 10, Vector3.Zero(), scene);
  
  motor3d.renderingPipeline = new DefaultRenderingPipeline('default', true, scene, [edCam, fpsCam, tpsCam]);

  motor3d.getEditorCamera = () => edCam;
  motor3d.getPlayerCameraFPS = () => fpsCam;
  motor3d.getPlayerCameraTPS = () => tpsCam;
  
  loopManager.initialize(scene);
}