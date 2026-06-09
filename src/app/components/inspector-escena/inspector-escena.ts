import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { HistorialService } from '../../services/historial.service';
import { Motor3dService } from '../../services/motor-3d.service';
import { 
  Node, AbstractMesh, Camera, Light, AnimationGroup, 
  Quaternion, Color3, StandardMaterial, Vector3, MeshBuilder, Mesh,
  TransformNode, Observer, Scene, Matrix
} from '@babylonjs/core';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-inspector-escena',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspector-escena.html',
  styleUrl: './inspector-escena.css'
})
export class InspectorEscena implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);

  private _pestanaActiva: string = 'transform';
  get pestanaActiva() { return this._pestanaActiva; }
  set pestanaActiva(val: string) {
    this._pestanaActiva = val;
    this.actualizarDebugVisual();
  }

  private subs: Subscription[] = [];
  public nodosExpandidos = new Set<string>();

  // Transformaciones Base
  localPosX: number = 0; localPosY: number = 0; localPosZ: number = 0;
  localRotX: number = 0; localRotY: number = 0; localRotZ: number = 0;
  localEscX: number = 1; localEscY: number = 1; localEscZ: number = 1;

  // Propiedades de la Cápsula (Controller) y Cámara
  capsuleRadX: number = 0.4; capsuleRadY: number = 0.9; capsuleRadZ: number = 0.4;
  capsuleOffX: number = 0; capsuleOffY: number = 0.9; capsuleOffZ: number = 0;
  camPosX: number = 0; camPosY: number = 1.6; camPosZ: number = 0;

  // Visualizadores 3D Debug
  private debugCapsule: Mesh | null = null;
  private debugCameraBox: Mesh | null = null;
  
  // Nodos para seguir la animación en vivo
  private renderObserver: Observer<Scene> | null = null;
  private headNode: TransformNode | null = null;
  private initialHeadLocal: Vector3 | null = null;

  constructor() {
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado();
      this.limpiarDebugVisual();
      if (obj) {
        this.syncTransformFromBabylon(obj as AbstractMesh);
        this.actualizarDebugVisual();
        this.cdr.detectChanges();
      }
    });
  }

  ngOnInit() {
    const refrescar = () => {
      const obj = this.editorSvc.objetoSeleccionado();
      if (obj) {
        this.syncTransformFromBabylon(obj as AbstractMesh);
        this.actualizarDebugVisual();
        this.cdr.detectChanges();
      }
    };

    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(refrescar),
      this.editorSvc.onMapChanged.subscribe(refrescar)
    );

    // 🔥 LOOP DE RENDER PARA MOVER LA CÁPSULA/CÁMARA CON LA ANIMACIÓN
    this.renderObserver = this.motor3dSvc.scene.onBeforeRenderObservable.add(() => {
        if (!this.objetoActual || !this.debugCameraBox || !this.debugCapsule) return;

        let breathX = 0, breathY = 0, breathZ = 0;

        if (this.headNode && this.initialHeadLocal) {
            const currentGlobal = this.headNode.getAbsolutePosition();
            const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(this.objetoActual.getWorldMatrix()));
            
            breathX = currentLocal.x - this.initialHeadLocal.x;
            breathY = currentLocal.y - this.initialHeadLocal.y;
            breathZ = currentLocal.z - this.initialHeadLocal.z;
        }

        this.debugCameraBox.position.set(this.camPosX + breathX, this.camPosY + breathY, this.camPosZ + breathZ);
        this.debugCapsule.position.set(this.capsuleOffX + breathX, this.capsuleOffY + breathY, this.capsuleOffZ + breathZ);
    });
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.limpiarDebugVisual();
    if (this.renderObserver && this.motor3dSvc.scene) {
        this.motor3dSvc.scene.onBeforeRenderObservable.remove(this.renderObserver);
    }
  }

  get objetoActual() {
    return this.editorSvc.objetoSeleccionado() as any;
  }

  get listaNodos() {
    return this.editorSvc.nodosEscena();
  }

  private formatNum(val: number): number {
    return parseFloat(val.toFixed(3));
  }

  private syncTransformFromBabylon(obj: any) {
    if (!obj || !obj.position) return;

    this.localPosX = this.formatNum(obj.position.x);
    this.localPosY = this.formatNum(obj.position.y);
    this.localPosZ = this.formatNum(obj.position.z);

    if (obj.rotationQuaternion) {
      const euler = obj.rotationQuaternion.toEulerAngles();
      this.localRotX = this.formatNum(euler.x * (180 / Math.PI));
      this.localRotY = this.formatNum(euler.y * (180 / Math.PI));
      this.localRotZ = this.formatNum(euler.z * (180 / Math.PI));
    } else {
      this.localRotX = this.formatNum(obj.rotation.x * (180 / Math.PI));
      this.localRotY = this.formatNum(obj.rotation.y * (180 / Math.PI));
      this.localRotZ = this.formatNum(obj.rotation.z * (180 / Math.PI));
    }

    if (obj.scaling) {
      this.localEscX = this.formatNum(obj.scaling.x);
      this.localEscY = this.formatNum(obj.scaling.y);
      this.localEscZ = this.formatNum(obj.scaling.z);
    }

    const cap = obj.metadata?.capsule;
    if (cap) {
      this.capsuleRadX = this.formatNum(cap.radiusX);
      this.capsuleRadY = this.formatNum(cap.heightY);
      this.capsuleRadZ = this.formatNum(cap.radiusZ);
      this.capsuleOffX = this.formatNum(cap.offsetX);
      this.capsuleOffY = this.formatNum(cap.offsetY);
      this.capsuleOffZ = this.formatNum(cap.offsetZ);
    } else if (obj.ellipsoid) {
      this.capsuleRadX = this.formatNum(obj.ellipsoid.x);
      this.capsuleRadY = this.formatNum(obj.ellipsoid.y);
      this.capsuleRadZ = this.formatNum(obj.ellipsoid.z);
      this.capsuleOffX = this.formatNum(obj.ellipsoidOffset.x);
      this.capsuleOffY = this.formatNum(obj.ellipsoidOffset.y);
      this.capsuleOffZ = this.formatNum(obj.ellipsoidOffset.z);
    }

    const camOffset = obj.metadata?.camOffset;
    if (camOffset) {
      this.camPosX = this.formatNum(camOffset.x);
      this.camPosY = this.formatNum(camOffset.y);
      this.camPosZ = this.formatNum(camOffset.z);
    }
  }

  aplicarPosicion() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj) return;
    this.historialSvc.registrarCambioTransform(obj, () => {
      obj.position.set(this.localPosX, this.localPosY, this.localPosZ);
    });
    this.editorSvc.triggerUpdate();
  }

  aplicarRotacion() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj) return;
    const rx = this.localRotX * (Math.PI / 180);
    const ry = this.localRotY * (Math.PI / 180);
    const rz = this.localRotZ * (Math.PI / 180);
    this.historialSvc.registrarCambioTransform(obj, () => {
      obj.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
      obj.rotation.set(0, 0, 0);
    });
    this.editorSvc.triggerUpdate();
  }

  aplicarEscala() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj || !obj.scaling) return;
    this.historialSvc.registrarCambioTransform(obj, () => {
      obj.scaling.set(this.localEscX, this.localEscY, this.localEscZ);
    });
    this.editorSvc.triggerUpdate();
  }

  aplicarCapsula() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj) return;
    
    if (!obj.metadata) obj.metadata = {};
    obj.metadata.capsule = {
        radiusX: this.capsuleRadX,
        heightY: this.capsuleRadY,
        radiusZ: this.capsuleRadZ,
        offsetX: this.capsuleOffX,
        offsetY: this.capsuleOffY,
        offsetZ: this.capsuleOffZ
    };

    if (!obj.ellipsoid) obj.ellipsoid = new Vector3(0.5, 1, 0.5);
    if (!obj.ellipsoidOffset) obj.ellipsoidOffset = new Vector3(0, 1, 0);

    obj.ellipsoid.set(this.capsuleRadX, this.capsuleRadY, this.capsuleRadZ);
    obj.ellipsoidOffset.set(this.capsuleOffX, this.capsuleOffY, this.capsuleOffZ);
    
    this.actualizarDebugVisual();
    this.editorSvc.triggerUpdate();
  }

  aplicarCamara() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj) return;
    
    if (!obj.metadata) obj.metadata = {};
    obj.metadata.camOffset = { x: this.camPosX, y: this.camPosY, z: this.camPosZ };

    this.actualizarDebugVisual();
    this.editorSvc.triggerUpdate();
  }

  limpiarDebugVisual() {
    if (this.debugCapsule) { this.debugCapsule.dispose(); this.debugCapsule = null; }
    if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
  }

  actualizarDebugVisual() {
    this.limpiarDebugVisual();
    if (this.pestanaActiva !== 'physics' || !this.objetoActual) return;
    if (!this.esPersonajeOModelo(this.objetoActual)) return;

    const scene = this.objetoActual.getScene();
    
    // Buscar la cabeza para sincronizar el Wireframe en el Editor
    this.headNode = this.objetoActual.getChildTransformNodes(false).find((n: any) => 
        n.name.toLowerCase() === 'head' || 
        n.name.toLowerCase() === 'neck' || 
        n.name.toLowerCase().includes('mixamorig:head') ||
        n.name.toLowerCase().includes('head')
    ) as TransformNode;

    if (this.headNode) {
        this.headNode.computeWorldMatrix(true);
        this.objetoActual.computeWorldMatrix(true);
        this.initialHeadLocal = Vector3.TransformCoordinates(
            this.headNode.getAbsolutePosition(), 
            Matrix.Invert(this.objetoActual.getWorldMatrix())
        );
    } else {
        this.initialHeadLocal = null;
    }
    
    this.debugCapsule = MeshBuilder.CreateCapsule("debugCapsule", {
      radius: this.capsuleRadX, 
      height: this.capsuleRadY * 2
    }, scene);
    this.debugCapsule.position = new Vector3(this.capsuleOffX, this.capsuleOffY, this.capsuleOffZ);
    this.debugCapsule.parent = this.objetoActual;
    
    const matCap = new StandardMaterial("debugCapMat", scene);
    matCap.wireframe = true;
    matCap.emissiveColor = new Color3(0.2, 0.8, 0.2); 
    matCap.disableLighting = true;
    this.debugCapsule.material = matCap;
    this.debugCapsule.isPickable = false; 

    this.debugCameraBox = MeshBuilder.CreateBox("debugCamBox", { size: 0.25 }, scene);
    this.debugCameraBox.position = new Vector3(this.camPosX, this.camPosY, this.camPosZ);
    this.debugCameraBox.parent = this.objetoActual;
    
    const matCam = new StandardMaterial("debugCamMat", scene);
    matCam.wireframe = true;
    matCam.emissiveColor = new Color3(0.9, 0.2, 0.2); 
    matCam.disableLighting = true;
    this.debugCameraBox.material = matCam;
    this.debugCameraBox.isPickable = false;
  }

  toggleExpandir(nodo: Node, event: Event) {
    event.stopPropagation();
    if (this.nodosExpandidos.has(nodo.name)) {
      this.nodosExpandidos.delete(nodo.name);
    } else {
      this.nodosExpandidos.add(nodo.name);
    }
  }

  estaExpandido(nodo: Node): boolean {
    return this.nodosExpandidos.has(nodo.name);
  }

  seleccionarSubItem(pestana: string, nodo: Node, event: Event) {
    event.stopPropagation();
    this.seleccionarDesdeLista(nodo);
    this.pestanaActiva = pestana;
  }

  esPersonajeOModelo(nodo: Node): boolean {
    if (!nodo || !(nodo as AbstractMesh).metadata) return false;
    const meta = (nodo as AbstractMesh).metadata;
    return meta.type === 'model' || meta.rol === 'npc' || meta.rol === 'spawn_point';
  }

  tieneAnimaciones(nodo: Node): boolean {
    return nodo instanceof AbstractMesh && nodo.metadata?.animations?.length > 0;
  }

  tieneCapsula(nodo: Node): boolean {
    return nodo instanceof AbstractMesh && !!nodo.metadata?.capsule;
  }

  tieneCamara(nodo: Node): boolean {
    return this.esPersonajeOModelo(nodo);
  }

  getIcono(nodo: Node): string {
    if (nodo instanceof Camera) return '🎥';
    if (nodo instanceof Light) return '💡';
    if (nodo instanceof AbstractMesh) {
      if (nodo.name.includes('Cubo')) return '🧊';
      if (nodo.name.includes('Esfera')) return '⚽';
      if (nodo.metadata?.type === 'model') return '🧍';
      return '📐';
    }
    return '📌';
  }

  esBloqueado(nodo: Node): boolean { return nodo instanceof Camera || nodo instanceof Light; }
  esSeleccionado(nodo: Node): boolean { return this.editorSvc.objetoSeleccionado() === nodo; }
  eliminarObjeto() { this.editorSvc.eliminarSeleccionado(); }
  seleccionarDesdeLista(nodo: Node) { if (this.esBloqueado(nodo)) return; this.editorSvc.seleccionarObjeto(nodo); }
  
  reproducirAnimacion(anim: AnimationGroup) {
    if (this.objetoActual && this.objetoActual.metadata?.animations) {
      this.objetoActual.metadata.animations.forEach((a: AnimationGroup) => a.stop());
    }
    anim.play(true);
  }

  detenerAnimaciones() {
    if (this.objetoActual && this.objetoActual.metadata?.animations) {
      this.objetoActual.metadata.animations.forEach((a: AnimationGroup) => a.stop());
    }
  }
}