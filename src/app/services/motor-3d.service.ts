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
  Color3
} from '@babylonjs/core';

@Injectable({
  providedIn: 'root'
})
export class Motor3dService {
  public engine!: Engine;
  public scene!: Scene;
  
  // Cámaras (OrbitControls y PointerLockControls equivalentes en Babylon)
  public editorCamera!: ArcRotateCamera;
  public playerCameraFPS!: UniversalCamera;
  public playerCameraTPS!: ArcRotateCamera;
  
  public renderingPipeline!: DefaultRenderingPipeline;
  public currentFps: number = 0;

  // Límites de zoom para la cámara en tercera persona
  // maxRadius = distancia máxima de alejamiento
  // minRadius = distancia mínima a la que puede acercarse al jugador
  private readonly TPS_MIN_RADIUS = 4;
  private readonly TPS_MAX_RADIUS = 12;

  iniciarMotor(canvas: HTMLCanvasElement): void {
    // 🔥 CONFIGURACIÓN AAA Y ANTIALIASING
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

    this.renderingPipeline = new DefaultRenderingPipeline(
      'defaultPipeline',
      false,
      this.scene,
      [this.scene.activeCamera!]
    );
    this.renderingPipeline.fxaaEnabled = false;
    this.renderingPipeline.samples = 4;
    this.renderingPipeline.bloomEnabled = false;

    // --- CÁMARA 1: EDITOR (OrbitControls equivalente) ---
    this.editorCamera = new ArcRotateCamera(
      'editorCamera',
      Math.PI / 4,
      Math.PI / 3,
      25,
      Vector3.Zero(),
      this.scene
    );
    this.editorCamera.wheelPrecision = 15;
    this.editorCamera.panningSensibility = 40;
    this.editorCamera.minZ = 0.1;
    this.editorCamera.maxZ = 10000;
    this.editorCamera.attachControl(canvas, true);

    // --- CÁMARA 2: JUGADOR FPS (PointerLockControls equivalente) ---
    this.playerCameraFPS = new UniversalCamera(
      'playerCameraFPS',
      new Vector3(0, 0, 0),
      this.scene
    );
    // minZ a 0.25 para evitar hacer clipping dentro de la cabeza del modelo
    this.playerCameraFPS.minZ = 0.25;
    this.playerCameraFPS.maxZ = 10000;
    this.playerCameraFPS.keysUp = [];
    this.playerCameraFPS.keysDown = [];
    this.playerCameraFPS.keysLeft = [];
    this.playerCameraFPS.keysRight = [];
    this.playerCameraFPS.angularSensibility = 3000;
    this.playerCameraFPS.speed = 0.3;
    this.playerCameraFPS.applyGravity = false;
    this.playerCameraFPS.checkCollisions = false;

    // --- CÁMARA 3: JUGADOR TPS ---
    this.playerCameraTPS = new ArcRotateCamera(
      'playerCameraTPS',
      -Math.PI / 2,
      Math.PI / 2.5,
      10,
      Vector3.Zero(),
      this.scene
    );

    this.playerCameraTPS.minZ = 0.2;
    this.playerCameraTPS.maxZ = 10000;

    // Zoom con la rueda del mouse
    this.playerCameraTPS.wheelPrecision = 30;

    // Límite máximo de alejamiento / acercamiento
    this.playerCameraTPS.lowerRadiusLimit = this.TPS_MIN_RADIUS;
    this.playerCameraTPS.upperRadiusLimit = this.TPS_MAX_RADIUS;

    this.playerCameraTPS.angularSensibilityX = 3000;
    this.playerCameraTPS.angularSensibilityY = 3000;
    this.playerCameraTPS.checkCollisions = false;

    this.scene.activeCamera = this.editorCamera;

    // --- ILUMINACIÓN GLOBAL ---
    const ambientLight = new HemisphericLight(
      'globalLight',
      new Vector3(0, 1, 0),
      this.scene
    );
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