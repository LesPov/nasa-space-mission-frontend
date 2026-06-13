
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Quaternion, Vector3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { HistorialService } from '../../../../services/historial.service';
 @Component({
  selector: 'app-prop-transform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-transform.html',
  styleUrls: ['../inspector-properties.css'] // 🔥 Reutiliza el CSS maestro
})
export class PropTransform implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  objInteractDistanceFPS = 3.0;
  objInteractDistanceTPS = 5.0;
  objInteractSequenceIdFPS = '';
  objInteractSequenceIdTPS = '';
  objMensaje = '';
  animStatus = '';

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private formatNum(val: number): number { return parseFloat(Number(val || 0).toFixed(3)); }

  syncData() {
    if (!this.objeto) return;
    this.localPosX = this.formatNum(this.objeto.position.x); 
    this.localPosY = this.formatNum(this.objeto.position.y); 
    this.localPosZ = this.formatNum(this.objeto.position.z);
    
    if (this.objeto.rotationQuaternion) {
      const euler = this.objeto.rotationQuaternion.toEulerAngles();
      this.localRotX = this.formatNum(euler.x * (180 / Math.PI)); 
      this.localRotY = this.formatNum(euler.y * (180 / Math.PI)); 
      this.localRotZ = this.formatNum(euler.z * (180 / Math.PI));
    } else {
      this.localRotX = this.formatNum(this.objeto.rotation.x * (180 / Math.PI)); 
      this.localRotY = this.formatNum(this.objeto.rotation.y * (180 / Math.PI)); 
      this.localRotZ = this.formatNum(this.objeto.rotation.z * (180 / Math.PI));
    }
    
    this.localEscX = this.formatNum(this.objeto.scaling.x); 
    this.localEscY = this.formatNum(this.objeto.scaling.y); 
    this.localEscZ = this.formatNum(this.objeto.scaling.z);

    const meta = this.objeto.metadata || {};
    this.objInteractDistanceFPS = meta.interactDistanceFPS ?? 3.0;
    this.objInteractDistanceTPS = meta.interactDistanceTPS ?? 5.0;
    this.objInteractSequenceIdFPS = meta.interactSequenceIdFPS || meta.interactSequenceId || '';
    this.objInteractSequenceIdTPS = meta.interactSequenceIdTPS || meta.interactSequenceId || '';
    this.objMensaje = meta.mensaje || '';
    this.cdr.detectChanges();
  }

  aplicarPosicion() {
    this.historialSvc.registrarCambioTransform(this.objeto, () => { this.objeto.position.set(this.localPosX, this.localPosY, this.localPosZ); });
    this.editorSvc.triggerUpdate();
  }

  aplicarRotacion() {
    const rx = this.localRotX * (Math.PI / 180); const ry = this.localRotY * (Math.PI / 180); const rz = this.localRotZ * (Math.PI / 180);
    this.historialSvc.registrarCambioTransform(this.objeto, () => { this.objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz); this.objeto.rotation.set(0, 0, 0); });
    this.editorSvc.triggerUpdate();
  }

  aplicarEscala() {
    this.historialSvc.registrarCambioTransform(this.objeto, () => { this.objeto.scaling.set(this.localEscX, this.localEscY, this.localEscZ); });
    this.editorSvc.triggerUpdate();
  }

  aplicarInteraccion() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    this.objeto.metadata.interactDistanceFPS = this.objInteractDistanceFPS;
    this.objeto.metadata.interactDistanceTPS = this.objInteractDistanceTPS;
    this.objeto.metadata.interactSequenceIdFPS = this.objInteractSequenceIdFPS.trim();
    this.objeto.metadata.interactSequenceIdTPS = this.objInteractSequenceIdTPS.trim();
    this.objeto.metadata.mensaje = this.objMensaje.trim();
    this.editorSvc.triggerUpdate();
    this.animStatus = '✅ Interacción guardada';
  }
}
