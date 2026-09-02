
import { Injectable, inject } from '@angular/core';
import {
  AbstractMesh, Animation, ArcRotateCamera, Camera, CubicEase, EasingFunction,
  Node, Vector3, UniversalCamera, Curve3, Quaternion
} from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorStateService } from './editor-state.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { GameContextService } from '../../core/engine/session/game-context.service';

@Injectable({ providedIn: 'root' })
export class EditorCameraService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private transitionSvc = inject(EditorModeTransitionService);
  private ownership = inject(CameraOwnershipService);
  private gameContext = inject(GameContextService);

  private editorCamState: { target: Vector3; radius: number; alpha: number; beta: number; position: Vector3 } | null = null;

  private obtenerCamaraJuegoActiva(): Camera | null {
    return this.ownership.getCamera();
  }

  private obtenerEncuadreObjeto(objeto: AbstractMesh): { target: Vector3; radius: number } {
    objeto.computeWorldMatrix(true);

    const entity = this.entityManager.getEntityByMesh(objeto);
    const collider = entity?.collider;

    if (collider && collider.type !== 'mesh') {
      const colOffsetX = Number(collider.offsetX || 0);
      const colOffsetY = Number(collider.offsetY || 0);
      const colOffsetZ = Number(collider.offsetZ || 0);

      const target = Vector3.TransformCoordinates(
        new Vector3(colOffsetX, colOffsetY, colOffsetZ),
        objeto.getWorldMatrix()
      );

      const sizeX = Math.max(0.5, Number(collider.sizeX || collider.sizeY || 1)) * Math.abs(objeto.scaling.x);
      const sizeY = Math.max(0.5, Number(collider.sizeY || 1)) * Math.abs(objeto.scaling.y);
      const sizeZ = Math.max(0.5, Number(collider.sizeZ || collider.sizeY || 1)) * Math.abs(objeto.scaling.z);

      const diagonal = Math.sqrt((sizeX * sizeX) + (sizeY * sizeY) + (sizeZ * sizeZ));
      let radius = Math.max(4.0, diagonal * 2.2);
      radius = Math.min(radius, 1000); 

      return { target, radius };
    }

    const boundingVectors = objeto.getHierarchyBoundingVectors(true);
    const min = boundingVectors.min;
    const max = boundingVectors.max;
    const target = min.add(max).scale(0.5);
    const size = max.subtract(min);

    const diagonal = size.length();
    let radius = Math.max(4.0, diagonal * 2.0);
    radius = Math.min(radius, 1000); 

    return { target, radius };
  }

  private asegurarCamaraEditorActiva(): void {
    const scene = this.motor3d.getScene();
    const editorCam = this.motor3d.getEditorCamera();
    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();

    if (!scene || !editorCam) return;
    this.ownership.setCamera('EDITOR', editorCam, canvas, true);
  }

  private reafirmarCamaraEditorEnSiguienteFrame(): void {
    const editorCam = this.motor3d.getEditorCamera();
    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();

    if (!editorCam) return;

    requestAnimationFrame(() => {
      if (this.ownership.getOwner() !== 'EDITOR') {
        this.ownership.setCamera('EDITOR', editorCam, canvas, true);
      }
    });
  }

  guardarEstadoCamaraLibre(): void {
    const editorCam = this.motor3d.getEditorCamera();
    if (!editorCam) return;

    editorCam.computeWorldMatrix();

    this.editorCamState = {
      target: editorCam.getTarget().clone(),
      radius: editorCam.radius,
      alpha: editorCam.alpha,
      beta: editorCam.beta,
      position: editorCam.globalPosition.clone()
    };
  }

  restaurarCamaraLibre(): void {
    const editorCam = this.motor3d.getEditorCamera();
    if (!editorCam || !this.editorCamState) return;

    // 1. Restaurar Posiciones Geométricas (Target y Rotaciones)
    editorCam.setTarget(this.editorCamState.target.clone());
    editorCam.radius = this.editorCamState.radius;
    editorCam.alpha = this.editorCamState.alpha;
    editorCam.beta = this.editorCamState.beta;

    // 2. 🔥 Limpiar cualquier inercia sobrante que haga salir la cámara volando
    editorCam.inertialAlphaOffset = 0;
    editorCam.inertialBetaOffset = 0;
    editorCam.inertialRadiusOffset = 0;
    editorCam.inertialPanningX = 0;
    editorCam.inertialPanningY = 0;
  }

  enfocarObjetoEnEditor(objeto: Node): void {
    if (!objeto || !(objeto instanceof AbstractMesh)) return;
    
    const state = this.state.playState();
    if (state !== 'EDITOR' && state !== 'EDITING_IN_GAME') return;

    const cam = this.motor3d.getEditorCamera();
    if (!cam) return;

    const { target, radius } = this.obtenerEncuadreObjeto(objeto);

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const currentTarget = cam.getTarget().clone();
    
    const frames = 25;
    const animTarget = new Animation('camTargInEd', 'target', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animRadius = new Animation('camRadInEd', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    animTarget.setEasingFunction(ease);
    animRadius.setEasingFunction(ease);
    
    animTarget.setKeys([ { frame: 0, value: currentTarget }, { frame: frames, value: target } ]);
    animRadius.setKeys([ { frame: 0, value: cam.radius }, { frame: frames, value: radius } ]);

    this.motor3d.getScene().beginDirectAnimation(cam, [animTarget, animRadius], 0, frames, false, 1.0);
  }

  enfocarCoordenadas(pos: Vector3, radius: number = 4): void {
    const cam = this.motor3d.getEditorCamera();
    if (!cam) return;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const currentTarget = cam.getTarget().clone();
    
    const frames = 30;
    const animTarget = new Animation('camTargCoord', 'target', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animRadius = new Animation('camRadCoord', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    animTarget.setEasingFunction(ease);
    animRadius.setEasingFunction(ease);
    
    animTarget.setKeys([ { frame: 0, value: currentTarget }, { frame: frames, value: pos } ]);
    animRadius.setKeys([ { frame: 0, value: cam.radius }, { frame: frames, value: radius } ]);

    this.motor3d.getScene().beginDirectAnimation(cam, [animTarget, animRadius], 0, frames, false, 1.0);
  }

  public transicionACamaraCinematica(targetPos: Vector3, targetRot: Vector3, fov: number | undefined, onComplete: () => void): void {
      const startCam = this.ownership.getCamera();
      if (!startCam) { onComplete(); return; }
      
      const posE = startCam.globalPosition;
      const targetE = ('getTarget' in startCam) ? (startCam as any).getTarget() : startCam.globalPosition.add(startCam.getDirection(Vector3.Forward()));
      
      const posDest = targetPos.clone();
      const qDest = Quaternion.FromEulerAngles(targetRot.x, targetRot.y, targetRot.z);
      const vForward = new Vector3(0,0,1);
      vForward.rotateByQuaternionToRef(qDest, vForward);
      const targetDest = posDest.add(vForward.scale(10));

      this.animateCameraProxy(
          posE, targetE,
          posDest, targetDest,
          30, onComplete, false
      );
  }

  public transicionDesdeCamaraCinematica(targetCam: Camera, onComplete: () => void): void {
      const startCam = this.ownership.getCamera();
      if (!startCam) { onComplete(); return; }
      
      const posE = startCam.globalPosition;
      const targetE = startCam.globalPosition.add(startCam.getDirection(Vector3.Forward()));
      
      const posDest = targetCam.globalPosition;
      const targetDest = ('getTarget' in targetCam) ? (targetCam as any).getTarget() : targetCam.globalPosition.add(targetCam.getDirection(Vector3.Forward()));
      
      this.animateCameraProxy(
          posE, targetE,
          posDest, targetDest,
          30, onComplete, false
      );
  }

  entrarCamaraFija(pos: Vector3, rot: Vector3, fov?: number): void {
      let proxyCam = this.motor3d.getScene().getCameraByName('staticPreviewCam') as UniversalCamera;
      if (!proxyCam) {
          proxyCam = new UniversalCamera('staticPreviewCam', pos, this.motor3d.getScene());
          proxyCam.minZ = 0.05;
      } else {
          proxyCam.position.copyFrom(pos);
      }
      
      const q = Quaternion.FromEulerAngles(rot.x, rot.y, rot.z);
      proxyCam.rotationQuaternion = q;
      
      if (fov) proxyCam.fov = fov;

      if (this.motor3d.getRenderingPipeline() && !this.motor3d.getRenderingPipeline().cameras.includes(proxyCam)) {
         this.motor3d.getRenderingPipeline().addCamera(proxyCam);
      }

      const canvas = this.motor3d.getEngine().getRenderingCanvas();
      this.ownership.setCamera('TRANSITION_PROXY', proxyCam, canvas, false);
  }

  salirCamaraFija(): void {
      const canvas = this.motor3d.getEngine().getRenderingCanvas();
      this.ownership.setCamera('EDITOR', this.motor3d.getEditorCamera(), canvas, true);
  }

  private getLookQuat(pos: Vector3, target: Vector3, fallbackForward: Vector3): Quaternion {
      let dir = target.subtract(pos);
      if (dir.lengthSquared() < 0.001) dir = fallbackForward.clone();
      dir.normalize();
      
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
      
      return Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
  }

  private animateCameraProxy(
    startPos: Vector3,
    startTarget: Vector3,
    endPos: Vector3,
    endTarget: Vector3,
    frames: number,
    onComplete: () => void,
    addArc: boolean = false
  ): void {
    const scene = this.motor3d.getScene();

    const proxyCam = new UniversalCamera("proxyTransitionCam", startPos.clone(), scene);
    proxyCam.minZ = 0.05;
    proxyCam.maxZ = 50000;
    
    if (this.motor3d.getRenderingPipeline()) {
       this.motor3d.getRenderingPipeline().addCamera(proxyCam);
    }

    const startForward = startTarget.subtract(startPos).normalize();
    const endForward = endTarget.subtract(endPos).normalize();

    const startQuat = this.getLookQuat(startPos, startTarget, startForward);
    const endQuat = this.getLookQuat(endPos, endTarget, endForward);
    proxyCam.rotationQuaternion = startQuat.clone();

    this.ownership.setCamera('TRANSITION_PROXY', proxyCam, null, false);

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const fps = 60;
    const animPos = new Animation("proxyPos", "position", fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animPos.setEasingFunction(ease);

    if (addArc) {
      const midPos = Vector3.Lerp(startPos, endPos, 0.5);
      const dist = Vector3.Distance(startPos, endPos);
      midPos.y += Math.min(dist * 0.25, 4.0); 
      
      animPos.setKeys([
        { frame: 0, value: startPos },
        { frame: frames * 0.5, value: midPos },
        { frame: frames, value: endPos }
      ]);
    } else {
      animPos.setKeys([
        { frame: 0, value: startPos },
        { frame: frames, value: endPos }
      ]);
    }

    const animRot = new Animation("proxyRot", "rotationQuaternion", fps, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animRot.setEasingFunction(ease);
    animRot.setKeys([
      { frame: 0, value: startQuat },
      { frame: frames, value: endQuat }
    ]);

    scene.beginDirectAnimation(proxyCam, [animPos, animRot], 0, frames, false, 1.0, () => {
      if (this.motor3d.getRenderingPipeline()) {
         this.motor3d.getRenderingPipeline().removeCamera(proxyCam);
      }
      onComplete();
      proxyCam.dispose();
    });
  }

  transicionAEdicionEnVivo(objetoReceptor: Node): void {
    if (!objetoReceptor) return;

    const escena = this.motor3d.getScene();
    const editorCam = this.motor3d.getEditorCamera();
    const camaraOrigen = this.obtenerCamaraJuegoActiva();

    if (!escena || !editorCam || !camaraOrigen) {
      this.transitionSvc.finishTestLiveTransition();
      return;
    }

    this.transitionSvc.beginPauseToLiveEdit();

    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}

    const startPos = camaraOrigen.globalPosition.clone();
    const forward = camaraOrigen.getDirection(Vector3.Forward());

    let finalTarget = Vector3.Zero();
    let finalRadius = 7;

    if (objetoReceptor instanceof AbstractMesh) {
      const resultado = this.obtenerEncuadreObjeto(objetoReceptor);
      finalTarget = resultado.target;
      finalRadius = resultado.radius;
    } else {
      finalTarget = (objetoReceptor as AbstractMesh).getAbsolutePosition().clone();
    }

    const startTarget = startPos.add(forward.scale(10));

    const targetToStart = startPos.subtract(finalTarget);
    let dir = targetToStart.normalize();
    if (dir.lengthSquared() === 0) dir = Vector3.Backward();
    
    const endPos = finalTarget.add(dir.scale(finalRadius));

    this.animateCameraProxy(
      startPos, startTarget,
      endPos, finalTarget,
      45,
      () => {
        this.asegurarCamaraEditorActiva();
        editorCam.setPosition(endPos);
        editorCam.setTarget(finalTarget);
        editorCam.radius = finalRadius;

        this.transitionSvc.finishPauseToLiveEdit();
        this.state.seleccionarObjeto(objetoReceptor);

        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        if (canvas) {
          canvas.focus();
        }
        this.reafirmarCamaraEditorEnSiguienteFrame();
      },
      true
    );
  }

  pausarJuegoYActivarCamaraEditor(): void {
    const escena = this.motor3d.getScene();
    const editorCam = this.motor3d.getEditorCamera();
    const camaraOrigen = this.obtenerCamaraJuegoActiva();

    if (!escena || !editorCam || !camaraOrigen) return;

    this.transitionSvc.beginPauseToLiveEdit();

    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}

    const startPos = camaraOrigen.globalPosition.clone();
    const forward = camaraOrigen.getDirection(Vector3.Forward());
    
    const startTarget = startPos.add(forward.scale(10));

    const endPos = startPos.subtract(forward.scale(5));
    endPos.y += 2.0; 
    const endTarget = startTarget.clone();

    this.animateCameraProxy(
      startPos, startTarget,
      endPos, endTarget,
      30,
      () => {
        this.asegurarCamaraEditorActiva();
        editorCam.setPosition(endPos);
        editorCam.setTarget(endTarget);
        editorCam.radius = Vector3.Distance(endPos, endTarget);

        this.transitionSvc.finishPauseToLiveEdit();
        
        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        if (canvas) {
          canvas.focus();
        }
        this.reafirmarCamaraEditorEnSiguienteFrame();
      }
    );
  }

  volarHaciaCamaraJuego(
    centroEpiral: Vector3,
    targetPos: Vector3,
    targetLookAt: Vector3,
    playerForward: Vector3,
    isFPS: boolean,
    onComplete: () => void
  ): void {
    const scene = this.motor3d.getScene();
    const editorCam = this.motor3d.getEditorCamera();

    const startPos = this.editorCamState?.position || editorCam.globalPosition.clone();
    const startTarget = startPos.add(editorCam.getDirection(Vector3.Forward()).scale(10));
    
    const dist = Vector3.Distance(startPos, targetPos);
    const frames = Math.max(90, Math.min(Math.floor(dist * 3.0), 180));

    const proxyCam = new UniversalCamera("proxyTransitionCam", startPos.clone(), scene);
    proxyCam.minZ = 0.05;
    proxyCam.maxZ = 50000;
    
    if (this.motor3d.getRenderingPipeline()) {
       this.motor3d.getRenderingPipeline().addCamera(proxyCam);
    }
    
    const startDir = startTarget.subtract(startPos).normalize();
    const endDir = targetLookAt.subtract(targetPos).normalize();
    
    const p1 = startPos.add(startDir.scale(dist * 0.3));
    const p2 = targetPos.subtract(endDir.scale(dist * 0.3)); 
    p2.y += Math.min(dist * 0.1, 2.0); 

    const bezier = Curve3.CreateCubicBezier(startPos, p1, p2, targetPos, frames);
    const posPoints = bezier.getPoints();

    const posKeys = [];
    const rotKeys = [];

    const endQuat = this.getLookQuat(targetPos, targetLookAt, playerForward);
    const startQuat = this.getLookQuat(startPos, startTarget, playerForward);
    
    proxyCam.rotationQuaternion = startQuat.clone();

    for (let i = 0; i <= frames; i++) {
        const t = i / frames;
        const currentPos = posPoints[i];
        posKeys.push({ frame: i, value: currentPos });

        const finalQuat = Quaternion.Slerp(startQuat, endQuat, t);
        rotKeys.push({ frame: i, value: finalQuat });
    }

    this.ownership.setCamera('TRANSITION_PROXY', proxyCam, null, false);

    const animPos = new Animation("proxyPos", "position", 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animRot = new Animation("proxyRot", "rotationQuaternion", 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT); 
    
    animPos.setEasingFunction(ease);
    animRot.setEasingFunction(ease);

    animPos.setKeys(posKeys);
    animRot.setKeys(rotKeys);

    scene.beginDirectAnimation(proxyCam, [animPos, animRot], 0, frames, false, 1.0, () => {
      if (this.motor3d.getRenderingPipeline()) {
         this.motor3d.getRenderingPipeline().removeCamera(proxyCam);
      }
      onComplete();
      proxyCam.dispose();
    });
  }

  volverAJuego(): void {
    this.transitionSvc.beginResumeToTestLive();

    const escena = this.motor3d.getScene();
    const destCam = this.state.modoVistaPrueba === 'FPS'
      ? this.motor3d.getPlayerCameraFPS()
      : this.motor3d.getPlayerCameraTPS();
    const editorCam = this.motor3d.getEditorCamera();

    if (!destCam || !editorCam) {
      this.transitionSvc.stopTestLive();
      return;
    }

    const player = this.gameContext.activePlayerEntity();
    if (player && player.playerRuntime) {
      const state = player.playerRuntime.physicsState;
      state.velocidadY = -0.05;
      state.isJumping = false;
      state.isFalling = false;
      state.isHardLanding = false;
      state.isRecoveringFromFall = false;
    }

    const startPos = editorCam.globalPosition.clone();
    const startTarget = startPos.add(editorCam.getDirection(Vector3.Forward()).scale(10));

    const endPos = destCam.globalPosition.clone();
    const endTarget = destCam instanceof ArcRotateCamera 
      ? destCam.getTarget().clone() 
      : endPos.add(destCam.getDirection(Vector3.Forward()).scale(10));

    this.animateCameraProxy(
      startPos, startTarget,
      endPos, endTarget,
      45, 
      () => {
        this.transitionSvc.finishResumeToTestLive();
        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        this.ownership.setCamera(this.state.modoVistaPrueba === 'FPS' ? 'PLAYER_FPS' : 'PLAYER_TPS', destCam, canvas, true);

        if (canvas && this.state.modoVistaPrueba === 'FPS') {
          try { canvas.requestPointerLock(); } catch {}
        }
      },
      true 
    );
  }
}