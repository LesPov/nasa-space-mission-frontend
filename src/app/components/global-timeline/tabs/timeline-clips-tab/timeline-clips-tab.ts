
import { Component, ChangeDetectorRef, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { EditorPreviewService } from '../../../../services/editor/editor-preview.service';
import { PlayerClipSequence, createPlayerSequence, createSequenceStep, cloneDefaultPlayerConfig, mergePlayerConfig } from '../../../../core/engine/models/player-config.model';

const ACTION_ROWS_CHAR = [
  { key: 'idle', label: '🧍 Idle / Reposo' }, 
  { key: 'walk', label: '🚶 Walk (Caminar)' }, 
  { key: 'run', label: '🏃 Run (Correr)' }
];
const ACTION_ROWS_PROP = [
  { key: 'idle', label: '⏳ Esperar / Pausa / Tiempo' },
  { key: 'stopBaked', label: '⏹️ Frenar Animación Nativa (GLB)' },
  { key: 'procMove', label: '↕️ Mover (Transformación)' },
  { key: 'procRotate', label: '🔄 Rotar (Transformación)' },
  { key: 'playVideo', label: '▶️ Play Video (TV)' },
  { key: 'pauseVideo', label: '⏸️ Pausa Video (TV)' },
  { key: 'stopVideo', label: '⏹️ Stop Video (TV)' }
];
const ACTION_ROWS_LIGHT = [
  ...ACTION_ROWS_PROP,
  { key: 'lightOn', label: '💡 Encender Luz al 100%' }, 
  { key: 'lightOff', label: '🔌 Apagar Luz' }, 
  { key: 'lightPulse', label: '💓 Parpadeo Suave (Pulso)' }, 
  { key: 'lightFlicker', label: '⚡ Estroboscópico (Roto)' }
];

@Component({
  selector: 'app-timeline-clips-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-clips-tab.html',
  styleUrls: ['./timeline-clips-tab.css']
})
export class TimelineClipsTab {
  public stateSvc = inject(EditorStateService);
  public mapaSvc = inject(EditorMapaService);
  private previewSvc = inject(EditorPreviewService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  public currentObjectId: string | null = null;
  public sequences: PlayerClipSequence[] = [];
  public selectedSequenceId: string | null = null;
  public selectedStepIndex: number = -1;
  public actionRows: any[] = [];
  public availableClips: string[] = [];
  public esPersonaje = false;
  public esLuz = false;
  public esTrigger = false;

  constructor() {
    effect(() => {
      const obj = this.stateSvc.objetoSeleccionado() as any;
      const entity = this.entityManager.getEntityByMesh(obj);
      const objId = entity ? entity.uid : null;
      
      if (this.currentObjectId !== objId) {
          this.currentObjectId = objId;
          this.cargarClipsDelObjeto();
      }
    });
  }

  cargarClipsDelObjeto() {
    const obj = this.stateSvc.objetoSeleccionado() as any;
    const entity = this.entityManager.getEntityByMesh(obj);

    if (!entity) {
      this.sequences = [];
      this.selectedSequenceId = null;
      return;
    }
    
    this.esPersonaje = !!entity.characterConfig;
    this.esLuz = entity.type?.startsWith('light_') ?? false;
    this.esTrigger = entity.type === 'trigger' || entity.type === 'trigger_compuesto';

    if (this.esPersonaje) this.actionRows = ACTION_ROWS_CHAR;
    else if (this.esLuz) this.actionRows = ACTION_ROWS_LIGHT;
    else this.actionRows = ACTION_ROWS_PROP;
    
    const config = mergePlayerConfig(entity.playerConfig || null);
    this.sequences = Array.isArray(config.sequences) ? JSON.parse(JSON.stringify(config.sequences)) : [];
    
    if (this.sequences.length > 0 && (!this.selectedSequenceId || !this.sequences.find(s => s.id === this.selectedSequenceId))) {
      this.selectedSequenceId = this.sequences[0].id;
      this.selectedStepIndex = 0;
    } else if (this.sequences.length === 0) {
      this.selectedSequenceId = null;
      this.selectedStepIndex = -1;
    }

    const rawClips: string[] = [];
    if (entity.animationNames && Array.isArray(entity.animationNames)) rawClips.push(...entity.animationNames);

    this.entityManager.getAllEntities().forEach(testEnt => {
        if (testEnt && testEnt.type === 'video_plane') rawClips.push(testEnt.name);
    });

    this.availableClips = [...new Set(rawClips)];
    this.cdr.detectChanges();
  }

  get currentSequence() { return this.sequences.find(s => s.id === this.selectedSequenceId) || null; }
  get currentStep() { return this.currentSequence?.steps[this.selectedStepIndex] || null; }

  seleccionarSecuencia(id: string) {
    this.selectedSequenceId = id;
    this.selectedStepIndex = 0;
  }

  persist() {
    const obj = this.stateSvc.objetoSeleccionado() as any;
    if (!obj) return;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity) {
        if (!entity.playerConfig) entity.playerConfig = cloneDefaultPlayerConfig();
        entity.playerConfig.sequences = JSON.parse(JSON.stringify(this.sequences));
        entity.syncToView();
        this.mapaSvc.onMapChanged.next();
    }
  }

  nuevaSecuencia() {
    const seq = createPlayerSequence(`Clip Cinemático ${this.sequences.length + 1}`);
    if (!this.esPersonaje && seq.steps.length > 0) {
        seq.steps[0].action = 'idle';
        seq.steps[0].loop = true;
    }
    this.sequences.push(seq);
    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = 0;
    this.persist();
  }

  eliminarSecuencia(id: string) {
    this.sequences = this.sequences.filter(s => s.id !== id);
    this.selectedSequenceId = this.sequences.length > 0 ? this.sequences[0].id : null;
    this.selectedStepIndex = this.sequences.length > 0 ? 0 : -1;
    this.persist();
  }

  agregarPaso(seq: PlayerClipSequence) { 
    const step = createSequenceStep(this.esPersonaje ? 'walk' : 'idle');
    if (!this.esPersonaje) {
        step.loop = true; 
        if (this.availableClips.length > 0) step.clipOverride = this.availableClips[0];
    }
    seq.steps.push(step); 
    this.selectedStepIndex = seq.steps.length - 1;
    this.persist(); 
  }
  
  quitarPaso(seq: PlayerClipSequence, i: number) { 
    seq.steps.splice(i, 1); 
    if (this.selectedStepIndex >= seq.steps.length) this.selectedStepIndex = Math.max(0, seq.steps.length - 1);
    this.persist(); 
  }

  probarSecuencia(seq: PlayerClipSequence) {
    this.persist();
    const obj = this.stateSvc.objetoSeleccionado() as any;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity && entity.type !== 'trigger' && entity.type !== 'trigger_compuesto') {
        this.previewSvc.iniciarPreviewSecuencia(entity, seq.id);
    }
  }

  getActionLabel(key: string): string {
    const act = this.actionRows.find(r => r.key === key);
    return act ? act.label : key;
  }
}