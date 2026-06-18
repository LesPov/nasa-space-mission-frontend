// src/app/services/editor/editor-camera.service.ts

import { Injectable, inject } from '@angular/core';
import {
  Vector3,
  Node,
  AbstractMesh,
  Animation,
  CubicEase,
  EasingFunction
} from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { PlayerCameraManagerService } from '../../core/engine/runtime/systems/player-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class EditorCameraService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private entityManager = inject(EntityManagerService);

  private ultimaPosCamaraLibre: Vector3 | null = null;
  private ultimoTargetCamaraLibre: Vector3 | null = null;

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

      const diagonal = Math.sqrt((sizeX*sizeX) + (sizeY*sizeY) + (sizeZ*sizeZ));
      let radius = Math.max(4.0, diagonal * 2.2); 
      radius = Math.min(radius, 150); 
      return { target, radius };
    }

    const boundingVectors = objeto.getHierarchyBoundingVectors(true);
    const min = boundingVectors.min;
    const max = boundingVectors.max;
    const target = min.add(max).scale(0.5);
    const size = max.subtract(min);

    const diagonal = size.length();
    let radius = Math.max(4.0, diagonal * 2.0);
    radius = Math.min(radius, 150); 

    return { target, radius };
  }

  guardarEstadoCamaraLibre(): void {
    const cam = this.motor3d.scene?.activeCamera;
    if (!cam) return;

    this.ultimaPosCamaraLibre = cam.globalPosition.clone();

    if (this.state.modoVistaPrueba === 'TPS' && this.playerCamSvc.cameraPivot) {
      this.ultimoTargetCamaraLibre = this.playerCamSvc.cameraPivot.getAbsolutePosition().clone();
    } else {
      this.ultimoTargetCamaraLibre = cam.globalPosition.add(cam.getDirection(Vector3.Forward()));
    }
  }

  restaurarCamaraLibre(): void {
    const editorCam = this.motor3d.editorCamera;
    if (!editorCam) return;

    if (this.ultimaPosCamaraLibre && this.ultimoTargetCamaraLibre) {
      editorCam.position = this.ultimaPosCamaraLibre.clone();
      editorCam.setTarget(this.ultimoTargetCamaraLibre.clone());
    }
  }

  enfocarObjetoEnEditor(objeto: Node): void {
    if (!objeto || !(objeto instanceof AbstractMesh)) return;
    if (this.state.playState() !== 'EDITOR') return;

    const cam = this.motor3d.editorCamera;
    if (!cam) return;

    const { target, radius } = this.obtenerEncuadreObjeto(objeto);

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const currentTarget = cam.getTarget().clone();

    Animation.CreateAndStartAnimation('camEditorTargetAnim', cam, 'target', 60, 25, currentTarget, target, 2, ease);
    Animation.CreateAndStartAnimation('camEditorRadiusAnim', cam, 'radius', 60, 25, cam.radius, radius, 2, ease);
  }

  transicionAEdicionEnVivo(objetoReceptor: Node): void {
    this.state.playState.set('TRANSITIONING');
    document.exitPointerLock();

    let targetPos = Vector3.Zero();
    let objectRadius = 7;

    if (objetoReceptor instanceof AbstractMesh) {
      const resultado = this.obtenerEncuadreObjeto(objetoReceptor);
      targetPos = resultado.target;
      objectRadius = resultado.radius;
    } else {
      targetPos = (objetoReceptor as AbstractMesh).getAbsolutePosition().clone();
    }

    const activeCam = this.motor3d.scene.activeCamera;
    const startPos = activeCam!.globalPosition.clone();

    this.motor3d.editorCamera.detachControl();
    this.motor3d.editorCamera.position = startPos;
    this.motor3d.editorCamera.setTarget(targetPos);
    this.motor3d.scene.activeCamera = this.motor3d.editorCamera;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    Animation.CreateAndStartAnimation('camRadius', this.motor3d.editorCamera, 'radius', 60, 90, this.motor3d.editorCamera.radius, objectRadius, 2, ease);
    const anim = Animation.CreateAndStartAnimation('camBeta', this.motor3d.editorCamera, 'beta', 60, 90, this.motor3d.editorCamera.beta, Math.PI / 3, 2, ease);

    anim?.onAnimationEndObservable.addOnce(() => {
      this.state.playState.set('EDITING_IN_GAME');
      this.state.objetoSeleccionado.set(objetoReceptor);
      this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    });
  }

  volarHaciaCamaraJuego(centroEpiral: Vector3, targetPos: Vector3, targetLookAt: Vector3, isFPS: boolean, onComplete: () => void): void {
    const editorCam = this.motor3d.editorCamera;
    editorCam.detachControl();

    const startPos = editorCam.position.clone();
    const startTarget = editorCam.getTarget().clone();

    const frames = 150; 

    const posAnim = new Animation('camPosIn', 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const targetAnim = new Animation('camTargetIn', 'target', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    const keysPos = [];
    const keysTarget = [];

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

      let currentTarget;
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

    const startCam = this.motor3d.scene.activeCamera;
    if (!startCam) return;

    const startPos = startCam.globalPosition.clone();
    let startTarget: Vector3;

    if (this.state.modoVistaPrueba === 'FPS') {
      startTarget = startPos.add(startCam.getDirection(Vector3.Forward()));
    } else {
      startTarget = this.playerCamSvc.cameraPivot ? this.playerCamSvc.cameraPivot.getAbsolutePosition().clone() : startPos.add(Vector3.Forward());
    }

    const editorCam = this.motor3d.editorCamera;
    this.motor3d.scene.activeCamera = editorCam;
    editorCam.position = startPos;
    editorCam.setTarget(startTarget);
    editorCam.detachControl();

    const endPos = this.ultimaPosCamaraLibre || new Vector3(0, 15, -15);
    const endTarget = this.ultimoTargetCamaraLibre || new Vector3(0, 0, 0);
    const centroObj = this.state.jugadorActivo ? this.state.jugadorActivo.getAbsolutePosition().clone() : endTarget.clone();

    const frames = 120; 

    const posAnim = new Animation('camPosOut', 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const targetAnim = new Animation('camTargetOut', 'target', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    const keysPos = [];
    const keysTarget = [];

    const startOffset = startPos.subtract(centroObj);
    const startRadius = startOffset.length();
    const startYaw = Math.atan2(startOffset.x, startOffset.z);
    const startPitch = startPos.y;

    const endOffset = endPos.subtract(centroObj);
    const endRadius = endOffset.length();
    const endYaw = Math.atan2(endOffset.x, endOffset.z);
    const endPitch = endPos.y;

    let yawDiff = endYaw - startYaw;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;

    const targetYaw = startYaw + yawDiff + (Math.PI * 1.0); 

    for (let i = 0; i <= frames; i++) {
      const t = i / frames;
      const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const currentRadius = startRadius + (endRadius - startRadius) * easeT;
      const currentYaw = startYaw + (targetYaw - startYaw) * easeT;
      const currentY = startPitch + (endPitch - startPitch) * easeT;

      const posX = centroObj.x + currentRadius * Math.sin(currentYaw);
      const posZ = centroObj.z + currentRadius * Math.cos(currentYaw);

      keysPos.push({ frame: i, value: new Vector3(posX, currentY, posZ) });

      let currentTarget;
      if (easeT < 0.4) {
         const tT = easeT / 0.4;
         currentTarget = Vector3.Lerp(startTarget, centroObj, tT);
      } else {
         const tT = (easeT - 0.4) / 0.6;
         currentTarget = Vector3.Lerp(centroObj, endTarget, tT);
      }
      keysTarget.push({ frame: i, value: currentTarget });
    }

    posAnim.setKeys(keysPos);
    targetAnim.setKeys(keysTarget);

    this.motor3d.scene.beginDirectAnimation(editorCam, [posAnim, targetAnim], 0, frames, false, 1, () => {
      this.state.playState.set('EDITOR');
      const canvas = this.motor3d.engine.getRenderingCanvas();
      if (canvas) editorCam.attachControl(canvas, true);
    });
  }
}