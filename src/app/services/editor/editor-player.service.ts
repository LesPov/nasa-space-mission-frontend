import { Injectable, inject } from '@angular/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { Mesh, Vector3, Quaternion, AnimationGroup, Observer, KeyboardInfo, Scene, KeyboardEventTypes, MeshBuilder, Matrix, Ray, UniversalCamera, AbstractMesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class EditorPlayerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);

  private playerHalfHeight: number = 0.9;
  private playerEyeLevel: number = 1.6;
  private velocidadY: number = 0;
  private isPlayerMoving: boolean = false;
  private isJumping: boolean = false;
  
  private animacionesJugador: AnimationGroup[] = [];
  private animIdle: AnimationGroup | null = null;
  private animWalk: AnimationGroup | null = null;
  private animJump: AnimationGroup | null = null;

  private inputMap: Record<string, boolean> = {};
  private tecladoObserver: Observer<KeyboardInfo> | null = null;
  private tpsUpdateObserver: Observer<Scene> | null = null;

  constructor() {
    // 🔥 FIX: Movemos el listener del ratón aquí para que pueda acceder a resetMovimientoJugador()
    document.addEventListener('pointerlockchange', () => {
      const isLocked = !!document.pointerLockElement;
      this.state.ratonBloqueado.set(isLocked);

      if (!isLocked) {
        const stateStr = this.state.playState();
        if (stateStr === 'PLAYING' || stateStr === 'EDITING_IN_GAME' || stateStr === 'TRANSITIONING' || stateStr === 'INTERACTING') {
          this.resetMovimientoJugador();
        }
      }
    });
  }

  iniciarModoJuego(vista: 'FPS' | 'TPS') {
    const obj = this.state.objetoSeleccionado() as Mesh;
    if (!obj) return;

    this.cameraSvc.guardarEstadoCamaraLibre();
    this.state.playState.set('PLAYING');
    this.state.jugadorActivo = obj;
    this.state.modoVistaPrueba = vista;
    this.state.objetoHovereado.set(null);

    // Backups
    this.state.backupObjetoPosicion = obj.position.clone();
    if (obj.rotationQuaternion) {
      this.state.backupObjetoRotacionQuat = obj.rotationQuaternion.clone();
    } else {
      this.state.backupObjetoRotacionQuat = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
      obj.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
    }
    this.state.backupObjetoVisibilidad = obj.isVisible;
    this.state.backupColisionJugador = obj.checkCollisions;

    this.state.backupColisionesHijos = [];
    obj.getChildMeshes().forEach(m => {
      this.state.backupColisionesHijos.push({ mesh: m as AbstractMesh, col: m.checkCollisions });
      m.checkCollisions = false;
    });

    obj.checkCollisions = true;
    this.state.objetoSeleccionado.set(null);

    const canvas = this.motor3d.engine.getRenderingCanvas();
    const scene = this.motor3d.scene;

    const boundingInfo = obj.getHierarchyBoundingVectors(true);
    let alturaReal = boundingInfo.max.y - boundingInfo.min.y;
    if (alturaReal < 0.5) alturaReal = 1.8;

    this.playerHalfHeight = alturaReal / 2;
    this.playerEyeLevel = alturaReal * 0.92;

    const radioCapsula = 0.4;
    obj.ellipsoid = new Vector3(radioCapsula, this.playerHalfHeight, radioCapsula);
    obj.ellipsoidOffset = new Vector3(0, this.playerHalfHeight, 0);

    this.animacionesJugador = obj.metadata?.animations || [];
    this.animIdle = null; this.animWalk = null; this.animJump = null;
    this.isPlayerMoving = false; this.isJumping = false;

    if (this.animacionesJugador.length > 0) {
      this.animacionesJugador.forEach(a => a.stop());
      this.animIdle = this.animacionesJugador.find(a => a.name.toLowerCase().includes('idle')) || this.animacionesJugador[0];
      this.animWalk = this.animacionesJugador.find(a => a.name.toLowerCase().includes('walk') || a.name.toLowerCase().includes('run')) || this.animIdle;
      this.animJump = this.animacionesJugador.find(a => a.name.toLowerCase().includes('jump')) || this.animIdle;
      if (this.animIdle) this.animIdle.play(true);
    }

    this.inputMap = {};

    this.tecladoObserver = scene.onKeyboardObservable.add((kbInfo) => {
      if (this.state.playState() !== 'PLAYING' || !this.state.ratonBloqueado()) return;
      if (kbInfo.event.key) {
        this.inputMap[kbInfo.event.key.toLowerCase()] = kbInfo.type === KeyboardEventTypes.KEYDOWN;
      }
      if (kbInfo.event.code === "Space") {
        this.inputMap["space"] = kbInfo.type === KeyboardEventTypes.KEYDOWN;
      }
    });

    if (vista === 'FPS') {
      scene.activeCamera = this.motor3d.playerCameraFPS;
      this.motor3d.playerCameraFPS.keysUp = [];
      this.motor3d.playerCameraFPS.keysDown = [];
      this.motor3d.playerCameraFPS.keysLeft = [];
      this.motor3d.playerCameraFPS.keysRight = [];
    } else {
      obj.isVisible = true;
      this.state.cameraPivot = MeshBuilder.CreateBox("cameraPivot", { size: 0.1 }, scene);
      this.state.cameraPivot.isVisible = false;
      this.state.cameraPivot.position = new Vector3(obj.position.x, obj.position.y + this.playerEyeLevel, obj.position.z);
      this.motor3d.playerCameraTPS.lockedTarget = this.state.cameraPivot;
      this.motor3d.playerCameraTPS.radius = 5;
      scene.activeCamera = this.motor3d.playerCameraTPS;
    }

    this.velocidadY = -0.1;

    this.tpsUpdateObserver = scene.onBeforeRenderObservable.add(() => {
      if (!this.state.jugadorActivo) return;

      if (this.state.playState() === 'PLAYING') {
        if (this.state.ratonBloqueado()) {

          let nuevoHover: AbstractMesh | null = null;

          if (vista === 'FPS') {
            const w = this.motor3d.engine.getRenderWidth();
            const h = this.motor3d.engine.getRenderHeight();
            const crosshairRay = scene.createPickingRay(w / 2, h / 2, Matrix.Identity(), scene.activeCamera);
            const hitCross = scene.pickWithRay(crosshairRay, this.state.esObjetoObstructor);

            if (hitCross && hitCross.hit && hitCross.pickedMesh && this.state.puedeSeleccionarse(hitCross.pickedMesh as AbstractMesh)) {
              const rootNode = this.state.encontrarRaiz(hitCross.pickedMesh as AbstractMesh);
              if (rootNode && rootNode instanceof AbstractMesh) {
                nuevoHover = rootNode;
              }
            }
          }

          this.state.mirandoObjetoInteractuable.set(!!nuevoHover);
          this.state.objetoHovereado.set(nuevoHover);

          let forward = scene.activeCamera!.getDirection(Vector3.Forward());
          forward.y = 0;
          forward.normalize();
          let right = scene.activeCamera!.getDirection(Vector3.Right());
          right.y = 0;
          right.normalize();

          let move = Vector3.Zero();
          if (this.inputMap['w']) move.addInPlace(forward);
          if (this.inputMap['s']) move.subtractInPlace(forward);
          if (this.inputMap['d']) move.addInPlace(right);
          if (this.inputMap['a']) move.subtractInPlace(right);

          let isMoving = move.lengthSquared() > 0.001;

          if (isMoving) {
            move.normalize().scaleInPlace(this.inputMap['shift'] ? 0.22 : 0.08);
            if (vista === 'TPS') {
              let targetAngle = Math.atan2(move.x, move.z);
              if (!this.state.jugadorActivo.rotationQuaternion) this.state.jugadorActivo.rotationQuaternion = Quaternion.Identity();
              this.state.jugadorActivo.rotationQuaternion = Quaternion.Slerp(
                this.state.jugadorActivo.rotationQuaternion,
                Quaternion.FromEulerAngles(0, targetAngle, 0),
                0.15
              );
            }
          }

          const rayOrigin = new Vector3(this.state.jugadorActivo.position.x, this.state.jugadorActivo.position.y + this.playerHalfHeight, this.state.jugadorActivo.position.z);
          const rayCol = new Ray(rayOrigin, Vector3.Down(), this.playerHalfHeight + 0.1);

          let rayHit = false;
          for (let i = 0; i < scene.meshes.length; i++) {
            const m = scene.meshes[i];
            if (m.checkCollisions && m !== this.state.jugadorActivo && !this.state.isDescendant(m, this.state.jugadorActivo) && !m.name.includes('eje') && !m.name.includes('gridHelper')) {
              if (rayCol.intersectsMesh(m as AbstractMesh).hit) { rayHit = true; break; }
            }
          }

          if (rayHit) {
            if (this.velocidadY <= 0) this.velocidadY = -0.05;
            if (this.isJumping) { this.isJumping = false; this.isPlayerMoving = false; }

            if (this.inputMap['space'] && !this.isJumping) {
              this.velocidadY = 0.3;
              this.inputMap['space'] = false;
              this.isJumping = true;
              if (this.animJump) {
                this.animIdle?.stop();
                this.animWalk?.stop();
                this.animJump.play(false);
              }
            }
          } else {
            this.velocidadY -= 0.015;
            if (this.velocidadY < -0.8) this.velocidadY = -0.8;
          }

          move.y = this.velocidadY;
          this.state.jugadorActivo.moveWithCollisions(move);

          if (!this.isJumping) {
            if (isMoving && !this.isPlayerMoving) {
              this.isPlayerMoving = true;
              if (this.animIdle) this.animIdle.stop();
              if (this.animWalk) this.animWalk.play(true);
            } else if (!isMoving && this.isPlayerMoving) {
              this.isPlayerMoving = false;
              if (this.animWalk) this.animWalk.stop();
              if (this.animIdle) this.animIdle.play(true);
            }
          }
        }
      }

      if (vista === 'FPS') {
        const camRotY = (scene.activeCamera as UniversalCamera).rotation.y;
        const forwardOffset = 0.30;
        const offsetX = Math.sin(camRotY) * forwardOffset;
        const offsetZ = Math.cos(camRotY) * forwardOffset;

        this.motor3d.playerCameraFPS.position = new Vector3(
          this.state.jugadorActivo.position.x + offsetX,
          this.state.jugadorActivo.position.y + this.playerEyeLevel,
          this.state.jugadorActivo.position.z + offsetZ
        );

        if (!this.state.jugadorActivo.rotationQuaternion) this.state.jugadorActivo.rotationQuaternion = Quaternion.Identity();
        this.state.jugadorActivo.rotationQuaternion = Quaternion.FromEulerAngles(0, camRotY, 0);

      } else if (this.state.cameraPivot) {
        this.state.cameraPivot.position = Vector3.Lerp(
          this.state.cameraPivot.position,
          new Vector3(
            this.state.jugadorActivo.position.x,
            this.state.jugadorActivo.position.y + (this.playerHalfHeight * 1.5),
            this.state.jugadorActivo.position.z
          ),
          0.3
        );
      }
    });

    if (canvas) {
      canvas.focus();
      try {
        scene.activeCamera!.attachControl(canvas, true);
        canvas.requestPointerLock();
      } catch (e) { }
    }
  }

  detenerModoJuego() {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');

    this.resetMovimientoJugador();
    this.cameraSvc.guardarEstadoCamaraLibre();
    scene.stopAllAnimations();

    this.motor3d.playerCameraFPS.detachControl();
    this.motor3d.playerCameraTPS.detachControl();
    this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);

    this.animacionesJugador.forEach(a => a.stop());
    this.animacionesJugador = []; this.animIdle = null; this.animWalk = null; this.animJump = null;
    this.isPlayerMoving = false; this.isJumping = false;

    if (this.state.cameraPivot) { this.state.cameraPivot.dispose(); this.state.cameraPivot = null; }
    if (this.tecladoObserver) scene.onKeyboardObservable.remove(this.tecladoObserver);
    if (this.tpsUpdateObserver) scene.onBeforeRenderObservable.remove(this.tpsUpdateObserver);

    this.tecladoObserver = null; this.tpsUpdateObserver = null;
    this.inputMap = {};

    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);
    scene.activeCamera = this.motor3d.editorCamera;

    this.cameraSvc.restaurarCamaraLibre();

    if (this.state.jugadorActivo && this.state.backupObjetoPosicion && this.state.backupObjetoRotacionQuat) {
      if (this.state.jugadorActivo.metadata?.rol === 'npc' || this.state.jugadorActivo.metadata?.rol === 'spawn_point') {
        if (this.state.modoVistaPrueba === 'FPS') this.state.jugadorActivo.rotationQuaternion = Quaternion.FromEulerAngles(0, (this.motor3d.playerCameraFPS as any).rotation.y, 0);
        this.state.triggerUpdate();
      } else {
        this.state.jugadorActivo.position = this.state.backupObjetoPosicion;
        this.state.jugadorActivo.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
      }

      this.state.jugadorActivo.isVisible = this.state.backupObjetoVisibilidad;
      this.state.jugadorActivo.checkCollisions = this.state.backupColisionJugador;

      this.state.backupColisionesHijos.forEach(item => {
        if (item.mesh) item.mesh.checkCollisions = item.col;
      });
      this.state.backupColisionesHijos = [];
    }

    if (this.state.jugadorActivo) this.state.objetoSeleccionado.set(this.state.jugadorActivo);

    this.state.jugadorActivo = null;
    this.state.backupObjetoPosicion = null;
    this.state.backupObjetoRotacionQuat = null;
    this.state.modoVistaPrueba = null;

    if (document.pointerLockElement) document.exitPointerLock();
  }

  resetMovimientoJugador(): void {
    this.inputMap = {};
    this.isPlayerMoving = false;
    this.isJumping = false;
    this.velocidadY = -0.1;
    this.state.mirandoObjetoInteractuable.set(false);

    if (this.animWalk) this.animWalk.stop();
    if (this.animJump) this.animJump.stop();

    if (this.animIdle) {
      this.animIdle.stop();
      this.animIdle.play(true);
    }
  }
}