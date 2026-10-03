// RUTA: src/app/core/engine/behaviors/dynamic-camera.behavior.ts
// ACCIÓN: MODIFICAR

import { Behavior, ArcRotateCamera } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from './services/loop-manager.service';
import { EditorCameraSettingsService } from '../../../services/editor/editor-camera-settings.service';
import { EDITOR_CAMERA_CALIBRATION } from '../world/world-settings.model';

export class DynamicCameraBehavior implements Behavior<ArcRotateCamera> {
  public attachedNode: ArcRotateCamera | null = null;
  private loopManager: LoopManagerService;
  private settingsSvc: EditorCameraSettingsService;

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
      if (node && scene.activeCamera === node) {
        const config = this.settingsSvc.settings();
        const radius = Math.max(0.2, node.radius);

        // 1. CALIBRACIÓN DE ÓRBITA (REFERENCIA PRINCIPAL - CONSERVADA IDÉNTICA)
        // La sensibilidad actual ya le gusta al creador, por lo que 2200 / orbitSensitivity
        // permanece inmutable como ancla de comportamiento.
        const effectiveOrbit = Math.max(0.1, config.orbitSensitivity);
        node.angularSensibilityX = EDITOR_CAMERA_CALIBRATION.ORBIT_BASE_DIVISOR / effectiveOrbit;
        node.angularSensibilityY = EDITOR_CAMERA_CALIBRATION.ORBIT_BASE_DIVISOR / effectiveOrbit;

        // 2. CALIBRACIÓN DE ZOOM (RUEDA DEL RATÓN - RECALIBRADA PARA MÁXIMA AGILIDAD)
        // En BabylonJS: deltaRadio = wheelDelta / wheelPrecision.
        // A MENOR wheelPrecision, MAYOR desplazamiento longitudinal por muesca.
        // Se adopta una curva que escala con la raíz cuadrada de la distancia pero con un factor base
        // mucho más sensible (4.8 en lugar de 20+), permitiendo recorrer la escena sin fatiga.
        const effectiveZoom = Math.max(0.1, config.zoomSensitivity);
        const dynamicWheelBase = Math.max(
          EDITOR_CAMERA_CALIBRATION.ZOOM_MIN_PRECISION,
          Math.min(18.0, EDITOR_CAMERA_CALIBRATION.ZOOM_BASE_MULTIPLIER + Math.sqrt(radius) * 0.75)
        );
        node.wheelPrecision = Math.max(
          EDITOR_CAMERA_CALIBRATION.ZOOM_MIN_PRECISION,
          dynamicWheelBase / effectiveZoom
        );

        // 3. CALIBRACIÓN DE PAN / DESPLAZAMIENTO (CLICK DERECHO - ALINEADO PERCEPTUALMENTE A LA ÓRBITA)
        // En BabylonJS: deltaMundo = pixelDelta / panningSensibility.
        // A MENOR panningSensibility, MAYOR avance del target por pixel de arrastre.
        // La fórmula anterior aplicaba una base de ~800, resultando en lentitud extrema.
        // Rediseñamos la base a una escala directa vinculada a la distancia (48 * radius^0.35)
        // para que arrastrar con el botón derecho acompañe al cursor con total ligereza.
        const effectivePan = Math.max(0.1, config.panSensitivity);
        const dynamicPanBase = Math.max(
          EDITOR_CAMERA_CALIBRATION.PAN_MIN_SENSIBILITY,
          Math.min(450.0, EDITOR_CAMERA_CALIBRATION.PAN_BASE_SCALE * Math.pow(radius, 0.35))
        );
        node.panningSensibility = Math.max(
          EDITOR_CAMERA_CALIBRATION.PAN_MIN_SENSIBILITY,
          dynamicPanBase / effectivePan
        );

        // 4. INERCIA Y LIMITADORES FÍSICOS
        node.inertia = config.inertia;
        node.panningInertia = config.inertia;
        node.lowerRadiusLimit = config.minDistance;
        node.upperRadiusLimit = config.maxDistance;
      }
    });
  }

  detach(): void {
    if (this.attachedNode) {
      this.loopManager.unregister('DynamicCamera_' + this.attachedNode.uniqueId);
    }
    this.attachedNode = null;
  }
}