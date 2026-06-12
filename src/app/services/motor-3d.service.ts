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

  public editorCamera!: ArcRotateCamera;
  public playerCameraFPS!: UniversalCamera;
  public playerCameraTPS!: ArcRotateCamera;

  public renderingPipeline!: DefaultRenderingPipeline;
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

    this.renderingPipeline = new DefaultRenderingPipeline(
      'defaultPipeline',
      false,
      this.scene,
      [this.scene.activeCamera!]
    );
    this.renderingPipeline.fxaaEnabled = false;
    this.renderingPipeline.samples = 4;
    this.renderingPipeline.bloomEnabled = false;

    // --- CÁMARA 1: EDITOR ---
    this.editorCamera = new ArcRotateCamera(
      'editorCamera',
      Math.PI / 4,
      Math.PI / 3,
      25,
      Vector3.Zero(),
      this.scene
    );

    this.editorCamera.minZ = 0.01;
    this.editorCamera.maxZ = 10000;

    // Inercia más suave para que la cámara no resbale tanto al moverse rápido
    this.editorCamera.inertia = 0.8;
    this.editorCamera.panningInertia = 0.8;

    // Controles normales: click izq = girar, click der = paneo, rueda = zoom
    this.editorCamera.attachControl(canvas, true);
    this.editorCamera._panningMouseButton = 2;
    this.editorCamera.allowUpsideDown = false;

    // 🔥 LA MAGIA DE LA VELOCIDAD: Sensibilidad súper dinámica (Estilo Blender/Unity)
    this.scene.onBeforeRenderObservable.add(() => {
      if (this.scene.activeCamera === this.editorCamera) {
        // Obtenemos el radio actual. Nunca bajamos de 0.1 para no dividir por cero.
        const radius = Math.max(0.1, this.editorCamera.radius);

        // Curva de proximidad basada en una distancia de 50 metros.
        // 0 = Lejos (Radio mayor a 50) -> MUY RÁPIDO
        // 1 = Muy Cerca (Radio cercano a 0) -> LENTO Y PRECISO
        const proximity = Math.max(0, Math.min(1, 1 - (radius / 50)));

        // Giro (Click Izquierdo): De 250 (rapidísimo) a 2200 (muy lento y preciso)
        this.editorCamera.angularSensibilityX = 250 + (proximity * 1950);
        this.editorCamera.angularSensibilityY = 250 + (proximity * 1950);

        // Paneo (Click Derecho): De 25 (vuela por el mapa) a 1200 (arrastre de milímetros)
        this.editorCamera.panningSensibility = 25 + (proximity * 1175);

        // Zoom (Rueda): De 0.8 (avanza metros enteros) a 50 (avanza centímetros)
        this.editorCamera.wheelPrecision = 0.8 + (proximity * 49.2);
      }
    });

    // --- CÁMARA 2: JUGADOR FPS ---
    this.playerCameraFPS = new UniversalCamera(
      'playerCameraFPS',
      new Vector3(0, 0, 0),
      this.scene
    );
    this.playerCameraFPS.minZ = 0.01;
    this.playerCameraFPS.maxZ = 10000;
    this.playerCameraFPS.keysUp = [];
    this.playerCameraFPS.keysDown = [];
    this.playerCameraFPS.keysLeft = [];
    this.playerCameraFPS.keysRight = [];
    this.playerCameraFPS.angularSensibility = 2500;
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

    this.playerCameraTPS.minZ = 0.01;
    this.playerCameraTPS.maxZ = 10000;

    this.playerCameraTPS.wheelPrecision = 15;
    this.playerCameraTPS.angularSensibilityX = 2000;
    this.playerCameraTPS.angularSensibilityY = 2000;
    this.playerCameraTPS.lowerRadiusLimit = this.TPS_MIN_RADIUS;
    this.playerCameraTPS.upperRadiusLimit = this.TPS_MAX_RADIUS;
    this.playerCameraTPS.checkCollisions = false;
    this.playerCameraTPS._panningMouseButton = 2;
    this.playerCameraTPS.allowUpsideDown = false;

    this.scene.activeCamera = this.editorCamera;

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