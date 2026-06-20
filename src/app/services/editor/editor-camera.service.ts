
import { Injectable, inject } from '@angular/core';
import {
  AbstractMesh,
  Animation,
  ArcRotateCamera,
  Camera,
  CubicEase,
  EasingFunction,
  Node,
  Vector3
} from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class EditorCameraService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);

  // 🔥 FIX: Guardamos el estado real y exacto de la cámara orbital (Radio, Ángulos, Target)
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

  // 🔥 FIX: Captura perfecta del estado para que no quede lenta al regresar
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

  // 🔥 FIX: Restaura los ángulos y el radio para conservar la fluidez
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

  transicionAEdicionEnVivo(objetoReceptor: Node): void {
    if (!objetoReceptor) return;

    const escena = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const camaraOrigen = this.obtenerCamaraJuegoActiva();

    if (!escena || !editorCam || !camaraOrigen) {
      this.state.playState.set('PLAYING');
      return;
    }

    this.state.playState.set('TRANSITIONING');
    this.state.objetoHovereado.set(null);

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

    let distToObject = Vector3.Distance(startPos, finalTarget);
    if (distToObject < 1) distToObject = 1;

    const startTarget = startPos.add(forward.scale(distToObject));

    this.asegurarCamaraEditorActiva();

    editorCam.position = startPos.clone();
    editorCam.setTarget(startTarget.clone());

    const startRadius = editorCam.radius;

    const frames = 45;
    const animRadius = new Animation('camRadLive', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animTarget = new Animation('camTargLive', 'target', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
    animRadius.setEasingFunction(ease);
    animTarget.setEasingFunction(ease);

    animRadius.setKeys([
      { frame: 0, value: startRadius },
      { frame: frames, value: finalRadius }
    ]);

    animTarget.setKeys([
      { frame: 0, value: startTarget },
      { frame: frames, value: finalTarget }
    ]);

    escena.beginDirectAnimation(editorCam, [animRadius, animTarget], 0, frames, false, 1.0, () => {
      this.state.playState.set('EDITING_IN_GAME');
      this.state.objetoSeleccionado.set(objetoReceptor);

      const canvas = this.motor3d.engine.getRenderingCanvas();
      if (canvas) {
        canvas.focus();
        try { editorCam.detachControl(); } catch {}
        try { editorCam.attachControl(canvas, true); } catch {}
      }
      this.reafirmarCamaraEditorEnSiguienteFrame();
    });
  }

  pausarJuegoYActivarCamaraEditor(): void {
    const escena = this.motor3d.scene;
    const editorCam = this.motor3d.editorCamera;
    const camaraOrigen = this.obtenerCamaraJuegoActiva();

    if (!escena || !editorCam || !camaraOrigen) return;

    this.state.playState.set('TRANSITIONING');
    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);

    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    
    try { camaraOrigen.detachControl(); } catch {}
    try { editorCam.detachControl(); } catch {}

    const startPos = camaraOrigen.globalPosition.clone();
    const forward = camaraOrigen.getDirection(Vector3.Forward());

    this.asegurarCamaraEditorActiva();

    editorCam.position = startPos.clone();
    editorCam.setTarget(startPos.add(forward.scale(5)));
    editorCam.radius = 5;

    const frames = 20;
    const animRadius = new Animation('camRadPause', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
    animRadius.setEasingFunction(ease);
    animRadius.setKeys([
      { frame: 0, value: 0.1 },
      { frame: frames, value: 5 }
    ]);

    escena.beginDirectAnimation(editorCam, [animRadius], 0, frames, false, 1.0, () => {
      this.state.playState.set('EDITING_IN_GAME');
      const canvas = this.motor3d.engine.getRenderingCanvas();
      if (canvas) {
        canvas.focus();
        try { editorCam.detachControl(); } catch {}
        try { editorCam.attachControl(canvas, true); } catch {}
      }
      this.reafirmarCamaraEditorEnSiguienteFrame();
    });
  }

  volarHaciaCamaraJuego(
    centroEpiral: Vector3,
    targetPos: Vector3,
    targetLookAt: Vector3,
    isFPS: boolean,
    onComplete: () => void
  ): void {
    const editorCam = this.motor3d.editorCamera;
    editorCam.detachControl();

    const startPos = editorCam.position.clone();
    const startTarget = editorCam.getTarget().clone();

    const frames = 150;

    const posAnim = new Animation(
      'camPosIn',
      'position',
      60,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    const targetAnim = new Animation(
      'camTargetIn',
      'target',
      60,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    const keysPos: { frame: number; value: Vector3 }[] = [];
    const keysTarget: { frame: number; value: Vector3 }[] = [];

    const startOffset = startPos.subtract(centroEpiral);
    const startRadius = startOffset.length();
    const startYaw = Math.atan2(startOffset.x, startOffset.z);
    const startPitch = startPos.y;

    const endOffset = targetPos.subtract(centroEpiral);
    const endRadius = endOffset.length();
    const endYaw = Math.atan2(endOffset.x, endOffset.z);
    const endPitch = targetPos.y;

    let yawDiff = endYaw - startYaw;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;

    const targetYaw = startYaw + yawDiff + (Math.PI * 1.5);

    for (let i = 0; i <= frames; i++) {
      const t = i / frames;
      const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const currentRadius = startRadius + (endRadius - startRadius) * easeT;
      const currentYaw = startYaw + (targetYaw - startYaw) * easeT;
      const currentY = startPitch + (endPitch - startPitch) * easeT;

      const posX = centroEpiral.x + currentRadius * Math.sin(currentYaw);
      const posZ = centroEpiral.z + currentRadius * Math.cos(currentYaw);

      keysPos.push({ frame: i, value: new Vector3(posX, currentY, posZ) });

      let currentTarget: Vector3;
      if (easeT < 0.6) {
        const tT = easeT / 0.6;
        currentTarget = Vector3.Lerp(startTarget, centroEpiral, tT);
      } else {
        const tT = (easeT - 0.6) / 0.4;
        currentTarget = Vector3.Lerp(centroEpiral, targetLookAt, tT);
      }

      keysTarget.push({ frame: i, value: currentTarget });
    }

    posAnim.setKeys(keysPos);
    targetAnim.setKeys(keysTarget);

    this.motor3d.scene.beginDirectAnimation(editorCam, [posAnim, targetAnim], 0, frames, false, 1, () => {
      onComplete();
    });
  }

  volverAJuego(): void {
    this.state.playState.set('TRANSITIONING');
    this.state.objetoSeleccionado.set(null);

    const escena = this.motor3d.scene;
    const activeCam = escena.activeCamera as ArcRotateCamera | null;
    if (!escena || !activeCam) {
      this.state.playState.set('EDITOR');
      return;
    }

    const destCam = this.state.modoVistaPrueba === 'FPS'
      ? this.motor3d.playerCameraFPS
      : this.motor3d.playerCameraTPS;

    if (!destCam) {
      this.state.playState.set('EDITOR');
      return;
    }

    const endPos = destCam.globalPosition.clone();
    const endTarget = endPos.add(destCam.getDirection(Vector3.Forward()).scale(10));

    try { activeCam.detachControl(); } catch {}

    const startAlpha = activeCam.alpha;
    const startBeta = activeCam.beta;
    const startRadius = activeCam.radius;
    const startTarget = activeCam.getTarget().clone();

    activeCam.position = endPos.clone();
    activeCam.setTarget(endTarget.clone());

    let endAlpha = activeCam.alpha;
    const endBeta = activeCam.beta;
    const endRadius = activeCam.radius;

    let alphaDiff = endAlpha - startAlpha;
    while (alphaDiff > Math.PI) alphaDiff -= Math.PI * 2;
    while (alphaDiff < -Math.PI) alphaDiff += Math.PI * 2;
    endAlpha = startAlpha + alphaDiff;

    activeCam.alpha = startAlpha;
    activeCam.beta = startBeta;
    activeCam.radius = startRadius;
    activeCam.setTarget(startTarget.clone());

    const frames = 30;
    const animAlpha = new Animation('camAlphaOut', 'alpha', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animBeta = new Animation('camBetaOut', 'beta', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animRad = new Animation('camRadOut', 'radius', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const animTarg = new Animation('camTargOut', 'target', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
    animAlpha.setEasingFunction(ease);
    animBeta.setEasingFunction(ease);
    animRad.setEasingFunction(ease);
    animTarg.setEasingFunction(ease);

    animAlpha.setKeys([{ frame: 0, value: startAlpha }, { frame: frames, value: endAlpha }]);
    animBeta.setKeys([{ frame: 0, value: startBeta }, { frame: frames, value: endBeta }]);
    animRad.setKeys([{ frame: 0, value: startRadius }, { frame: frames, value: endRadius }]);
    animTarg.setKeys([{ frame: 0, value: startTarget }, { frame: frames, value: endTarget }]);

    escena.beginDirectAnimation(activeCam, [animAlpha, animBeta, animRad, animTarg], 0, frames, false, 1.0, () => {
      this.state.playState.set('PLAYING');
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
    });
  }
}