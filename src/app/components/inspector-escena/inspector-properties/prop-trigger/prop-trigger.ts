
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Quaternion, Vector3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorSceneService } from '../../../../services/editor/editor-scene.service';
import { HistorialService } from '../../../../services/historial.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
 
@Component({
  selector: 'app-prop-trigger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-trigger.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropTrigger implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private sceneSvc = inject(EditorSceneService);
  private historialSvc = inject(HistorialService);
  private entityManager = inject(EntityManagerService); // 🔥 Inyectado
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  localPosX = 0; localPosY = 0; localPosZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  triggerIsComposite = false;
  triggerShape = 'cube';
  triggerRepeatable = false;
  
  triggerConditions: string[] = ['on_enter'];
  triggerMensajeEntrada = ''; triggerMensajeSalida = '';
  triggerSoundEntrada = ''; triggerSoundSalida = '';
  triggerSeqEntrada = ''; triggerSeqSalida = '';
  triggerTimeEntrada = 4.5; triggerTimeSalida = 4.5;
  triggerVideoEntrada = ''; triggerVideoSalida = '';

  triggerCondition = 'on_enter';
  objMensaje = ''; objSoundUrl = '';
  objInteractSequenceIdFPS = ''; triggerTimeNorm = 4.5; triggerVideoNorm = '';
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
    this.localEscX = this.formatNum(this.objeto.scaling.x); 
    this.localEscY = this.formatNum(this.objeto.scaling.y); 
    this.localEscZ = this.formatNum(this.objeto.scaling.z);

    const meta = this.objeto.metadata || {};
    this.triggerIsComposite = meta.isComposite ?? false;
    this.triggerShape = meta.triggerShape || 'cube';
    this.triggerRepeatable = meta.isRepeatable || false;

    this.triggerCondition = meta.condition || 'on_enter';
    this.objMensaje = meta.mensaje || '';
    this.objSoundUrl = meta.soundUrl || '';
    this.triggerTimeNorm = meta.timeNorm ?? 4.5;
    this.triggerVideoNorm = meta.videoNorm || '';

    this.triggerConditions = meta.conditions || ['on_enter'];
    this.triggerMensajeEntrada = meta.mensajeEntrada || '';
    this.triggerMensajeSalida = meta.mensajeSalida || '';
    this.triggerSoundEntrada = meta.soundUrlEntrada || '';
    this.triggerSoundSalida = meta.soundUrlSalida || '';
    this.triggerSeqEntrada = meta.seqEntrada || '';
    this.triggerSeqSalida = meta.seqSalida || '';
    this.triggerTimeEntrada = meta.timeEntrada ?? 4.5;
    this.triggerTimeSalida = meta.timeSalida ?? 4.5;
    this.triggerVideoEntrada = meta.videoEntrada || '';
    this.triggerVideoSalida = meta.videoSalida || '';
    this.objInteractSequenceIdFPS = meta.interactSequenceId || '';

    this.cdr.detectChanges();
  }

  aplicarPosicion() { 
    this.historialSvc.registrarCambioTransform(this.objeto, () => { this.objeto.position.set(this.localPosX, this.localPosY, this.localPosZ); }); 
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity) {
       entity.syncTransformFromView();
       entity.syncToView();
    }
    this.editorSvc.triggerUpdate(); 
  }

  aplicarEscala() { 
    this.historialSvc.registrarCambioTransform(this.objeto, () => { this.objeto.scaling.set(this.localEscX, this.localEscY, this.localEscZ); }); 
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity) {
       entity.syncTransformFromView();
       entity.syncToView();
    }
    this.editorSvc.triggerUpdate(); 
  }

  toggleTriggerCondition(cond: string, event: any) {
    if (event.target.checked) {
        if (!this.triggerConditions.includes(cond)) this.triggerConditions.push(cond);
    } else {
        this.triggerConditions = this.triggerConditions.filter(c => c !== cond);
    }
    this.aplicarTrigger();
  }

  aplicarTriggerForma(nuevaForma: string) {
    this.sceneSvc.reconstruirMallaTrigger(this.objeto, nuevaForma);
    this.animStatus = '📍 Forma actualizada';
  }

  aplicarTrigger() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    const meta = this.objeto.metadata;
    if (this.triggerIsComposite) {
        meta.conditions = this.triggerConditions;
        meta.isRepeatable = this.triggerRepeatable;
        meta.mensajeEntrada = this.triggerMensajeEntrada.trim();
        meta.mensajeSalida = this.triggerMensajeSalida.trim();
        meta.soundUrlEntrada = this.triggerSoundEntrada.trim();
        meta.soundUrlSalida = this.triggerSoundSalida.trim();
        meta.seqEntrada = this.triggerSeqEntrada.trim();
        meta.seqSalida = this.triggerSeqSalida.trim();
        meta.timeEntrada = this.triggerTimeEntrada;
        meta.timeSalida = this.triggerTimeSalida;
        meta.videoEntrada = this.triggerVideoEntrada.trim();
        meta.videoSalida = this.triggerVideoSalida.trim();
    } else {
        meta.condition = this.triggerCondition;
        meta.isRepeatable = this.triggerRepeatable;
        meta.mensaje = this.objMensaje.trim();
        meta.soundUrl = this.objSoundUrl.trim();
        meta.interactSequenceId = this.objInteractSequenceIdFPS.trim();
        meta.timeNorm = this.triggerTimeNorm;
        meta.videoNorm = this.triggerVideoNorm.trim();
    }

    // 🔥 Sincronizar hacia la Entidad
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity) {
      entity.syncFromMetadata(); // Absorbe los cambios del JSON
    }

    this.editorSvc.triggerUpdate();
    this.animStatus = '📍 Trigger actualizado y guardado';
  }
}