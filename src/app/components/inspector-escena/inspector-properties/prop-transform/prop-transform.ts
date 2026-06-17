import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';

@Component({
  selector: 'app-prop-transform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-transform.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropTransform implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;

  private editorSvc = inject(EditorMapaService);
  private transformMutator = inject(TransformMutatorService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  // Data bindings
  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  mostrarSeccionColor = false;
  objColor = '#ffffff';
  objColorBW = '#ffffff';
  objIgnoraNiebla = false;
  objEsEmisivo = false;
  objBrilloIntensidad = 1.0;

  objInteractDistanceFPS = 3.0;
  objInteractDistanceTPS = 5.0;
  objInteractSequenceIdFPS = '';
  objInteractSequenceIdTPS = '';
  objMensaje = '';

  objProfundidadProyeccion = 0.08;
  objAnguloProyeccion = 0;
  objProyeccionAncho = 1;
  objProyeccionAlto = 1;
  objProyeccionRepeticiones = 1;
  objProyeccionEspaciado = 2;
  objProyeccionEje = 'Y';
  objFadeDistance = 0;

  animStatus = '';

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) this.syncData();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private formatNum(val: number): number {
    return parseFloat(Number(val || 0).toFixed(3));
  }

  syncData() {
    if (!this.objeto) return;

    this.localPosX = this.formatNum(this.objeto.position.x);
    this.localPosY = this.formatNum(this.objeto.position.y);
    this.localPosZ = this.formatNum(this.objeto.position.z);

    const rot = this.objeto.rotationQuaternion ? this.objeto.rotationQuaternion.toEulerAngles() : this.objeto.rotation;
    this.localRotX = this.formatNum(rot.x * (180 / Math.PI));
    this.localRotY = this.formatNum(rot.y * (180 / Math.PI));
    this.localRotZ = this.formatNum(rot.z * (180 / Math.PI));

    const worldScale = new Vector3();
    this.objeto.getWorldMatrix().decompose(worldScale);
    this.localEscX = this.formatNum(Math.abs(worldScale.x));
    this.localEscY = this.formatNum(Math.abs(worldScale.y));
    this.localEscZ = this.formatNum(Math.abs(worldScale.z));

    const meta = this.objeto.metadata || {};
    this.mostrarSeccionColor = ['cube', 'sphere', 'cylinder', 'plane', 'image_plane'].includes(meta.type);
    
    this.objColor = meta.color || '#ffffff';
    this.objColorBW = meta.colorBW || this.objColor;
    this.objIgnoraNiebla = meta.ignoraNiebla ?? false;
    this.objEsEmisivo = meta.esEmisivo ?? false;
    this.objBrilloIntensidad = meta.brilloIntensidad ?? 1.0;

    this.objProfundidadProyeccion = meta.profundidadProyeccion ?? 0.08;
    this.objAnguloProyeccion = this.formatNum(meta.anguloProyeccion ?? 0);
    this.objProyeccionAncho = meta.proyeccionAncho ?? this.localEscX;
    this.objProyeccionAlto = meta.proyeccionAlto ?? this.localEscY;
    this.objProyeccionRepeticiones = meta.proyeccionRepeticiones ?? 1;
    this.objProyeccionEspaciado = meta.proyeccionEspaciado ?? 2;
    this.objProyeccionEje = meta.proyeccionEje || 'Y';
    this.objFadeDistance = meta.fadeDistance ?? 0;

    this.objInteractDistanceFPS = meta.interactDistanceFPS ?? 3.0;
    this.objInteractDistanceTPS = meta.interactDistanceTPS ?? 5.0;
    this.objInteractSequenceIdFPS = meta.interactSequenceIdFPS || meta.interactSequenceId || '';
    this.objInteractSequenceIdTPS = meta.interactSequenceIdTPS || meta.interactSequenceId || '';
    this.objMensaje = meta.mensaje || '';

    this.cdr.detectChanges();
  }

  // --- MÉTODOS DE DELEGACIÓN (El componente es tonto) ---

  aplicarPosicion() {
    this.transformMutator.aplicarPosicion(this.objeto, { x: this.localPosX, y: this.localPosY, z: this.localPosZ });
  }

  aplicarRotacion() {
    this.transformMutator.aplicarRotacion(this.objeto, { x: this.localRotX, y: this.localRotY, z: this.localRotZ });
  }

  aplicarEscala() {
    this.transformMutator.aplicarEscala(this.objeto, { x: this.localEscX, y: this.localEscY, z: this.localEscZ });
  }

  aplicarProyeccion() {
    this.transformMutator.aplicarProyeccion(this.objeto, {
      profundidadProyeccion: this.objProfundidadProyeccion, anguloProyeccion: this.objAnguloProyeccion,
      proyeccionAncho: this.objProyeccionAncho, proyeccionAlto: this.objProyeccionAlto,
      proyeccionRepeticiones: this.objProyeccionRepeticiones, proyeccionEspaciado: this.objProyeccionEspaciado,
      proyeccionEje: this.objProyeccionEje, fadeDistance: this.objFadeDistance
    });
  }

  aplicarVisuales() {
    this.transformMutator.aplicarVisuales(this.objeto, {
      color: this.objColor, colorBW: this.objColorBW, ignoraNiebla: this.objIgnoraNiebla, 
      esEmisivo: this.objEsEmisivo, brilloIntensidad: this.objBrilloIntensidad
    });
  }

  aplicarInteraccion() {
    this.transformMutator.aplicarInteraccion(this.objeto, {
      interactDistanceFPS: this.objInteractDistanceFPS, interactDistanceTPS: this.objInteractDistanceTPS,
      interactSequenceIdFPS: this.objInteractSequenceIdFPS, interactSequenceIdTPS: this.objInteractSequenceIdTPS,
      mensaje: this.objMensaje
    });
    this.animStatus = '✅ Interacción guardada';
  }

  forzarRecalculo() {
    this.transformMutator.forzarRecalculoProyeccion(this.objeto);
    this.animStatus = '🎯 Proyección actualizada';
  }
}