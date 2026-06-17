
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
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity || !entity.trigger) return;

    this.localPosX = this.formatNum(entity.transform.position.x); 
    this.localPosY = this.formatNum(entity.transform.position.y); 
    this.localPosZ = this.formatNum(entity.transform.position.z);
    this.localEscX = this.formatNum(entity.transform.scale.x); 
    this.localEscY = this.formatNum(entity.transform.scale.y); 
    this.localEscZ = this.formatNum(entity.transform.scale.z);

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

    this.cdr.detectChanges();
  }

  aplicarPosicion() { 
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    this.historialSvc.registrarCambioTransform(this.objeto, () => { 
      if(entity) {
          entity.transform.position = { x: this.localPosX, y: this.localPosY, z: this.localPosZ };
          entity.syncToView();
      }
    }); 
    this.editorSvc.triggerUpdate(); 
  }

  aplicarEscala() { 
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    this.historialSvc.registrarCambioTransform(this.objeto, () => { 
      if(entity) {
          entity.transform.scale = { x: this.localEscX, y: this.localEscY, z: this.localEscZ };
          entity.syncToView();
      }
    }); 
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
        entity.interaction.mensaje = this.objMensaje.trim(); 
        entity.trigger.soundUrl = this.objSoundUrl.trim();
        entity.trigger.interactSequenceId = this.objInteractSequenceIdFPS.trim();
        entity.interaction.interactSequenceId = this.objInteractSequenceIdFPS.trim(); 
        entity.trigger.timeNorm = this.triggerTimeNorm;
        entity.trigger.videoNorm = this.triggerVideoNorm.trim();
    }

    entity.syncToView();

    this.editorSvc.triggerUpdate();
    this.animStatus = '📍 Trigger actualizado y guardado';
  }
}