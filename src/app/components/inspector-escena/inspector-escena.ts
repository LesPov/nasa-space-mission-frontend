import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { HistorialService } from '../../services/historial.service';
import { Node, AbstractMesh, Camera, Light, AnimationGroup, Quaternion, Color3, StandardMaterial } from '@babylonjs/core';
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
  private cdr = inject(ChangeDetectorRef);

  public pestanaActiva: string = 'transform';
  private subs: Subscription[] = [];

  localPosX: number = 0;
  localPosY: number = 0;
  localPosZ: number = 0;

  localRotX: number = 0;
  localRotY: number = 0;
  localRotZ: number = 0;

  localEscX: number = 1;
  localEscY: number = 1;
  localEscZ: number = 1;

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

  actualizarColor(event: Event) {
    if (this.objetoActual && this.objetoActual.metadata) {
      const colorHex = (event.target as HTMLInputElement).value;
      this.objetoActual.metadata.color = colorHex;
      if (this.objetoActual.material instanceof StandardMaterial) {
        this.objetoActual.material.diffuseColor = Color3.FromHexString(colorHex);
      }
      this.editorSvc.triggerUpdate();
    }
  }

  actualizarSolido(event: Event) {
    if (this.objetoActual && this.objetoActual.metadata) {
      const isSolid = (event.target as HTMLInputElement).checked;
      this.objetoActual.metadata.isSolid = isSolid;
      this.objetoActual.checkCollisions = isSolid;
      this.objetoActual.getChildMeshes().forEach((m: AbstractMesh) => m.checkCollisions = isSolid);
      this.editorSvc.triggerUpdate();
    }
  }

  actualizarSeleccionable(event: Event) {
    if (this.objetoActual && this.objetoActual.metadata) {
      const isSelectable = (event.target as HTMLInputElement).checked;
      this.objetoActual.metadata.isSelectable = isSelectable;
      this.editorSvc.triggerUpdate();
    }
  }

  actualizarMensaje(event: Event) {
    if (this.objetoActual && this.objetoActual.metadata) {
      this.objetoActual.metadata.mensaje = (event.target as HTMLInputElement).value;
      this.editorSvc.triggerUpdate();
    }
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

  esBloqueado(nodo: Node): boolean {
    return nodo instanceof Camera || nodo instanceof Light;
  }

  esSeleccionado(nodo: Node): boolean {
    return this.editorSvc.objetoSeleccionado() === nodo;
  }

  eliminarObjeto() {
    this.editorSvc.eliminarSeleccionado();
  }

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