import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Quaternion, StandardMaterial, Color3, Engine } from '@babylonjs/core';
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
export class PropTransform implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;

  private editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  localPosX = 0;
  localPosY = 0;
  localPosZ = 0;

  localRotX = 0;
  localRotY = 0;
  localRotZ = 0;

  localEscX = 1;
  localEscY = 1;
  localEscZ = 1;

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

  // 🔥 SOLUCIÓN 1: Si cambiamos la selección (De padre a hijo), forzamos a refrescar los datos.
  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) {
      this.syncData();
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private formatNum(val: number): number {
    return parseFloat(Number(val || 0).toFixed(3));
  }

  private clampBrightness(v: number): number {
    if (Number.isNaN(v) || v === null || v === undefined) return 1.0;
    return Math.max(0, Math.min(10, Number(v)));
  }

  private clampPositive(v: number, fallback: number, min = 0.01, max = 9999): number {
    if (Number.isNaN(v) || v === null || v === undefined) return fallback;
    return Math.max(min, Math.min(max, Number(v)));
  }

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

    this.mostrarSeccionColor = ['cube', 'sphere', 'cylinder', 'plane', 'image_plane'].includes(meta.type);
    this.objColor = meta.color || '#ffffff';
    this.objColorBW = meta.colorBW || this.objColor;

    this.objIgnoraNiebla = meta.ignoraNiebla ?? false;

    if (meta.type === 'image_plane') {
      this.objEsEmisivo = meta.esEmisivo ?? false;
      this.objBrilloIntensidad = this.clampBrightness(meta.brilloIntensidad ?? 1.0);
      this.objProfundidadProyeccion = this.clampPositive(meta.profundidadProyeccion ?? 0.08, 0.08, 0.01, 1000);
      this.objAnguloProyeccion = this.formatNum(meta.anguloProyeccion ?? 0);
      this.objProyeccionAncho = this.clampPositive(meta.proyeccionAncho ?? this.localEscX, this.localEscX, 0.01, 1000);
      this.objProyeccionAlto = this.clampPositive(meta.proyeccionAlto ?? this.localEscY, this.localEscY, 0.01, 1000);
      
      this.objProyeccionRepeticiones = this.clampPositive(meta.proyeccionRepeticiones ?? 1, 1, 1, 50);
      this.objProyeccionEspaciado = meta.proyeccionEspaciado ?? 2;
      this.objProyeccionEje = meta.proyeccionEje || 'Y';
      
      this.objFadeDistance = Math.max(0, Number(meta.fadeDistance ?? 0));

      if (this.objeto.metadata.decalMaterial) {
        const isBW = this.motor3dSvc.scene.metadata?.globalVisualMode === 'bw';
        const activeColorHex = isBW ? this.objColorBW : this.objColor;
        const decalMat = this.objeto.metadata.decalMaterial as StandardMaterial;
        const tex = (decalMat.diffuseTexture || decalMat.opacityTexture) as any;
        
        this.aplicarMaterialHolograma(decalMat, activeColorHex, this.objBrilloIntensidad, this.objIgnoraNiebla, tex);
      }
    } else {
      this.objEsEmisivo = meta.esEmisivo ?? false;
      this.objBrilloIntensidad = this.clampBrightness(meta.brilloIntensidad ?? 1.0);
    }

    this.objInteractDistanceFPS = meta.interactDistanceFPS ?? 3.0;
    this.objInteractDistanceTPS = meta.interactDistanceTPS ?? 5.0;
    this.objInteractSequenceIdFPS = meta.interactSequenceIdFPS || meta.interactSequenceId || '';
    this.objInteractSequenceIdTPS = meta.interactSequenceIdTPS || meta.interactSequenceId || '';
    this.objMensaje = meta.mensaje || '';

    this.cdr.detectChanges();
  }

  aplicarPosicion() {
    this.historialSvc.registrarCambioTransform(this.objeto, () => {
      this.objeto.position.set(this.localPosX, this.localPosY, this.localPosZ);
    });

    if (this.objeto.metadata?.updateDecal) this.objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  aplicarRotacion() {
    const rx = this.localRotX * (Math.PI / 180);
    const ry = this.localRotY * (Math.PI / 180);
    const rz = this.localRotZ * (Math.PI / 180);

    this.historialSvc.registrarCambioTransform(this.objeto, () => {
      this.objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
      this.objeto.rotation.set(0, 0, 0);
    });

    if (this.objeto.metadata?.updateDecal) this.objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  aplicarEscala() {
    this.historialSvc.registrarCambioTransform(this.objeto, () => {
      this.objeto.scaling.set(this.localEscX, this.localEscY, this.localEscZ);
    });

    if (this.objeto.metadata?.updateDecal) this.objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  aplicarProyeccion() {
    if (!this.objeto.metadata) this.objeto.metadata = {};

    this.objeto.metadata.profundidadProyeccion = this.clampPositive(Number(this.objProfundidadProyeccion), 0.08, 0.01, 1000);
    this.objeto.metadata.anguloProyeccion = Number(this.objAnguloProyeccion);

    this.objeto.metadata.proyeccionAncho = this.clampPositive(Number(this.objProyeccionAncho), 1, 0.01, 1000);
    this.objeto.metadata.proyeccionAlto = this.clampPositive(Number(this.objProyeccionAlto), 1, 0.01, 1000);

    this.objeto.metadata.proyeccionRepeticiones = Math.floor(this.clampPositive(Number(this.objProyeccionRepeticiones), 1, 1, 50));
    this.objeto.metadata.proyeccionEspaciado = Number(this.objProyeccionEspaciado);
    this.objeto.metadata.proyeccionEje = this.objProyeccionEje;

    this.objeto.metadata.fadeDistance = Math.max(0, Number(this.objFadeDistance));

    if (this.objeto.metadata.updateDecal) {
      this.objeto.metadata.updateDecal();
    }

    this.editorSvc.triggerUpdate();
  }

  forzarRecalculo() {
    if (this.objeto && this.objeto.metadata?.updateDecal) {
      this.objeto.metadata.updateDecal();
      this.animStatus = '🎯 Proyección actualizada';
      this.editorSvc.triggerUpdate();
    }
  }

  aplicarVisuales() {
    if (!this.objeto.metadata) this.objeto.metadata = {};

    this.objeto.metadata.color = this.objColor;
    this.objeto.metadata.colorBW = this.objColorBW;
    this.objeto.metadata.ignoraNiebla = this.objIgnoraNiebla;
    this.objeto.metadata.esEmisivo = this.objEsEmisivo;
    this.objeto.metadata.brilloIntensidad = this.clampBrightness(this.objBrilloIntensidad);

    const isBW = this.motor3dSvc.scene.metadata?.globalVisualMode === 'bw';
    const activeColorHex = isBW ? this.objColorBW : this.objColor;

    if (this.objeto.material && this.objeto.material instanceof StandardMaterial) {
      if (this.objeto.metadata.type === 'image_plane') {
        const decalMat = this.objeto.metadata.decalMaterial as StandardMaterial;

        if (decalMat) {
          const tex = (decalMat.diffuseTexture || decalMat.opacityTexture) as any;
          this.aplicarMaterialHolograma(
            decalMat,
            activeColorHex,
            this.objBrilloIntensidad,
            this.objIgnoraNiebla,
            tex
          );
        }

        const decMeshes = this.objeto.metadata.decalMeshes as any[] | undefined;
        if (Array.isArray(decMeshes)) {
          decMeshes.forEach((m) => {
            if (m) m.applyFog = !this.objIgnoraNiebla;
          });
        }
      } else {
        const objMat = this.objeto.material as StandardMaterial;
        const c3 = Color3.FromHexString(activeColorHex);
        const brillo = this.clampBrightness(this.objBrilloIntensidad);

        objMat.diffuseColor = c3;
        objMat.specularColor = new Color3(0, 0, 0);

        if (this.objEsEmisivo) {
          objMat.emissiveColor = c3.scale(brillo);
          objMat.disableLighting = false;
        } else {
          objMat.emissiveColor = new Color3(0, 0, 0);
          objMat.ambientColor = c3.scale(Math.max(0.05, brillo * 0.2));
          objMat.disableLighting = false;
        }
      }
    }

    this.objeto.applyFog = !this.objIgnoraNiebla;
    this.objeto.getChildMeshes().forEach(m => m.applyFog = !this.objIgnoraNiebla);

    this.editorSvc.triggerUpdate();
  }

  private aplicarMaterialHolograma(
    mat: StandardMaterial,
    colorHex: string,
    brilloIntensidad: number,
    ignoraNiebla: boolean,
    texture?: any
  ): void {
    const c3 = Color3.FromHexString(colorHex || '#ffffff');
    const brillo = this.clampBrightness(brilloIntensidad);

    mat.disableLighting = true;
    mat.diffuseColor = c3;
    mat.ambientColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.alphaMode = Engine.ALPHA_COMBINE;
    mat.fogEnabled = !ignoraNiebla;
    
    mat.zOffset = -10; 

    if (texture) {
      texture.hasAlpha = true;
      texture.gammaSpace = true;

      mat.diffuseTexture = texture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.opacityTexture = texture;

      mat.emissiveTexture = null as any;
      mat.emissiveColor = c3.scale(brillo);
      
      mat.alpha = 1.0;
    } else {
      mat.diffuseTexture = null as any;
      mat.opacityTexture = null as any;
      mat.emissiveTexture = null as any;
      mat.useAlphaFromDiffuseTexture = false;

      mat.emissiveColor = c3.scale(brillo);
      mat.alpha = Math.max(0.2, Math.min(1.0, brillo * 0.5));
    }
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