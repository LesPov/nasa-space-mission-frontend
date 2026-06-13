
import { Injectable } from '@angular/core';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  Color4,
  UniversalCamera,
  DefaultRenderingPipeline,
  Color3,
  ColorCurves,
  GlowLayer,
  Mesh
} from '@babylonjs/core';

@Injectable({
  providedIn: 'root'
})
export class Motor3dService {
  public engine!: Engine;
  public scene!: Scene;

  public editorCamera!: ArcRotateCamera;
  public playerCameraFPS!: UniversalCamera;
  public playerCameraTPS!: ArcRotateCamera;

  public renderingPipeline!: DefaultRenderingPipeline;
  public glowLayer!: GlowLayer; 
  public currentFps: number = 0;

  private readonly TPS_MIN_RADIUS = 0.5;
  private readonly TPS_MAX_RADIUS = 15;

  iniciarMotor(canvas: HTMLCanvasElement): void {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true, 
      antialias: true,
    }, true);

    this.engine.setHardwareScalingLevel(1);

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
    this.scene.autoClear = false;
    this.scene.autoClearDepthAndStencil = false;
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.25, 0);
    this.scene.skipPointerMovePicking = true;

    this.editorCamera = new ArcRotateCamera('editorCamera', Math.PI / 4, Math.PI / 3, 25, Vector3.Zero(), this.scene);
    this.editorCamera.minZ = 0.01;
    this.editorCamera.maxZ = 10000;
    this.editorCamera.inertia = 0.8;
    this.editorCamera.panningInertia = 0.8;
    this.editorCamera.attachControl(canvas, true);
    this.editorCamera._panningMouseButton = 2;
    this.editorCamera.allowUpsideDown = false;

    this.playerCameraFPS = new UniversalCamera('playerCameraFPS', new Vector3(0, 0, 0), this.scene);
    this.playerCameraFPS.minZ = 0.01;
    this.playerCameraFPS.keysUp = [];
    this.playerCameraFPS.keysDown = [];
    this.playerCameraFPS.keysLeft = [];
    this.playerCameraFPS.keysRight = [];
    this.playerCameraFPS.angularSensibility = 2500;
    this.playerCameraFPS.speed = 0.3;
    this.playerCameraFPS.applyGravity = false;
    this.playerCameraFPS.checkCollisions = false;

    this.playerCameraTPS = new ArcRotateCamera('playerCameraTPS', -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), this.scene);
    this.playerCameraTPS.minZ = 0.01;
    this.playerCameraTPS.wheelPrecision = 15;
    this.playerCameraTPS.angularSensibilityX = 2000;
    this.playerCameraTPS.angularSensibilityY = 2000;
    this.playerCameraTPS.lowerRadiusLimit = this.TPS_MIN_RADIUS;
    this.playerCameraTPS.upperRadiusLimit = this.TPS_MAX_RADIUS;
    this.playerCameraTPS.checkCollisions = false;
    this.playerCameraTPS._panningMouseButton = 2;
    this.playerCameraTPS.allowUpsideDown = false;

    this.scene.activeCamera = this.editorCamera;

    this.renderingPipeline = new DefaultRenderingPipeline('defaultPipeline', false, this.scene, this.scene.cameras);
    this.renderingPipeline.fxaaEnabled = true; 
    this.renderingPipeline.samples = 2;
    this.renderingPipeline.bloomEnabled = false; 
    this.renderingPipeline.imageProcessingEnabled = true; 

    this.glowLayer = new GlowLayer("glow", this.scene, { mainTextureFixedSize: 1024, blurKernelSize: 32 });
    this.glowLayer.intensity = 0.6; 

    this.scene.onBeforeRenderObservable.add(() => {
      if (this.scene.activeCamera === this.editorCamera) {
        const radius = Math.max(0.1, this.editorCamera.radius);
        const proximity = Math.max(0, Math.min(1, 1 - (radius / 50)));

        this.editorCamera.angularSensibilityX = 250 + (proximity * 1950);
        this.editorCamera.angularSensibilityY = 250 + (proximity * 1950);
        this.editorCamera.panningSensibility = 25 + (proximity * 1175);
        this.editorCamera.wheelPrecision = 0.8 + (proximity * 49.2);
      }

      const cam = this.scene.activeCamera;
      const useFogFade = this.scene.fogMode !== Scene.FOGMODE_NONE && cam;
      const fogStart = this.scene.fogStart;
      const fogEnd = this.scene.fogEnd;
      const time = performance.now() * 0.003;

      this.scene.meshes.forEach(m => {
          if (!m.metadata) return;

          // 🔥 FIX NIEBLA: Ocultar Burbujas, Luces y Videos gradualmente
          if (m.metadata.type === 'bubble' || m.metadata.type?.startsWith('light_') || m.metadata.type === 'video_plane') {
              if (useFogFade) {
                  const dist = Vector3.Distance(cam.globalPosition, m.getAbsolutePosition());
                  let targetVis = 1;
                  if (dist >= fogEnd) {
                      targetVis = 0;
                  } else if (dist > fogStart) {
                      targetVis = 1.0 - ((dist - fogStart) / (fogEnd - fogStart));
                      targetVis = Math.pow(targetVis, 1.2); // Curva suave de desaparición
                  }
                  
                  m.visibility = targetVis;
                  m.getChildMeshes().forEach(child => child.visibility = targetVis);
              } else {
                  m.visibility = 1;
                  m.getChildMeshes().forEach(child => child.visibility = 1);
              }
          }

          // 🔥 FIX ANIMACIÓN BURBUJA
          if (m.metadata.type === 'bubble' && m.isVisible) {
              if (!m.metadata.baseScaleX) {
                  m.metadata.baseScaleX = m.scaling.x;
                  m.metadata.baseScaleY = m.scaling.y;
                  m.metadata.baseScaleZ = m.scaling.z;
              }
              
              const isHovered = m.metadata.isHovered === true;
              const targetHoverScale = isHovered ? 1.15 : 1.0; 
              
              if (m.metadata.currentHoverScale === undefined) m.metadata.currentHoverScale = 1.0;
              m.metadata.currentHoverScale += (targetHoverScale - m.metadata.currentHoverScale) * 0.15;
              
              const pulse = 1 + Math.sin(time + m.uniqueId) * 0.025; 
              const finalScale = pulse * m.metadata.currentHoverScale;
              
              m.scaling.set(
                  m.metadata.baseScaleX * finalScale,
                  m.metadata.baseScaleY * finalScale,
                  m.metadata.baseScaleZ * finalScale
              );
              
              m.billboardMode = Mesh.BILLBOARDMODE_ALL; 
          }
      });
    });

    // Control de límite de niebla nativo
    this.scene.onBeforeCameraRenderObservable.add((camera) => {
      if (camera.name === 'editorCamera') {
        this.scene.fogEnabled = false;
      } else {
        this.scene.fogEnabled = true;
      }
    });

    const ambientLight = new HemisphericLight('globalLight', new Vector3(0, 1, 0), this.scene);
    ambientLight.intensity = 1.0;
    ambientLight.diffuse = new Color3(1, 1, 1);
    ambientLight.groundColor = new Color3(0.2, 0.2, 0.2);

    this.engine.runRenderLoop(() => {
      this.scene.render();
      this.currentFps = this.engine.getFps();
    });

    window.addEventListener('resize', () => {
      this.forzarRedimension();
    });
  }

  setVisualMode(mode: 'normal' | 'bw'): void {
    if (!this.renderingPipeline) return;

    const isBw = mode === 'bw';
    const curves = new ColorCurves();

    if (isBw) {
      curves.globalSaturation = -100; 
      curves.globalHue = 0;
      curves.globalDensity = 0;
    }

    this.renderingPipeline.imageProcessing.colorCurvesEnabled = isBw;
    if (isBw) this.renderingPipeline.imageProcessing.colorCurves = curves;
    this.renderingPipeline.imageProcessing.exposure = isBw ? 0.98 : 1.0;
    this.renderingPipeline.imageProcessing.contrast = isBw ? 1.15 : 1.0; 

    this.scene.imageProcessingConfiguration.colorCurvesEnabled = isBw;
    if (isBw) this.scene.imageProcessingConfiguration.colorCurves = curves;
    this.scene.imageProcessingConfiguration.exposure = isBw ? 0.98 : 1.0;
    this.scene.imageProcessingConfiguration.contrast = isBw ? 1.15 : 1.0;

    this.scene.materials.forEach(mat => {
      if ((mat as any).imageProcessingConfiguration) {
        (mat as any).imageProcessingConfiguration.colorCurvesEnabled = isBw;
        if (isBw) (mat as any).imageProcessingConfiguration.colorCurves = curves;
        (mat as any).imageProcessingConfiguration.exposure = isBw ? 0.98 : 1.0;
        (mat as any).imageProcessingConfiguration.contrast = isBw ? 1.15 : 1.0;
      }
    });
  }

  forzarRedimension(): void {
    if (this.engine) {
      setTimeout(() => this.engine.resize(), 50);
      setTimeout(() => this.engine.resize(), 150);
    }
  }

  detenerMotor(): void {
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.scene.dispose();
      this.engine.dispose();
    }
  }
}