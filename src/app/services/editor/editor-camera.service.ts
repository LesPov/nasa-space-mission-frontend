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

@Injectable({ providedIn: 'root' })
export class EditorCameraService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private ultimaPosCamaraLibre: Vector3 | null = null;
  private ultimoTargetCamaraLibre: Vector3 | null = null;

  private obtenerEncuadreObjeto(objeto: AbstractMesh): { target: Vector3; radius: number } {
    objeto.computeWorldMatrix(true);
    const metadata: any = objeto.metadata || {};
    const collider = metadata.collider;

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

    if (this.state.modoVistaPrueba === 'TPS' && this.state.cameraPivot) {
      this.ultimoTargetCamaraLibre = this.state.cameraPivot.getAbsolutePosition().clone();
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

    // 🔥 TRANSICIÓN MÁS LENTA Y SUAVE (Aumentada de 40 a 90 frames = 1.5s)
    Animation.CreateAndStartAnimation('camRadius', this.motor3d.editorCamera, 'radius', 60, 90, this.motor3d.editorCamera.radius, objectRadius, 2, ease);
    const anim = Animation.CreateAndStartAnimation('camBeta', this.motor3d.editorCamera, 'beta', 60, 90, this.motor3d.editorCamera.beta, Math.PI / 3, 2, ease);

    anim?.onAnimationEndObservable.addOnce(() => {
      this.state.playState.set('EDITING_IN_GAME');
      this.state.objetoSeleccionado.set(objetoReceptor);
      this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    });
  }

  volarHaciaCamaraJuego(targetPos: Vector3, targetLookAt: Vector3, isFPS: boolean, onComplete: () => void): void {
    const editorCam = this.motor3d.editorCamera;
    editorCam.detachControl();

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const startPos = editorCam.position.clone();
    const currentTarget = editorCam.getTarget().clone();

    // 🔥 CÁMARA MÁS LENTA: 150 frames = 2.5 segundos
    const frames = 150; 
    const posAnim = new Animation('camPosIn', 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    const keysPos = [];
    let P1 = startPos.add(targetPos).scale(0.5);
    
    if (isFPS) {
      const playerForward = targetLookAt.subtract(targetPos).normalize();
      let playerRight = Vector3.Cross(Vector3.Up(), playerForward).normalize();
      if (playerRight.lengthSquared() === 0) playerRight = new Vector3(1, 0, 0); 
      
      P1 = targetPos.subtract(playerForward.scale(2.5)).add(playerRight.scale(1.5));
    }

    for (let i = 0; i <= frames; i++) {
      const t = i / frames;
      const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const invT = 1 - easeT;
      const pos = startPos.scale(invT * invT)
                  .add(P1.scale(2 * invT * easeT))
                  .add(targetPos.scale(easeT * easeT));
      keysPos.push({ frame: i, value: pos });
    }
    
    posAnim.setKeys(keysPos);
    this.motor3d.scene.beginDirectAnimation(editorCam, [posAnim], 0, frames, false, 1);
    
    const animTarget = Animation.CreateAndStartAnimation('camTargetIn', editorCam, 'target', 60, frames, currentTarget, targetLookAt, 2, ease);

    animTarget?.onAnimationEndObservable.addOnce(() => {
      onComplete();
    });
  }

  volverAJuego(): void {
    this.state.playState.set('TRANSITIONING');
    this.state.objetoSeleccionado.set(null);
    this.motor3d.editorCamera.detachControl();

    const targetCam = this.state.modoVistaPrueba === 'FPS'
      ? this.motor3d.playerCameraFPS
      : this.motor3d.playerCameraTPS;

    targetCam.getViewMatrix(true);
    const targetPos = targetCam.globalPosition.clone();

    let targetLookAt: Vector3;
    if (this.state.modoVistaPrueba === 'FPS') {
      targetLookAt = targetCam.globalPosition.add(targetCam.getDirection(Vector3.Forward()));
    } else {
      targetLookAt = this.state.cameraPivot!.getAbsolutePosition();
    }

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const startPos = this.motor3d.editorCamera.position.clone();
    
    // 🔥 CÁMARA MÁS LENTA: 150 frames = 2.5 segundos
    const frames = 150; 
    const posAnim = new Animation('camPosOut', 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    
    const keysPos = [];
    let P1 = startPos.add(targetPos).scale(0.5);
    
    if (this.state.modoVistaPrueba === 'FPS') {
      const playerForward = targetLookAt.subtract(targetPos).normalize();
      let playerRight = Vector3.Cross(Vector3.Up(), playerForward).normalize();
      if (playerRight.lengthSquared() === 0) playerRight = new Vector3(1, 0, 0);
      
      P1 = targetPos.subtract(playerForward.scale(2.5)).add(playerRight.scale(1.5));
    }

    for (let i = 0; i <= frames; i++) {
      const t = i / frames;
      const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const invT = 1 - easeT;
      const pos = startPos.scale(invT * invT)
                  .add(P1.scale(2 * invT * easeT))
                  .add(targetPos.scale(easeT * easeT));
      keysPos.push({ frame: i, value: pos });
    }
    
    posAnim.setKeys(keysPos);
    this.motor3d.scene.beginDirectAnimation(this.motor3d.editorCamera, [posAnim], 0, frames, false, 1);

    const animTarget = Animation.CreateAndStartAnimation('camTargetOut', this.motor3d.editorCamera, 'target', 60, frames, this.motor3d.editorCamera.getTarget().clone(), targetLookAt, 2, ease);

    animTarget?.onAnimationEndObservable.addOnce(() => {
      this.motor3d.scene.activeCamera = targetCam;
      this.state.playState.set('PLAYING');
    });
  }
}