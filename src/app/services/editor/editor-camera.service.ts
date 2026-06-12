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

      const maxSize = Math.max(sizeX, sizeY, sizeZ);
      const radius = Math.max(7, maxSize * 3.2);

      return { target, radius };
    }

    const boundingVectors = objeto.getHierarchyBoundingVectors(true);
    const min = boundingVectors.min;
    const max = boundingVectors.max;

    const target = min.add(max).scale(0.5);
    const size = max.subtract(min);

    const maxDim = Math.max(size.x, size.y, size.z);
    const diagonal = size.length();

    const radius = Math.max(7, maxDim * 3.0, diagonal * 1.4);

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

    Animation.CreateAndStartAnimation(
      'camEditorTargetAnim',
      cam,
      'target',
      60,
      25,
      currentTarget,
      target,
      2,
      ease
    );

    Animation.CreateAndStartAnimation(
      'camEditorRadiusAnim',
      cam,
      'radius',
      60,
      25,
      cam.radius,
      radius,
      2,
      ease
    );
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

    Animation.CreateAndStartAnimation(
      'camRadius',
      this.motor3d.editorCamera,
      'radius',
      60,
      40,
      this.motor3d.editorCamera.radius,
      objectRadius,
      2,
      ease
    );

    const anim = Animation.CreateAndStartAnimation(
      'camBeta',
      this.motor3d.editorCamera,
      'beta',
      60,
      40,
      this.motor3d.editorCamera.beta,
      Math.PI / 3,
      2,
      ease
    );

    anim?.onAnimationEndObservable.addOnce(() => {
      this.state.playState.set('EDITING_IN_GAME');
      this.state.objetoSeleccionado.set(objetoReceptor);
      this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    });
  }

  volverAJuego(): void {
    this.state.playState.set('TRANSITIONING');
    this.state.objetoSeleccionado.set(null);
    this.motor3d.editorCamera.detachControl();

    const targetCam = this.state.modoVistaPrueba === 'FPS'
      ? this.motor3d.playerCameraFPS
      : this.motor3d.playerCameraTPS;

    const targetPos = targetCam.globalPosition.clone();

    let targetLookAt: Vector3;
    if (this.state.modoVistaPrueba === 'FPS') {
      targetLookAt = targetCam.globalPosition.add(targetCam.getDirection(Vector3.Forward()));
    } else {
      targetLookAt = this.state.cameraPivot!.getAbsolutePosition();
    }

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    Animation.CreateAndStartAnimation(
      'camPos',
      this.motor3d.editorCamera,
      'position',
      60,
      90,
      this.motor3d.editorCamera.position,
      targetPos,
      2,
      ease
    );

    const currentTarget = this.motor3d.editorCamera.getTarget().clone();
    const animTarget = Animation.CreateAndStartAnimation(
      'camTarget',
      this.motor3d.editorCamera,
      'target',
      60,
      90,
      currentTarget,
      targetLookAt,
      2,
      ease
    );

    animTarget?.onAnimationEndObservable.addOnce(() => {
      this.motor3d.scene.activeCamera = targetCam;
      this.state.playState.set('PLAYING');
    });
  }
}