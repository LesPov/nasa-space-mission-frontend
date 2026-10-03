
// RUTA: src/app/core/engine/behaviors/dynamic-camera.behavior.ts

import { Behavior, ArcRotateCamera } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from './services/loop-manager.service';
import { EditorCameraSettingsService } from '../../../services/editor/editor-camera-settings.service';
import { EDITOR_CAMERA_CALIBRATION } from '../world/world-settings.model';

export class DynamicCameraBehavior implements Behavior<ArcRotateCamera> {
  public attachedNode: ArcRotateCamera | null = null;
  private loopManager: LoopManagerService;
  private settingsSvc: EditorCameraSettingsService;

  private lastRadius = -1;
  private lastSensitivityHash = '';

  constructor(loopManager: LoopManagerService, settingsSvc: EditorCameraSettingsService) {
    this.loopManager = loopManager;
    this.settingsSvc = settingsSvc;
  }

  get name(): string {
    return 'DynamicCameraBehavior';
  }

  init(): void {}

  attach(target: ArcRotateCamera): void {
    this.attachedNode = target;
    const scene = target.getScene();

    this.loopManager.register('DynamicCamera_' + target.uniqueId, GamePhase.CAMERA, () => {
      const node = this.attachedNode;
      if (!node || scene.activeCamera !== node) return;

      const config = this.settingsSvc.settings();
      const radius = Math.max(0.2, node.radius);

      // 🔥 OPTIMIZACIÓN: Solo recalcular si la distancia o configuración cambiaron más allá de epsilon
      const hash = `${config.orbitSensitivity}_${config.zoomSensitivity}_${config.panSensitivity}_${config.inertia}`;
      const radiusDiff = Math.abs(this.lastRadius - radius);

      if (radiusDiff < 0.05 && hash === this.lastSensitivityHash) {
        return;
      }

      this.lastRadius = radius;
      this.lastSensitivityHash = hash;

      const effectiveOrbit = Math.max(0.1, config.orbitSensitivity);
      node.angularSensibilityX = EDITOR_CAMERA_CALIBRATION.ORBIT_BASE_DIVISOR / effectiveOrbit;
      node.angularSensibilityY = EDITOR_CAMERA_CALIBRATION.ORBIT_BASE_DIVISOR / effectiveOrbit;

      const effectiveZoom = Math.max(0.1, config.zoomSensitivity);
      const dynamicWheelBase = Math.max(
        EDITOR_CAMERA_CALIBRATION.ZOOM_MIN_PRECISION,
        Math.min(18.0, EDITOR_CAMERA_CALIBRATION.ZOOM_BASE_MULTIPLIER + Math.sqrt(radius) * 0.75)
      );
      node.wheelPrecision = Math.max(
        EDITOR_CAMERA_CALIBRATION.ZOOM_MIN_PRECISION,
        dynamicWheelBase / effectiveZoom
      );

      const effectivePan = Math.max(0.1, config.panSensitivity);
      const dynamicPanBase = Math.max(
        EDITOR_CAMERA_CALIBRATION.PAN_MIN_SENSIBILITY,
        Math.min(450.0, EDITOR_CAMERA_CALIBRATION.PAN_BASE_SCALE * Math.pow(radius, 0.35))
      );
      node.panningSensibility = Math.max(
        EDITOR_CAMERA_CALIBRATION.PAN_MIN_SENSIBILITY,
        dynamicPanBase / effectivePan
      );

      node.inertia = config.inertia;
      node.panningInertia = config.inertia;
      node.lowerRadiusLimit = config.minDistance;
      node.upperRadiusLimit = config.maxDistance;
    });
  }

  detach(): void {
    if (this.attachedNode) {
      this.loopManager.unregister('DynamicCamera_' + this.attachedNode.uniqueId);
    }
    this.attachedNode = null;
    this.lastRadius = -1;
    this.lastSensitivityHash = '';
  }
}