
import { Injectable, inject } from '@angular/core';
import {
  AbstractMesh,
  Animation,
  ArcRotateCamera,
  Camera,
  CubicEase,
  EasingFunction,
  Node,
  Vector3,
  UniversalCamera,
  Curve3,
  Quaternion
} from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
 
@Injectable({ providedIn: 'root' })
export class EditorCameraService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private transitionSvc = inject(EditorModeTransitionService);

  private editorCamState: { target: Vector3; radius: number; alpha: number; beta: number } | null = null;

  private obtenerCamaraJuegoActiva(): Camera | null {
    const scene = this.motor3d.scene;
    const active = scene?.activeCamera ?? null;

    if (active && active !== this.motor3d.editorCamera) {
      return active;
    }

    if (this.state.modoVistaPrueba === 'FPS' && this.motor3d.playerCameraFPS) {
      return this.motor3d.playerCameraFPS;
    }

    if (this.state.modoVistaPrueba === 'TPS' && this.motor3d.playerCameraTPS) {
      return this.motor3d.playerCameraTPS;
    }

    return this.motor3d.playerCameraFPS ?? this.motor3d.playerCameraTPS ?? null;
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
    const scene = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const canvas = this.motor3d.engine?.getRenderingCanvas();

    if (!scene || !editorCam) return;

    scene.activeCamera = editorCam;

    if (canvas) {
      try { editorCam.detachControl(); } catch {}
      try { editorCam.attachControl(canvas, true); } catch {}
    }
  }

  private reafirmarCamaraEditorEnSiguienteFrame(): void {
    const scene = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const canvas = this.motor3d.engine?.getRenderingCanvas();

    if (!scene || !editorCam) return;

    requestAnimationFrame(() => {
      if (scene.activeCamera !== editorCam) {
        scene.activeCamera = editorCam;
      }
      if (canvas) {
        try { editorCam.detachControl(); } catch {}
        try { editorCam.attachControl(canvas, true); } catch {}
      }
    });
  }

  guardarEstadoCamaraLibre(): void {
    const editorCam = this.motor3d.editorCamera;
    if (!editorCam) return;

    this.editorCamState = {
      target: editorCam.getTarget().clone(),
      radius: editorCam.radius,
      alpha: editorCam.alpha,
      beta: editorCam.beta
    };
  }

  restaurarCamaraLibre(): void {
    const editorCam = this.motor3d.editorCamera;
    if (!editorCam || !this.editorCamState) return;

    editorCam.setTarget(this.editorCamState.target.clone());
    editorCam.radius = this.editorCamState.radius;
    editorCam.alpha = this.editorCamState.alpha;
    editorCam.beta = this.editorCamState.beta;
  }

  enfocarObjetoEnEditor(objeto: Node): void {
    if (!objeto || !(objeto instanceof AbstractMesh)) return;
    
    const state = this.state.playState();
    if (state !== 'EDITOR' && state !== 'EDITING_IN_GAME') return;

    const cam = this.motor3d.editorCamera;
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

    this.motor3d.scene.beginDirectAnimation(cam, [animTarget, animRadius], 0, frames, false, 1.0);
  }

  // =========================================================================
  // NÚCLEO DE TRANSICIONES PERFECTAS (PROXY UNIVERSAL)
  // =========================================================================

  /**
   * Genera un Cuaternión matemático puro basado en dirección Yaw y Pitch.
   * Evita saltos y el problema del Gimbal Lock que tiene `.setTarget()`
   */
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
    const scene = this.motor3d.scene;

    const proxyCam = new UniversalCamera("proxyTransitionCam", startPos.clone(), scene);
    proxyCam.minZ = 0.05;
    proxyCam.maxZ = 50000;
    
    if (this.motor3d.renderingPipeline) {
       this.motor3d.renderingPipeline.addCamera(proxyCam);
    }

    const startForward = startTarget.subtract(startPos).normalize();
    const endForward = endTarget.subtract(endPos).normalize();

    const startQuat = this.getLookQuat(startPos, startTarget, startForward);
    const endQuat = this.getLookQuat(endPos, endTarget, endForward);
    proxyCam.rotationQuaternion = startQuat.clone();

    scene.activeCamera = proxyCam;

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
      if (this.motor3d.renderingPipeline) {
         this.motor3d.renderingPipeline.removeCamera(proxyCam);
      }
      onComplete();
      proxyCam.dispose();
    });
  }

  transicionAEdicionEnVivo(objetoReceptor: Node): void {
    if (!objetoReceptor) return;

    const escena = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const camaraOrigen = this.obtenerCamaraJuegoActiva();

    if (!escena || !editorCam || !camaraOrigen) {
      this.transitionSvc.finishTestLiveTransition();
      return;
    }

    this.transitionSvc.beginPauseToLiveEdit();

    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    try { camaraOrigen.detachControl(); } catch {}
    try { editorCam.detachControl(); } catch {}

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
        this.state.objetoSeleccionado.set(objetoReceptor);

        const canvas = this.motor3d.engine.getRenderingCanvas();
        if (canvas) {
          canvas.focus();
          try { editorCam.detachControl(); } catch {}
          try { editorCam.attachControl(canvas, true); } catch {}
        }
        this.reafirmarCamaraEditorEnSiguienteFrame();
      },
      true
    );
  }

  pausarJuegoYActivarCamaraEditor(): void {
    const escena = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const camaraOrigen = this.obtenerCamaraJuegoActiva();

    if (!escena || !editorCam || !camaraOrigen) return;

    this.transitionSvc.beginPauseToLiveEdit();

    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    try { camaraOrigen.detachControl(); } catch {}
    try { editorCam.detachControl(); } catch {}

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
        
        const canvas = this.motor3d.engine.getRenderingCanvas();
        if (canvas) {
          canvas.focus();
          try { editorCam.detachControl(); } catch {}
          try { editorCam.attachControl(canvas, true); } catch {}
        }
        this.reafirmarCamaraEditorEnSiguienteFrame();
      }
    );
  }

  /**
   * 🔥 Vuelo Orbital Cinemático
   * Viaja de forma directa y orbita al jugador entrando siempre por detrás.
   * Totalmente protegido contra Gimbal Lock.
   */
  volarHaciaCamaraJuego(
    centroEpiral: Vector3,
    targetPos: Vector3,
    targetLookAt: Vector3,
    playerForward: Vector3,
    isFPS: boolean,
    onComplete: () => void
  ): void {
    const scene = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    editorCam.detachControl();

    const startPos = editorCam.globalPosition.clone();
    const dist = Vector3.Distance(startPos, targetPos);
    
    // 🔥 FIX: Aceleración mucho más lenta. Mínimo 2s, máximo 4s
    const frames = Math.max(120, Math.min(Math.floor(dist * 3.5), 240));

    const startTarget = startPos.add(editorCam.getDirection(Vector3.Forward()).scale(10));
    
    // Dirección recta para llegar físicamente al objeto sin rodeos extraños
    let dirToTarget = centroEpiral.subtract(startPos).normalize();
    if (dirToTarget.lengthSquared() < 0.001) dirToTarget = editorCam.getDirection(Vector3.Forward());

    let endForward = targetLookAt.subtract(targetPos).normalize();
    if (endForward.lengthSquared() < 0.1) endForward = playerForward.clone();

    const proxyCam = new UniversalCamera("proxyTransitionCam", startPos.clone(), scene);
    proxyCam.minZ = 0.05;
    proxyCam.maxZ = 50000;
    
    if (this.motor3d.renderingPipeline) {
       this.motor3d.renderingPipeline.addCamera(proxyCam);
    }
    
    // 🔥 FIX: Curva Cúbica Bezier perfecta. Empuja hacia el jugador y lo bordea por la espalda
    const p1 = startPos.add(dirToTarget.scale(dist * 0.4));
    p1.y += Math.min(dist * 0.2, 3.0);

    const p2 = targetPos.subtract(playerForward.scale(Math.min(dist * 0.5, 10.0)));
    p2.y += Math.min(dist * 0.1, 2.0);

    const bezier = Curve3.CreateCubicBezier(startPos, p1, p2, targetPos, frames);
    const posPoints = bezier.getPoints();

    const posKeys = [];
    const rotKeys = [];

    // Capturamos el final perfecto
    const endQuat = this.getLookQuat(targetPos, targetLookAt, playerForward);
    // Capturamos el inicio perfecto
    const startQuat = this.getLookQuat(startPos, startTarget, playerForward);
    
    proxyCam.rotationQuaternion = startQuat.clone();

    for (let i = 0; i <= frames; i++) {
        const t = i / frames;
        const currentPos = posPoints[i];
        posKeys.push({ frame: i, value: currentPos });

        let lookTarget: Vector3;
        if (t < 0.6) {
            // Hasta el 60% del viaje, miramos fijamente a la cabeza del jugador (órbita limpia)
            lookTarget = Vector3.Lerp(startTarget, centroEpiral, t / 0.6);
        } else {
            // El último 40%, la mirada se sincroniza suavemente con el horizonte del player
            const tBlend = (t - 0.6) / 0.4;
            lookTarget = Vector3.Lerp(centroEpiral, targetLookAt, tBlend);
        }

        const lookQuat = this.getLookQuat(currentPos, lookTarget, playerForward);

        // Slerp final para afinar y no tener micropasos en el acople exacto
        const finalQuat = Quaternion.Slerp(lookQuat, endQuat, Math.pow(t, 3));
        rotKeys.push({ frame: i, value: finalQuat });
    }

    scene.activeCamera = proxyCam;

    const animPos = new Animation("proxyPos", "position", 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animRot = new Animation("proxyRot", "rotationQuaternion", 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT); // Lento al inicio y al final
    
    animPos.setEasingFunction(ease);
    animRot.setEasingFunction(ease);

    animPos.setKeys(posKeys);
    animRot.setKeys(rotKeys);

    scene.beginDirectAnimation(proxyCam, [animPos, animRot], 0, frames, false, 1.0, () => {
      if (this.motor3d.renderingPipeline) {
         this.motor3d.renderingPipeline.removeCamera(proxyCam);
      }
      onComplete();
      proxyCam.dispose();
    });
  }

  volverAJuego(): void {
    this.transitionSvc.beginResumeToTestLive();

    const escena = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const destCam = this.state.modoVistaPrueba === 'FPS'
      ? this.motor3d.playerCameraFPS
      : this.motor3d.playerCameraTPS;

    if (!destCam || !editorCam) {
      this.transitionSvc.stopTestLive();
      return;
    }

    try { editorCam.detachControl(); } catch {}

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
        escena.activeCamera = destCam;

        const canvas = this.motor3d.engine.getRenderingCanvas();
        if (canvas) {
          canvas.focus();
          try { destCam.detachControl(); } catch {}
          try { destCam.attachControl(canvas, true); } catch {}

          if (this.state.modoVistaPrueba === 'FPS') {
            try { canvas.requestPointerLock(); } catch {}
          }
        }
      },
      true 
    );
  }
}