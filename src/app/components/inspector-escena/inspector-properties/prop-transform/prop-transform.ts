

import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { WindowSyncService } from '../../../../core/services/window-sync.service';

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
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private windowSync = inject(WindowSyncService);
  private subs: Subscription[] = [];

  // Data bindings
  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  mostrarSeccionColor = false;
  esImagePlane = false;
  esTrigger = false;
  esBubble = false;

  objColor = '#ffffff';
  objColorBW = '#ffffff';
  objIgnoraNiebla = false;
  objEsEmisivo = false;
  objBrilloIntensidad = 1.0;
  
  // 🔥 Variables para manejar la Interfaz y guardar estado
  objMostrarBorde = true; 
  objEsSeleccionable = true; 

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
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    this.localPosX = this.formatNum(entity.transform.position.x);
    this.localPosY = this.formatNum(entity.transform.position.y);
    this.localPosZ = this.formatNum(entity.transform.position.z);

    this.localRotX = this.formatNum(entity.transform.rotation.x * (180 / Math.PI));
    this.localRotY = this.formatNum(entity.transform.rotation.y * (180 / Math.PI));
    this.localRotZ = this.formatNum(entity.transform.rotation.z * (180 / Math.PI));

    this.localEscX = this.formatNum(entity.transform.scale.x);
    this.localEscY = this.formatNum(entity.transform.scale.y);
    this.localEscZ = this.formatNum(entity.transform.scale.z);

    this.mostrarSeccionColor = ['cube', 'sphere', 'cylinder', 'plane', 'image_plane'].includes(entity.type);
    this.esImagePlane = entity.type === 'image_plane';
    this.esTrigger = entity.type === 'trigger' || entity.type === 'trigger_compuesto';
    this.esBubble = entity.type === 'bubble';
    
    this.objColor = entity.visual.color || '#ffffff';
    this.objColorBW = entity.visual.colorBW || this.objColor;
    this.objIgnoraNiebla = entity.visual.ignoraNiebla ?? false;
    this.objEsEmisivo = entity.visual.esEmisivo ?? false;
    this.objBrilloIntensidad = entity.visual.brilloIntensidad ?? 1.0;
    
    // Sincronización de las casillas en la UI
    this.objMostrarBorde = entity.visual.mostrarBorde ?? (entity.type !== 'plane'); 
    this.objEsSeleccionable = entity.visual.isSelectable ?? true; 

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
       this.windowSync.broadcast({
         type: 'SYNC_TRANSFORM_LIVE',
         payload: {
           uid: entity.uid,
           position: { x: this.objeto.position.x, y: this.objeto.position.y, z: this.objeto.position.z },
           rotation: { x: this.objeto.rotation.x, y: this.objeto.rotation.y, z: this.objeto.rotation.z },
           rotationQuaternion: this.objeto.rotationQuaternion ? { x: this.objeto.rotationQuaternion.x, y: this.objeto.rotationQuaternion.y, z: this.objeto.rotationQuaternion.z, w: this.objeto.rotationQuaternion.w } : null,
           scaling: { x: this.objeto.scaling.x, y: this.objeto.scaling.y, z: this.objeto.scaling.z }
         }
       });
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
      esEmisivo: this.objEsEmisivo, brilloIntensidad: this.objBrilloIntensidad,
      mostrarBorde: this.objMostrarBorde, // 🔥 Propagamos el booleano
      isSelectable: this.objEsSeleccionable // 🔥 Propagamos el booleano
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
