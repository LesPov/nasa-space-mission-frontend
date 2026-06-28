
import { Injectable, inject, Injector } from '@angular/core';
import {
  Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, Color4,
  UniversalCamera, DefaultRenderingPipeline, Color3, GlowLayer, Camera
} from '@babylonjs/core';
import { LoopManagerService } from '../core/engine/behaviors/services/loop-manager.service';
import { CameraFactoryService } from '../core/engine/runtime/cameras/camera-factory.service';
import { CameraOwnershipService } from '../core/engine/runtime/cameras/camera-ownership.service';
import { CinematicDirectorService } from '../core/engine/runtime/systems/cinematic-director.service';

@Injectable({
  providedIn: 'root'
})
export class Motor3dService {
  public engine!: Engine;
  public scene!: Scene;

  private cameraFactory = inject(CameraFactoryService);
  private loopManager = inject(LoopManagerService);
  private ownership = inject(CameraOwnershipService);
  private injector = inject(Injector);

  public renderingPipeline!: DefaultRenderingPipeline;
  public glowLayer!: GlowLayer; 
  public currentFps: number = 0;

  // 🔥 FIX: Agregada protección contra accesos prematuros desde los Signals antes de inicializar el Engine
  get editorCamera(): ArcRotateCamera {
    if (!this.engine || !this.scene) return null as any;
    const cam = this.cameraFactory.getCamera('EDITOR', this.scene, this.engine.getRenderingCanvas());
    this._ensureCameraInPipeline(cam);
    return cam;
  }

  get playerCameraFPS(): UniversalCamera {
    if (!this.engine || !this.scene) return null as any;
    const cam = this.cameraFactory.getCamera('FPS', this.scene, this.engine.getRenderingCanvas());
    this._ensureCameraInPipeline(cam);
    return cam;
  }

  get playerCameraTPS(): ArcRotateCamera {
    if (!this.engine || !this.scene) return null as any;
    const cam = this.cameraFactory.getCamera('TPS', this.scene, this.engine.getRenderingCanvas());
    this._ensureCameraInPipeline(cam);
    return cam;
  }

  private _ensureCameraInPipeline(camera: any): void {
    if (camera && camera instanceof Camera && this.renderingPipeline && !this.renderingPipeline.cameras.includes(camera)) {
      this.renderingPipeline.addCamera(camera);
    }
  }

  iniciarMotor(canvas: HTMLCanvasElement): void {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true, 
      antialias: false, 
      desynchronized: true, 
      powerPreference: "high-performance" 
    }, true);

    this.engine.renderEvenInBackground = true; 
    this.engine.setHardwareScalingLevel(1);

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
    this.scene.autoClear = false;
    this.scene.autoClearDepthAndStencil = false;
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.25, 0);
    this.scene.skipPointerMovePicking = true;

    this.loopManager.initialize(this.scene);
    
    // 🔥 FIX: Garantiza que el Director cinemático corre en tiempo real incluso en el Editor
    const cinematicDirector = this.injector.get(CinematicDirectorService);
    this.loopManager.registerSystem(cinematicDirector);

    this.cameraFactory.initializeCameras(this.scene, canvas);

    this.renderingPipeline = new DefaultRenderingPipeline('defaultPipeline', false, this.scene, this.scene.cameras);
    this.renderingPipeline.fxaaEnabled = true; 
    this.renderingPipeline.samples = 1; 
    this.renderingPipeline.bloomEnabled = false; 
    this.renderingPipeline.imageProcessingEnabled = true; 

    this.glowLayer = new GlowLayer("glow", this.scene, { mainTextureFixedSize: 512, blurKernelSize: 16 });
    this.glowLayer.intensity = 0.6; 

    this.scene.onBeforeCameraRenderObservable.add(() => {
      this.scene.fogEnabled = this.ownership.getOwner() !== 'EDITOR';
    });

    const ambientLight = new HemisphericLight('globalLight', new Vector3(0, 1, 0), this.scene);
    ambientLight.intensity = 1.0;
    ambientLight.diffuse = new Color3(1, 1, 1);
    ambientLight.groundColor = new Color3(0.2, 0.2, 0.2);

    this.engine.runRenderLoop(() => {
      this.scene.render();
      this.currentFps = this.engine.getFps();
    });

    window.addEventListener('resize', () => this.forzarRedimension());
  }

  setVisualMode(mode: 'normal' | 'bw'): void {
    if (!this.renderingPipeline) return;
    const isBw = mode === 'bw';

    this.renderingPipeline.imageProcessing.colorCurvesEnabled = false;
    this.renderingPipeline.imageProcessing.exposure = isBw ? 0.98 : 1.0;
    this.renderingPipeline.imageProcessing.contrast = isBw ? 1.15 : 1.0; 

    this.scene.imageProcessingConfiguration.colorCurvesEnabled = false;
    this.scene.imageProcessingConfiguration.exposure = isBw ? 0.98 : 1.0;
    this.scene.imageProcessingConfiguration.contrast = isBw ? 1.15 : 1.0;
  }

  forzarRedimension(): void {
    if (this.engine) {
      setTimeout(() => this.engine.resize(), 50);
      setTimeout(() => this.engine.resize(), 150);
    }
  }

  detenerMotor(): void {
    if (this.engine) {
      this.loopManager.dispose();
      this.cameraFactory.dispose();
      this.engine.stopRenderLoop();
      this.scene.dispose();
      this.engine.dispose();
    }
  }
}