// src/app/components/inspector-escena/inspector-properties/prop-trigger/prop-trigger.ts
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
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
  private entityManager = inject(EntityManagerService);
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

    const entity = this.entityManager.getEntityByMesh(this.objeto);
    
    // 🔥 Ahora tomamos la Entidad como fuente real de la verdad
    if (entity && entity.trigger) {
        this.triggerIsComposite = entity.trigger.isComposite ?? false;
        this.triggerShape = entity.trigger.triggerShape || 'cube';
        this.triggerRepeatable = entity.trigger.isRepeatable || false;

        this.triggerCondition = entity.trigger.condition || 'on_enter';
        this.objMensaje = entity.interaction?.mensaje || entity.trigger.mensaje || '';
        this.objSoundUrl = entity.trigger.soundUrl || '';
        this.triggerTimeNorm = entity.trigger.timeNorm ?? 4.5;
        this.triggerVideoNorm = entity.trigger.videoNorm || '';

        this.triggerConditions = entity.trigger.conditions || ['on_enter'];
        this.triggerMensajeEntrada = entity.trigger.mensajeEntrada || '';
        this.triggerMensajeSalida = entity.trigger.mensajeSalida || '';
        this.triggerSoundEntrada = entity.trigger.soundUrlEntrada || '';
        this.triggerSoundSalida = entity.trigger.soundUrlSalida || '';
        this.triggerSeqEntrada = entity.trigger.seqEntrada || '';
        this.triggerSeqSalida = entity.trigger.seqSalida || '';
        this.triggerTimeEntrada = entity.trigger.timeEntrada ?? 4.5;
        this.triggerTimeSalida = entity.trigger.timeSalida ?? 4.5;
        this.triggerVideoEntrada = entity.trigger.videoEntrada || '';
        this.triggerVideoSalida = entity.trigger.videoSalida || '';
        this.objInteractSequenceIdFPS = entity.trigger.interactSequenceId || '';
    } else {
        // Fallback temporal si se de-sincronizó (No debería pasar nunca)
        const meta = this.objeto.metadata || {};
        this.triggerIsComposite = meta.isComposite ?? false;
        this.triggerShape = meta.triggerShape || 'cube';
        this.triggerRepeatable = meta.isRepeatable || false;
        this.triggerCondition = meta.condition || 'on_enter';
        this.objMensaje = meta.mensaje || '';
        this.objSoundUrl = meta.soundUrl || '';
        this.triggerTimeNorm = meta.timeNorm ?? 4.5;
        this.triggerVideoNorm = meta.videoNorm || '';
    }

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
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity || !entity.trigger) return;

    // 🔥 Guardamos los datos puros y duros directamente en la lógica del Componente
    if (this.triggerIsComposite) {
        entity.trigger.conditions = this.triggerConditions;
        entity.trigger.isRepeatable = this.triggerRepeatable;
        entity.trigger.mensajeEntrada = this.triggerMensajeEntrada.trim();
        entity.trigger.mensajeSalida = this.triggerMensajeSalida.trim();
        entity.trigger.soundUrlEntrada = this.triggerSoundEntrada.trim();
        entity.trigger.soundUrlSalida = this.triggerSoundSalida.trim();
        entity.trigger.seqEntrada = this.triggerSeqEntrada.trim();
        entity.trigger.seqSalida = this.triggerSeqSalida.trim();
        entity.trigger.timeEntrada = this.triggerTimeEntrada;
        entity.trigger.timeSalida = this.triggerTimeSalida;
        entity.trigger.videoEntrada = this.triggerVideoEntrada.trim();
        entity.trigger.videoSalida = this.triggerVideoSalida.trim();
    } else {
        entity.trigger.condition = this.triggerCondition;
        entity.trigger.isRepeatable = this.triggerRepeatable;
        entity.trigger.mensaje = this.objMensaje.trim();
        entity.interaction.mensaje = this.objMensaje.trim(); // Sincro cruzada
        entity.trigger.soundUrl = this.objSoundUrl.trim();
        entity.trigger.interactSequenceId = this.objInteractSequenceIdFPS.trim();
        entity.interaction.interactSequenceId = this.objInteractSequenceIdFPS.trim(); 
        entity.trigger.timeNorm = this.triggerTimeNorm;
        entity.trigger.videoNorm = this.triggerVideoNorm.trim();
    }

    // Le decimos a la entidad que escupa todos los cambios a la malla (metadata) de Babylon.js
    entity.syncToView();

    this.editorSvc.triggerUpdate();
    this.animStatus = '📍 Trigger actualizado y guardado';
  }
}