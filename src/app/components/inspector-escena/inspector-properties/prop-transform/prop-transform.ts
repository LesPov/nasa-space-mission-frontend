import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Quaternion, Vector3, StandardMaterial, Color3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { HistorialService } from '../../../../services/historial.service';
import { Motor3dService } from '../../../../services/motor-3d.service';

@Component({
  selector: 'app-prop-transform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-transform.html',
  styleUrls: ['../inspector-properties.css'] 
})
export class PropTransform implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  mostrarSeccionColor = false;
  objColor = '#ffffff';
  objColorBW = '#ffffff';
  
  objIgnoraNiebla = false;
  objEsEmisivo = false; // 🔥 NUEVO: Control para que el objeto brille en la oscuridad

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
    
    this.mostrarSeccionColor = ['cube', 'sphere', 'cylinder', 'plane'].includes(meta.type);
    this.objColor = meta.color || '#ffffff';
    this.objColorBW = meta.colorBW || this.objColor;
    
    this.objIgnoraNiebla = meta.ignoraNiebla ?? false; 
    this.objEsEmisivo = meta.esEmisivo ?? false; // 🔥 Sincronizar estado

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

  aplicarVisuales() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    this.objeto.metadata.color = this.objColor;
    this.objeto.metadata.colorBW = this.objColorBW;
    this.objeto.metadata.ignoraNiebla = this.objIgnoraNiebla;
    this.objeto.metadata.esEmisivo = this.objEsEmisivo;

    const isBW = this.motor3dSvc.scene.metadata?.globalVisualMode === 'bw';
    const activeColorHex = isBW ? this.objColorBW : this.objColor;

    if (this.objeto.material && this.objeto.material instanceof StandardMaterial) {
        this.objeto.material.diffuseColor = Color3.FromHexString(activeColorHex);
        
        // 🔥 LÓGICA DE NEÓN / EMISIVO: Si está activo, el objeto brilla solo.
        if (this.objEsEmisivo) {
            this.objeto.material.emissiveColor = Color3.FromHexString(activeColorHex);
            this.objeto.material.disableLighting = true; // Brilla al 100% sin importar la sombra
        } else {
            this.objeto.material.emissiveColor = new Color3(0, 0, 0);
            this.objeto.material.disableLighting = false; // Vuelve a ser un objeto normal afectado por luz
        }
    }

    this.objeto.applyFog = !this.objIgnoraNiebla;
    this.objeto.getChildMeshes().forEach(m => m.applyFog = !this.objIgnoraNiebla);

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