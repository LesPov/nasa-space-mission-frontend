import { Injectable, inject, Injector } from '@angular/core';
import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, Color4, UniversalCamera, DefaultRenderingPipeline, Color3, GlowLayer, Camera, SceneInstrumentation, EngineInstrumentation } from '@babylonjs/core';
import { LoopManagerService } from '../core/engine/behaviors/services/loop-manager.service';
import { CameraFactoryService } from '../core/engine/runtime/cameras/camera-factory.service';
import { CameraOwnershipService } from '../core/engine/runtime/cameras/camera-ownership.service';
import { CinematicDirectorService } from '../core/engine/runtime/systems/cinematic-director.service';
import { ISceneAccess } from '../core/engine/scene/scene-access.token';
import { ShadowOrchestratorService } from '../core/engine/runtime/shadows/shadow-orchestrator.service';
import { DynamicLightingSystem } from '../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { FogOrchestratorService } from '../core/engine/runtime/systems/fog-orchestrator.service';
import { PlayerSequenceService } from '../core/engine/runtime/systems/player-sequence.service';
import { PlayerTriggerService } from '../core/engine/runtime/systems/player-trigger.service';
import { PlayerAnimationService } from '../core/engine/runtime/systems/player-animation.service';
import { CoreSceneMaterialService } from '../core/engine/scene/utils/core-scene-material.service';
import { EngineProfilerService } from '../core/engine/telemetry/engine-profiler.service';
import { PerformanceIncidentService } from '../core/engine/telemetry/performance-incident.service';

@Injectable({
  providedIn: 'root'
})
export class Motor3dService implements ISceneAccess {
  public engine!: Engine;
  public scene!: Scene;

  private cameraFactory = inject(CameraFactoryService);
  private loopManager = inject(LoopManagerService);
  private ownership = inject(CameraOwnershipService);
  private injector = inject(Injector);
  private profiler = inject(EngineProfilerService);

  public renderingPipeline!: DefaultRenderingPipeline;
  public glowLayer!: GlowLayer; 
  public currentFps: number = 0;
  
  private sceneInstrumentation: SceneInstrumentation | null = null;
  private engineInstrumentation: EngineInstrumentation | null = null;

  private resizeListener = () => this.forceResize();

  private lastFrameStartTime = 0;

  getScene(): Scene { return this.scene; }
  getEngine(): Engine { return this.engine; }
  getEditorCamera(): ArcRotateCamera { return this.editorCamera; }
  getPlayerCameraFPS(): UniversalCamera { return this.playerCameraFPS; }
  getPlayerCameraTPS(): ArcRotateCamera { return this.playerCameraTPS; }
  getRenderingPipeline(): DefaultRenderingPipeline { return this.renderingPipeline; }
  getCurrentFps(): number { return this.currentFps; }

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
    this.scene.ambientColor = new Color3(1, 1, 1);

    this.scene.autoClear = false;
    this.scene.autoClearDepthAndStencil = false;
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.25, 0);
    this.scene.skipPointerMovePicking = true;

    this.sceneInstrumentation = new SceneInstrumentation(this.scene);
    this.sceneInstrumentation.captureActiveMeshesEvaluationTime = true;
    this.sceneInstrumentation.captureRenderTargetsRenderTime = true;

    this.engineInstrumentation = new EngineInstrumentation(this.engine);
    this.engineInstrumentation.captureGPUFrameTime = true;

    this.loopManager.initialize(this.scene);
    
    const incidentSvc = this.injector.get(PerformanceIncidentService);
    
    const cinematicDirector = this.injector.get(CinematicDirectorService);
    this.loopManager.registerSystem(cinematicDirector);

    const shadowOrch = this.injector.get(ShadowOrchestratorService);
    this.loopManager.registerSystem(shadowOrch);

    const dynamicLighting = this.injector.get(DynamicLightingSystem);
    this.loopManager.registerSystem(dynamicLighting);

    const fogOrch = this.injector.get(FogOrchestratorService);
    this.loopManager.registerSystem(fogOrch);
    fogOrch.start();

    const playerAnimSvc = this.injector.get(PlayerAnimationService);
    this.loopManager.registerSystem(playerAnimSvc);

    const seqSvc = this.injector.get(PlayerSequenceService);
    this.loopManager.registerSystem(seqSvc);
    
    const trigSvc = this.injector.get(PlayerTriggerService);
    this.loopManager.registerSystem(trigSvc);
    trigSvc.start();

    this.profiler.attachInstruments(this.sceneInstrumentation, this.engineInstrumentation, dynamicLighting, shadowOrch, this.engine);

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

    const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    ambientLight.intensity = 1.0;
    ambientLight.diffuse = new Color3(1, 1, 1);
    ambientLight.groundColor = new Color3(0.2, 0.2, 0.2);

    this.lastFrameStartTime = performance.now();

    this.engine.runRenderLoop(() => {
      const now = performance.now();
      // Medir el tiempo transcurrido total entre cuadros para unificar frameTime con FPS
      const totalFrameDelta = now - this.lastFrameStartTime;
      this.lastFrameStartTime = now;

      this.scene.render();
      this.currentFps = this.engine.getFps();
      
      this.profiler.setFps(this.currentFps);
      this.profiler.recordFrameTime(totalFrameDelta > 0 ? totalFrameDelta : 16.67);
      this.profiler.endFrame();

      if (this.currentFps > 0) { 
         incidentSvc.checkFrame(totalFrameDelta, this.currentFps);
      }
    });

    window.removeEventListener('resize', this.resizeListener);
    window.addEventListener('resize', this.resizeListener);
  }

  setVisualMode(mode: 'normal' | 'bw'): void {
    if (!this.renderingPipeline || !this.scene) return;
    const isBw = mode === 'bw';
    this.renderingPipeline.imageProcessing.colorCurvesEnabled = false;
    this.renderingPipeline.imageProcessing.exposure = isBw ? 0.98 : 1.0;
    this.renderingPipeline.imageProcessing.contrast = isBw ? 1.15 : 1.0; 
    this.scene.imageProcessingConfiguration.colorCurvesEnabled = false;
    this.scene.imageProcessingConfiguration.exposure = isBw ? 0.98 : 1.0;
    this.scene.imageProcessingConfiguration.contrast = isBw ? 1.15 : 1.0;
  }

  forceResize(): void {
    if (this.engine) {
      setTimeout(() => this.engine.resize(), 50);
      setTimeout(() => this.engine.resize(), 150);
    }
  }

  detenerMotor(): void {
    window.removeEventListener('resize', this.resizeListener);
    
    this.injector.get(CoreSceneMaterialService).clearCache();
    this.injector.get(ShadowOrchestratorService).stop();
    this.injector.get(PlayerAnimationService).limpiarEstados();
    this.injector.get(CinematicDirectorService).dispose();
    this.injector.get(DynamicLightingSystem).stop();

    if (this.sceneInstrumentation) { this.sceneInstrumentation.dispose(); this.sceneInstrumentation = null; }
    if (this.engineInstrumentation) { this.engineInstrumentation.dispose(); this.engineInstrumentation = null; }

    if (this.engine) {
      this.ownership.resetWatcher(); 
      const fogOrch = this.injector.get(FogOrchestratorService);
      fogOrch.stop();
      
      const trigSvc = this.injector.get(PlayerTriggerService);
      trigSvc.stop();
      
      this.loopManager.dispose();
      this.cameraFactory.dispose();
      
      this.engine.stopRenderLoop();
      if(this.scene) {
        this.scene.dispose();
      }
      this.engine.dispose();
      this.scene = null as any;
      this.engine = null as any;
    }
  }
}