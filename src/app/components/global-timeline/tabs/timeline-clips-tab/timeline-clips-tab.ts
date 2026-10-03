// file: src/app/components/global-timeline/tabs/timeline-clips-tab/timeline-clips-tab.ts
import { Component, ChangeDetectorRef, inject, effect, OnDestroy } from '@angular/core';
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
  { key: 'lightOn', label: '💡 Encender Luz (100%)' }, 
  { key: 'lightOff', label: '🔌 Apagar Luz (0%)' }, 
  { key: 'lightPulse', label: '💓 Parpadeo Suave (Pulso Senoidal)' }, 
  { key: 'lightFlicker', label: '⚡ Estroboscópico (Flicker/Roto)' }
];

@Component({
  selector: 'app-timeline-clips-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-clips-tab.html',
  styleUrls: ['./timeline-clips-tab.css']
})
export class TimelineClipsTab implements OnDestroy {
  public stateSvc = inject(EditorStateService);
  public mapaSvc = inject(EditorMapaService);
  public previewSvc = inject(EditorPreviewService);
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

  public currentTimeMs = 0;
  public totalDurationMs = 0;

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

    effect(() => {
      const time = this.previewSvc.currentPreviewTimeMs();
      if (this.previewSvc.isPlayingPreview()) {
        this.currentTimeMs = time;
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    this.previewSvc.detenerPreviewSecuencia();
  }

  cargarClipsDelObjeto() {
    this.previewSvc.detenerPreviewSecuencia();
    const obj = this.stateSvc.objetoSeleccionado() as any;
    const entity = this.entityManager.getEntityByMesh(obj);

    if (!entity) {
      this.sequences = [];
      this.selectedSequenceId = null;
      this.totalDurationMs = 0;
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

    this.recalcularDuracionTotal();

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

  recalcularDuracionTotal() {
    if (this.currentSequence && this.currentSequence.steps) {
      this.totalDurationMs = this.currentSequence.steps.reduce((acc, step) => acc + (step.durationMs || 1000), 0);
    } else {
      this.totalDurationMs = 0;
    }
  }

  seleccionarSecuencia(id: string) {
    this.previewSvc.detenerPreviewSecuencia();
    this.selectedSequenceId = id;
    this.selectedStepIndex = 0;
    this.currentTimeMs = 0;
    this.recalcularDuracionTotal();
  }

  persist() {
    const obj = this.stateSvc.objetoSeleccionado() as any;
    if (!obj) return;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity) {
      if (!entity.playerConfig) entity.playerConfig = cloneDefaultPlayerConfig();
      entity.playerConfig.sequences = JSON.parse(JSON.stringify(this.sequences));
      entity.syncToView();
      this.recalcularDuracionTotal();
      this.mapaSvc.onMapChanged.next();
    }
  }

  nuevaSecuencia() {
    const seq = createPlayerSequence(`Clip ${this.sequences.length + 1}`);
    if (this.esLuz && seq.steps.length > 0) {
      seq.steps[0].action = 'lightPulse';
      seq.steps[0].durationMs = 1500;
    } else if (!this.esPersonaje && seq.steps.length > 0) {
      seq.steps[0].action = 'idle';
      seq.steps[0].loop = true;
    }
    this.sequences.push(seq);
    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = 0;
    this.persist();
  }

  eliminarSecuencia(id: string) {
    this.previewSvc.detenerPreviewSecuencia();
    this.sequences = this.sequences.filter(s => s.id !== id);
    this.selectedSequenceId = this.sequences.length > 0 ? this.sequences[0].id : null;
    this.selectedStepIndex = this.sequences.length > 0 ? 0 : -1;
    this.persist();
  }

  agregarPaso(seq: PlayerClipSequence) { 
    const defaultAction = this.esLuz ? 'lightPulse' : (this.esPersonaje ? 'walk' : 'idle');
    const step = createSequenceStep(defaultAction);
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

  togglePlayPreview(seq: PlayerClipSequence) {
    if (this.previewSvc.isPlayingPreview()) {
      this.previewSvc.pausarPreview();
    } else {
      this.persist();
      const obj = this.stateSvc.objetoSeleccionado() as any;
      const entity = this.entityManager.getEntityByMesh(obj);
      if (entity && entity.type !== 'trigger' && entity.type !== 'trigger_compuesto') {
        this.previewSvc.iniciarPreviewSecuencia(entity, seq.id);
      }
    }
  }

  stopPreview() {
    this.previewSvc.detenerPreviewSecuencia();
    this.currentTimeMs = 0;
  }

  onScrubTime(newTime: number) {
    this.currentTimeMs = Math.max(0, Math.min(newTime, this.totalDurationMs));
    const obj = this.stateSvc.objetoSeleccionado() as any;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity && this.currentSequence) {
      this.previewSvc.seekPreview(entity, this.currentSequence.id, this.currentTimeMs);
    }
  }

  getActionLabel(key: string): string {
    const act = this.actionRows.find(r => r.key === key);
    return act ? act.label : key;
  }
}