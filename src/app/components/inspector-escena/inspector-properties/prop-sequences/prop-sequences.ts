// file: src/app/components/inspector-escena/inspector-properties/prop-sequences/prop-sequences.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, AnimationGroup } from '@babylonjs/core';
import { EditorPreviewService } from '../../../../services/editor/editor-preview.service';
import { PlayerClipSequence, mergePlayerConfig } from '../../../../core/engine/models/player-config.model';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../../core/engine/scene/scene-access.token';
import { SequenceMutatorService } from '../../../../services/editor/mutators/sequence-mutator.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
  
const ACTION_ROWS_CHAR = [{ key: 'idle', label: 'Idle / Reposo' }, { key: 'walk', label: 'Walk (Caminar)' }, { key: 'run', label: 'Run (Correr)' }];
const ACTION_ROWS_PROP = [
  { key: 'idle', label: 'Esperar / Pausa' }, { key: 'stopBaked', label: '⏹️ Frenar Animación 3D Nativa' },
  { key: 'procMove', label: '↕️ Mover Objeto' }, { key: 'procRotate', label: '🔄 Rotar Objeto' },
  { key: 'playVideo', label: '▶️ Reproducir Video' }, { key: 'pauseVideo', label: '⏸️ Pausar Video' }, { key: 'stopVideo', label: '⏹️ Detener Video' }
];
const ACTION_ROWS_LIGHT = [
  ...ACTION_ROWS_PROP, 
  { key: 'lightOn', label: '💡 Forzar Encender Luz (100%)' }, 
  { key: 'lightOff', label: '🔌 Forzar Apagar Luz (0%)' }, 
  { key: 'lightPulse', label: '💓 Parpadeo Suave (Pulso Senoidal)' }, 
  { key: 'lightFlicker', label: '⚡ Parpadeo Roto (Flicker)' }
];
 
@Component({
  selector: 'app-prop-sequences',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-sequences.html',
  styleUrls: ['./prop-sequences.css']
}) 
export class PropSequences implements OnInit, OnChanges, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  public previewSvc = inject(EditorPreviewService);
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN); 
  private sequenceMutator = inject(SequenceMutatorService);
  private entityManager = inject(EntityManagerService);

  sequences: PlayerClipSequence[] = [];
  selectedSequenceId: string | null = null;
  actionRows: any[] = [];
  animStatus = '';
  
  availableClips: string[] = [];
  esPersonaje = false;
  esLuz = false;
  esTrigger = false;

  ngOnInit() { this.cargarDatos(); }
  ngOnChanges(changes: SimpleChanges) { if (changes['objeto']) this.cargarDatos(); }
  ngOnDestroy() { this.previewSvc.detenerPreviewSecuencia(); }

  cargarDatos() {
    this.previewSvc.detenerPreviewSecuencia();
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;
    
    this.esPersonaje = !!entity.characterConfig;
    this.esLuz = entity.type?.startsWith('light_') ?? false;
    this.esTrigger = entity.type === 'trigger' || entity.type === 'trigger_compuesto';

    if (this.esPersonaje) this.actionRows = ACTION_ROWS_CHAR;
    else if (this.esLuz) this.actionRows = ACTION_ROWS_LIGHT;
    else this.actionRows = ACTION_ROWS_PROP;
    
    const config = mergePlayerConfig(entity.playerConfig || null);
    this.sequences = Array.isArray(config.sequences) ? JSON.parse(JSON.stringify(config.sequences)) : [];
    if (this.sequences.length > 0 && !this.selectedSequenceId) {
      this.selectedSequenceId = this.sequences[0].id;
    }

    const validTargets = new Set();
    validTargets.add(this.objeto);
    this.objeto.getDescendants(false).forEach(child => validTargets.add(child));

    const rawClips: string[] = [];
    this.motor3dSvc.getScene().animationGroups.forEach((ag: AnimationGroup) => {
      if (ag.targetedAnimations?.some((ta: any) => validTargets.has(ta.target))) {
        rawClips.push(ag.name);
      }
    });

    this.motor3dSvc.getScene().meshes.forEach(m => {
      const checkEnt = this.entityManager.getEntityByMesh(m);
      if (checkEnt && checkEnt.type === 'video_plane') rawClips.push(m.name);
    });
    this.availableClips = [...new Set(rawClips)];
  }

  get currentSequence() { return this.sequences.find(s => s.id === this.selectedSequenceId) || null; }

  persist() {
    this.sequenceMutator.persistirSecuencias(this.objeto, this.sequences);
    this.animStatus = 'Paso guardado';
  }

  nuevaSecuencia() {
    this.selectedSequenceId = this.sequenceMutator.crearNuevaSecuencia(this.objeto, this.sequences, this.esPersonaje, this.availableClips);
  }

  eliminarSecuencia(id: string) {
    this.previewSvc.detenerPreviewSecuencia();
    this.selectedSequenceId = this.sequenceMutator.eliminarSecuencia(this.objeto, this.sequences, id);
  }

  agregarPaso(seq: PlayerClipSequence) { 
    this.sequenceMutator.agregarPaso(this.objeto, seq, this.esPersonaje, this.availableClips);
  }
  
  quitarPaso(seq: PlayerClipSequence, i: number) { 
    this.sequenceMutator.quitarPaso(this.objeto, seq, i); 
  }
  
  moverPaso(seq: PlayerClipSequence, index: number, dir: number) {
    this.sequenceMutator.moverPaso(this.objeto, seq, index, dir);
  }

  probarSecuencia(seq: PlayerClipSequence) {
    if (this.previewSvc.isPlayingPreview()) {
      this.previewSvc.detenerPreviewSecuencia();
      this.animStatus = '⏹️ Previsualización detenida';
      return;
    }

    this.persist();
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity && entity.type !== 'trigger') {
      this.previewSvc.iniciarPreviewSecuencia(entity, seq.id);
      this.animStatus = `▶️ Previsualizando en vivo: ${seq.name}...`;
    }
  }

  copiarId(id: string) { navigator.clipboard.writeText(id); this.animStatus = '✅ ID Copiado'; }
}