import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { HistorialService } from '../../services/historial.service';
import { Motor3dService } from '../../services/motor-3d.service';
import { Node, AbstractMesh, Camera, Light, AnimationGroup, Quaternion, Vector3 } from '@babylonjs/core';
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
  set pestanaActiva(val: string) { this._pestanaActiva = val; }

  private subs: Subscription[] = [];
  public nodosExpandidos = new Set<string>();

  // Transformaciones Base
  localPosX: number = 0; localPosY: number = 0; localPosZ: number = 0;
  localRotX: number = 0; localRotY: number = 0; localRotZ: number = 0;
  localEscX: number = 1; localEscY: number = 1; localEscZ: number = 1;

  // Propiedades Collider y Cámara
  colliderType: string = 'mesh';
  colliderSizeX: number = 0.5; colliderSizeY: number = 0.5; colliderSizeZ: number = 0.5;
  colliderOffX: number = 0; colliderOffY: number = 0; colliderOffZ: number = 0;
  camPosX: number = 0; camPosY: number = 1.6; camPosZ: number = 0;

  constructor() {
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado();
      if (obj) {
        this.syncTransformFromBabylon(obj as AbstractMesh);
        this.cdr.detectChanges();
      }
    });
  }

  ngOnInit() {
    const refrescar = () => {
      const obj = this.editorSvc.objetoSeleccionado();
      if (obj) {
        this.syncTransformFromBabylon(obj as AbstractMesh);
        this.cdr.detectChanges();
      }
    };

    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(refrescar),
      this.editorSvc.onMapChanged.subscribe(refrescar)
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
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

    const col = obj.metadata?.collider;
    if (col) {
      this.colliderType = col.type || 'box';
      this.colliderSizeX = this.formatNum(col.sizeX ?? 0.5);
      this.colliderSizeY = this.formatNum(col.sizeY ?? 0.5);
      this.colliderSizeZ = this.formatNum(col.sizeZ ?? 0.5);
      this.colliderOffX = this.formatNum(col.offsetX ?? 0);
      this.colliderOffY = this.formatNum(col.offsetY ?? 0);
      this.colliderOffZ = this.formatNum(col.offsetZ ?? 0);
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

  aplicarCollider() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj) return;
    
    if (!obj.metadata) obj.metadata = {};
    obj.metadata.collider = {
        type: this.colliderType,
        sizeX: this.colliderSizeX,
        sizeY: this.colliderSizeY,
        sizeZ: this.colliderSizeZ,
        offsetX: this.colliderOffX,
        offsetY: this.colliderOffY,
        offsetZ: this.colliderOffZ
    };

    if (this.colliderType !== 'mesh') {
        obj.ellipsoid = new Vector3(this.colliderSizeX * obj.scaling.x, this.colliderSizeY * obj.scaling.y, this.colliderSizeZ * obj.scaling.z);
        obj.ellipsoidOffset = new Vector3(this.colliderOffX * obj.scaling.x, this.colliderOffY * obj.scaling.y, this.colliderOffZ * obj.scaling.z);
    }

    // Si pasamos a mesh, quitamos la selección visual de la cápsula/forma
    if (this.colliderType === 'mesh' && this.editorSvc.subObjetoSeleccionado() === 'collider') {
        this.editorSvc.subObjetoSeleccionado.set(null);
    }

    this.editorSvc.triggerUpdate();
  }

  aplicarCamara() {
    const obj = this.objetoActual as AbstractMesh;
    if (!obj) return;
    
    if (!obj.metadata) obj.metadata = {};
    obj.metadata.camOffset = { x: this.camPosX, y: this.camPosY, z: this.camPosZ };

    this.editorSvc.triggerUpdate();
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

  seleccionarSubItem(pestana: string, subObj: 'collider' | 'camera' | null, nodo: Node, event: Event) {
    event.stopPropagation();
    if (this.esBloqueado(nodo)) return; 
    
    this.editorSvc.seleccionarObjeto(nodo); 
    this.editorSvc.subObjetoSeleccionado.set(subObj);
    this.pestanaActiva = pestana;
  }

  esSubSeleccionado(nodo: Node, subObj: 'collider' | 'camera'): boolean {
    return this.esSeleccionado(nodo) && this.editorSvc.subObjetoSeleccionado() === subObj;
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
    return nodo instanceof AbstractMesh && !!nodo.metadata?.collider;
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
  seleccionarDesdeLista(nodo: Node) { 
    if (this.esBloqueado(nodo)) return; 
    this.editorSvc.seleccionarObjeto(nodo); 
  }
  
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