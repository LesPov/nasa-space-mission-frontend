import { Injectable, inject } from '@angular/core';
import { Vector3, Node, AbstractMesh, Animation, CubicEase, EasingFunction } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';

@Injectable({ providedIn: 'root' })
export class EditorCameraService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  private ultimaPosCamaraLibre: Vector3 | null = null;
  private ultimoTargetCamaraLibre: Vector3 | null = null;

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

  // 🔥 ENFOQUE CINEMATOGRÁFICO POR DOBLE CLIC
  enfocarObjetoEnEditor(objeto: Node): void {
    if (!objeto || !(objeto instanceof AbstractMesh)) return;
    if (this.state.playState() !== 'EDITOR') return; 

    const cam = this.motor3d.editorCamera;
    if (!cam) return;

    // 1. Encontrar el centro absoluto del objeto
    objeto.computeWorldMatrix(true);
    const boundingInfo = objeto.getBoundingInfo();
    const targetPos = boundingInfo.boundingBox.centerWorld.clone(); 
    
    // 2. Determinar el tamaño real para no hacerle un zoom extremo a la cara
    const maxSize = boundingInfo.boundingBox.maximumWorld.subtract(boundingInfo.boundingBox.minimumWorld).length();
    
    // 3. Lógica de Distancia Dinámica
    let targetRadius = Math.max(3, maxSize * 1.5); 
    
    // Si el objeto es un NPC o el Player, forzamos un alejamiento mayor para ver el cuerpo entero
    if (objeto.metadata?.rol === 'npc' || objeto.metadata?.rol === 'spawn_point') {
        targetRadius = Math.max(5, maxSize * 2.2); 
    }

    // 4. Suavizado de la cámara (EaseInOut)
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const currentTarget = cam.getTarget().clone();
    
    // Animar la Mirada (Hacia donde apunta)
    Animation.CreateAndStartAnimation(
      "camEditorTargetAnim", cam, "target", 60, 25, 
      currentTarget, targetPos, 2, ease
    );

    // Animar la Distancia (Zoom in / Zoom out)
    Animation.CreateAndStartAnimation(
      "camEditorRadiusAnim", cam, "radius", 60, 25, 
      cam.radius, targetRadius, 2, ease
    );
  }

  transicionAEdicionEnVivo(objetoReceptor: Node): void {
    this.state.playState.set('TRANSITIONING');
    document.exitPointerLock();

    let objectRadius = 5;
    if (objetoReceptor instanceof AbstractMesh) {
      const boundingInfo = objetoReceptor.getHierarchyBoundingVectors(true);
      const maxSize = boundingInfo.max.subtract(boundingInfo.min).length();
      objectRadius = Math.max(maxSize * 1.5, 2.5);
    }

    const targetPos = (objetoReceptor as AbstractMesh).getAbsolutePosition().clone();
    const activeCam = this.motor3d.scene.activeCamera;
    const startPos = activeCam!.globalPosition.clone();

    this.motor3d.editorCamera.detachControl();
    this.motor3d.editorCamera.position = startPos;
    this.motor3d.editorCamera.setTarget(targetPos);
    this.motor3d.scene.activeCamera = this.motor3d.editorCamera;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    Animation.CreateAndStartAnimation("camRadius", this.motor3d.editorCamera, "radius", 60, 40, this.motor3d.editorCamera.radius, objectRadius, 2, ease);
    const anim = Animation.CreateAndStartAnimation("camBeta", this.motor3d.editorCamera, "beta", 60, 40, this.motor3d.editorCamera.beta, Math.PI / 3, 2, ease);

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

    const targetCam = this.state.modoVistaPrueba === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    const targetPos = targetCam.globalPosition.clone();

    let targetLookAt: Vector3;
    if (this.state.modoVistaPrueba === 'FPS') {
      targetLookAt = targetCam.globalPosition.add(targetCam.getDirection(Vector3.Forward()));
    } else {
      targetLookAt = this.state.cameraPivot!.getAbsolutePosition();
    }

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    Animation.CreateAndStartAnimation("camPos", this.motor3d.editorCamera, "position", 60, 90, this.motor3d.editorCamera.position, targetPos, 2, ease);
    const currentTarget = this.motor3d.editorCamera.getTarget().clone();
    const animTarget = Animation.CreateAndStartAnimation("camTarget", this.motor3d.editorCamera, "target", 60, 90, currentTarget, targetLookAt, 2, ease);

    animTarget?.onAnimationEndObservable.addOnce(() => {
      this.motor3d.scene.activeCamera = targetCam;
      this.state.playState.set('PLAYING');
      const canvas = this.motor3d.engine.getRenderingCanvas();
      if (canvas) {
        canvas.focus();
        try { canvas.requestPointerLock(); } catch (e) { }
      }
    });
  }
}