

import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Color3, Engine, StandardMaterial, Texture, Vector3, Quaternion, Mesh, Matrix } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { auditTime } from 'rxjs/operators';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { EditorLiveSyncService } from '../../../../services/editor/editor-live-sync.service';

@Component({
  selector: 'app-prop-transform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-transform.html', 
  styleUrls: ['./prop-transform.css'] 
})
export class PropTransform implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;

  private editorSvc = inject(EditorMapaService);
  private transformMutator = inject(TransformMutatorService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private liveSync = inject(EditorLiveSyncService);
  private subs: Subscription[] = [];

  public accordions: Record<string, boolean> = {
    transform: true,
    projection: true,
    visuals: true,
    interaction: false
  };

  // 🔥 NUEVO ESTADO DE PRESENTACIÓN (UI Toggle)
  public transformViewMode: 'LOCAL' | 'WORLD' = 'LOCAL';
  private lastUid = '';

  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  worldPosX = 0; worldPosY = 0; worldPosZ = 0;
  worldRotX = 0; worldRotY = 0; worldRotZ = 0;
  worldEscX = 1; worldEscY = 1; worldEscZ = 1; // 🔥 NUEVO SCALE WORLD

  mostrarSeccionColor = false;
  esImagePlane = false;
  esTrigger = false;
  esBubble = false;

  objColor = '#ffffff';
  objColorBW = '#ffffff';
  objAmbientColor = '#ffffff';
  objAmbientColorBW = '#ffffff';
  
  objIgnoraNiebla = false;
  objEsEmisivo = false;
  objBrilloIntensidad = 1.0;
  
  objMostrarBorde = true; 
  objEsSeleccionable = true; 
  objDisableCulling = false; // 🔥 NUEVO FASE CULLING

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

  get isWorldSpace(): boolean {
    if (!this.objeto) return true;
    const ent = this.entityManager.getEntityByMesh(this.objeto);
    if (ent && ent.transformSpace === 'WORLD') return true;
    return !this.objeto.parent;
  }

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.pipe(auditTime(100)).subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.pipe(auditTime(100)).subscribe(() => this.syncData())
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) this.syncData();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  toggleAcordeon(key: string) {
    this.accordions[key] = !this.accordions[key];
  }

  private formatNum(val: number): number {
    return parseFloat(Number(val || 0).toFixed(4));
  }

  syncData() {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    // 🔥 SMART TOGGLE: Si cambiamos a una luz, force WORLD. Si no, conservar elección.
    if (this.lastUid !== entity.uid) {
        this.lastUid = entity.uid;
        if (entity.type.startsWith('light_')) {
            this.transformViewMode = 'WORLD';
        }
    }

    this.localPosX = this.formatNum(entity.transform.position.x);
    this.localPosY = this.formatNum(entity.transform.position.y);
    this.localPosZ = this.formatNum(entity.transform.position.z);

    if (entity.transform.rotationQuaternion) {
        const q = new Quaternion(
            entity.transform.rotationQuaternion.x, 
            entity.transform.rotationQuaternion.y, 
            entity.transform.rotationQuaternion.z, 
            entity.transform.rotationQuaternion.w
        );
        const euler = q.toEulerAngles();
        this.localRotX = this.formatNum(euler.x * (180 / Math.PI));
        this.localRotY = this.formatNum(euler.y * (180 / Math.PI));
        this.localRotZ = this.formatNum(euler.z * (180 / Math.PI));
    } else {
        this.localRotX = this.formatNum(entity.transform.rotation.x * (180 / Math.PI));
        this.localRotY = this.formatNum(entity.transform.rotation.y * (180 / Math.PI));
        this.localRotZ = this.formatNum(entity.transform.rotation.z * (180 / Math.PI));
    }

    this.localEscX = this.formatNum(entity.transform.scale.x);
    this.localEscY = this.formatNum(entity.transform.scale.y);
    this.localEscZ = this.formatNum(entity.transform.scale.z);

    // Cálculos Mundiales (World) absolutos
    this.objeto.computeWorldMatrix(true);
    const absScale = new Vector3();
    const absRot = new Quaternion();
    const absPos = new Vector3();
    this.objeto.getWorldMatrix().decompose(absScale, absRot, absPos);

    this.worldPosX = this.formatNum(absPos.x);
    this.worldPosY = this.formatNum(absPos.y);
    this.worldPosZ = this.formatNum(absPos.z);
    
    const euler = absRot.toEulerAngles();
    this.worldRotX = this.formatNum(euler.x * (180 / Math.PI));
    this.worldRotY = this.formatNum(euler.y * (180 / Math.PI));
    this.worldRotZ = this.formatNum(euler.z * (180 / Math.PI));

    this.worldEscX = this.formatNum(absScale.x);
    this.worldEscY = this.formatNum(absScale.y);
    this.worldEscZ = this.formatNum(absScale.z);

    const hasAsset = !!entity.visual.assetId || !!entity.visual.path;
    this.mostrarSeccionColor = ['cube', 'sphere', 'cylinder', 'plane', 'image_plane', 'model'].includes(entity.type) || (entity.type.startsWith('light_') && hasAsset);
    
    this.esImagePlane = entity.type === 'image_plane';
    this.esTrigger = entity.type === 'trigger' || entity.type === 'trigger_compuesto';
    this.esBubble = entity.type === 'bubble';
    
    if (this.esImagePlane) this.accordions['projection'] = true;

    this.objColor = entity.visual.color || '#ffffff';
    this.objColorBW = entity.visual.colorBW || this.objColor;
    
    this.objAmbientColor = entity.visual.ambientColor || '#ffffff';
    this.objAmbientColorBW = entity.visual.ambientColorBW || this.objAmbientColor;
    
    this.objIgnoraNiebla = entity.visual.ignoraNiebla ?? false;
    this.objEsEmisivo = entity.visual.esEmisivo ?? false;
    this.objBrilloIntensidad = entity.visual.brilloIntensidad ?? 1.0;
    
    this.objMostrarBorde = entity.visual.mostrarBorde ?? (entity.type !== 'plane'); 
    this.objEsSeleccionable = entity.visual.isSelectable ?? true; 
    
    // 🔥 NUEVO FASE CULLING
    this.objDisableCulling = entity.visual.disableCulling ?? false;

    if (entity.media) {
      this.objProfundidadProyeccion = entity.media.profundidadProyeccion ?? 0.08;
      this.objAnguloProyeccion = this.formatNum(entity.media.anguloProyeccion ?? 0);
      this.objProyeccionAncho = entity.media.proyeccionAncho ?? this.localEscX;
      this.objProyeccionAlto = entity.media.proyeccionAlto ?? this.localEscY;
      this.objProyeccionRepeticiones = entity.media.proyeccionRepeticiones ?? 1;
      this.objProyeccionEspaciado = entity.media.proyeccionEspaciado ?? 2;
      this.objProyeccionEje = entity.media.proyeccionEje || 'Y';
      this.objFadeDistance = entity.media.fadeDistance ?? 0;
    }

    this.objInteractDistanceFPS = entity.interaction.interactDistanceFPS ?? 3.0;
    this.objInteractDistanceTPS = entity.interaction.interactDistanceTPS ?? 5.0;
    this.objInteractSequenceIdFPS = entity.interaction.interactSequenceIdFPS || entity.interaction.interactSequenceId || '';
    this.objInteractSequenceIdTPS = entity.interaction.interactSequenceIdTPS || entity.interaction.interactSequenceId || '';
    this.objMensaje = entity.interaction.mensaje || '';

    this.cdr.detectChanges();
  }

  private broadcastLive() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity) {
       this.liveSync.broadcastLiveTransform(entity, this.objeto);
    }
  }

  aplicarPosicion() {
    this.transformMutator.aplicarPosicion(this.objeto, { x: this.localPosX, y: this.localPosY, z: this.localPosZ });
    this.broadcastLive();
  }

  aplicarRotacion() {
    this.transformMutator.aplicarRotacion(this.objeto, { x: this.localRotX, y: this.localRotY, z: this.localRotZ });
    this.broadcastLive();
  }

  aplicarEscala() {
    this.transformMutator.aplicarEscala(this.objeto, { x: this.localEscX, y: this.localEscY, z: this.localEscZ });
    this.broadcastLive();
  }

  aplicarWorldPosicion() {
      if (!this.objeto) return;
      const worldPos = new Vector3(this.worldPosX, this.worldPosY, this.worldPosZ);
      if (this.objeto.parent) {
          this.objeto.parent.computeWorldMatrix(true);
          const invParent = Matrix.Invert(this.objeto.parent.getWorldMatrix());
          const localPos = Vector3.TransformCoordinates(worldPos, invParent);
          this.localPosX = this.formatNum(localPos.x);
          this.localPosY = this.formatNum(localPos.y);
          this.localPosZ = this.formatNum(localPos.z);
      } else {
          this.localPosX = this.worldPosX;
          this.localPosY = this.worldPosY;
          this.localPosZ = this.worldPosZ;
      }
      this.aplicarPosicion();
  }

  aplicarWorldRotacion() {
      if (!this.objeto) return;
      const worldRotEuler = new Vector3(this.worldRotX * Math.PI/180, this.worldRotY * Math.PI/180, this.worldRotZ * Math.PI/180);
      const worldQuat = Quaternion.FromEulerAngles(worldRotEuler.x, worldRotEuler.y, worldRotEuler.z);
      
      if (this.objeto.parent) {
          const parentRotMat = this.objeto.parent.getWorldMatrix().getRotationMatrix();
          const parentQuat = Quaternion.FromRotationMatrix(parentRotMat);
          parentQuat.invertInPlace();
          
          const localQuat = parentQuat.multiply(worldQuat);
          const localEuler = localQuat.toEulerAngles();
          
          this.localRotX = this.formatNum(localEuler.x * 180/Math.PI);
          this.localRotY = this.formatNum(localEuler.y * 180/Math.PI);
          this.localRotZ = this.formatNum(localEuler.z * 180/Math.PI);
      } else {
          this.localRotX = this.worldRotX;
          this.localRotY = this.worldRotY;
          this.localRotZ = this.worldRotZ;
      }
      this.aplicarRotacion();
  }

  // 🔥 NUEVO MÉTODO PARA CALCULAR LA ESCALA MUNDIAL
  aplicarWorldEscala() {
      if (!this.objeto) return;
      const worldScale = new Vector3(this.worldEscX, this.worldEscY, this.worldEscZ);
      
      if (this.objeto.parent) {
          this.objeto.parent.computeWorldMatrix(true);
          const parentScale = new Vector3();
          this.objeto.parent.getWorldMatrix().decompose(parentScale);
          
          const safeX = parentScale.x !== 0 ? parentScale.x : 1;
          const safeY = parentScale.y !== 0 ? parentScale.y : 1;
          const safeZ = parentScale.z !== 0 ? parentScale.z : 1;

          this.localEscX = this.formatNum(worldScale.x / safeX);
          this.localEscY = this.formatNum(worldScale.y / safeY);
          this.localEscZ = this.formatNum(worldScale.z / safeZ);
      } else {
          this.localEscX = this.worldEscX;
          this.localEscY = this.worldEscY;
          this.localEscZ = this.worldEscZ;
      }
      this.aplicarEscala();
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
      color: this.objColor, colorBW: this.objColorBW, 
      ambientColor: this.objAmbientColor, ambientColorBW: this.objAmbientColorBW,
      ignoraNiebla: this.objIgnoraNiebla, esEmisivo: this.objEsEmisivo, brilloIntensidad: this.objBrilloIntensidad,
      mostrarBorde: this.objMostrarBorde, isSelectable: this.objEsSeleccionable,
      disableCulling: this.objDisableCulling // 🔥 FASE CULLING
    });
  }

  aplicarInteraccion() {
    this.transformMutator.aplicarInteraccion(this.objeto, {
      interactDistanceFPS: this.objInteractDistanceFPS, interactDistanceTPS: this.objInteractDistanceTPS,
      interactSequenceIdFPS: this.objInteractSequenceIdFPS, interactSequenceIdTPS: this.objInteractSequenceIdTPS,
      mensaje: this.objMensaje
    });
    this.animStatus = '✅ Interacción guardada';
    setTimeout(() => this.animStatus = '', 2000);
  }

  forzarRecalculoProyeccion() {
    this.transformMutator.forzarRecalculoProyeccion(this.objeto);
    this.animStatus = '🎯 Proyección actualizada';
    setTimeout(() => this.animStatus = '', 2000);
  }
}