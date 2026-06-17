
import { Component, Input, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, AnimationGroup } from '@babylonjs/core';
import { EditorPreviewService } from '../../../../services/editor/editor-preview.service';
import { PlayerClipSequence, mergePlayerConfig } from '../../../../services/editor/player-config.model';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { SequenceMutatorService } from '../../../../services/editor/mutators/sequence-mutator.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
  
const ACTION_ROWS_CHAR = [{ key: 'idle', label: 'Idle / Reposo' }, { key: 'walk', label: 'Walk (Caminar)' }, { key: 'run', label: 'Run (Correr)' }];
const ACTION_ROWS_PROP = [
  { key: 'idle', label: 'Esperar / Pausa' }, { key: 'stopBaked', label: '⏹️ Frenar Animación 3D Nativa' },
  { key: 'procMove', label: '↕️ Mover Objeto' }, { key: 'procRotate', label: '🔄 Rotar Objeto' },
  { key: 'playVideo', label: '▶️ Reproducir Video' }, { key: 'pauseVideo', label: '⏸️ Pausar Video' }, { key: 'stopVideo', label: '⏹️ Detener Video' }
];
const ACTION_ROWS_LIGHT = [...ACTION_ROWS_PROP, { key: 'lightOn', label: '💡 Forzar Encender Luz' }, { key: 'lightOff', label: '🔌 Forzar Apagar Luz' }, { key: 'lightPulse', label: '💓 Parpadeo Suave' }, { key: 'lightFlicker', label: '⚡ Parpadeo Roto' }];
 
@Component({
  selector: 'app-prop-sequences',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-sequences.html',
  styleUrls: ['../inspector-properties.css']
}) 
export class PropSequences implements OnInit, OnChanges {
  @Input() objeto!: AbstractMesh;
  
  private previewSvc = inject(EditorPreviewService);
  private motor3dSvc = inject(Motor3dService); 
  private sequenceMutator = inject(SequenceMutatorService);
  private entityManager = inject(EntityManagerService);

  sequences: PlayerClipSequence[] = [];
  selectedSequenceId: string | null = null;
  actionRows: any[] = [];
  animStatus = '';
  
  availableClips: string[] = [];
  esPersonaje = false;
  esLuz = false;

  ngOnInit() { this.cargarDatos(); }
  ngOnChanges(changes: SimpleChanges) { if (changes['objeto']) this.cargarDatos(); }

  cargarDatos() {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;
    
    this.esPersonaje = entity.rol === 'npc' || entity.rol === 'spawn_point';
    this.esLuz = entity.type.startsWith('light_');

    if (this.esPersonaje) this.actionRows = ACTION_ROWS_CHAR;
    else if (this.esLuz) this.actionRows = ACTION_ROWS_LIGHT;
    else this.actionRows = ACTION_ROWS_PROP;
    
    const config = mergePlayerConfig(entity.playerConfig || null);
    this.sequences = Array.isArray(config.sequences) ? JSON.parse(JSON.stringify(config.sequences)) : [];
    if (this.sequences.length > 0) this.selectedSequenceId = this.sequences[0].id;

    const validTargets = new Set();
    validTargets.add(this.objeto);
    this.objeto.getDescendants(false).forEach(child => validTargets.add(child));

    const rawClips: string[] = [];
    this.motor3dSvc.scene.animationGroups.forEach((ag: AnimationGroup) => {
        if (ag.targetedAnimations?.some((ta: any) => validTargets.has(ta.target))) {
            rawClips.push(ag.name);
        }
    });

    this.motor3dSvc.scene.meshes.forEach(m => {
        const checkEnt = this.entityManager.getEntityByMesh(m);
        if (checkEnt && checkEnt.type === 'video_plane') rawClips.push(m.name);
    });
    this.availableClips = [...new Set(rawClips)];
  }

  get currentSequence() { return this.sequences.find(s => s.id === this.selectedSequenceId) || null; }

  // --- DELEGACIÓN ---
  persist() {
    this.sequenceMutator.persistirSecuencias(this.objeto, this.sequences);
    this.animStatus = 'Paso guardado';
  }

  nuevaSecuencia() {
    this.selectedSequenceId = this.sequenceMutator.crearNuevaSecuencia(this.objeto, this.sequences, this.esPersonaje, this.availableClips);
  }

  eliminarSecuencia(id: string) {
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
    this.persist();
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if(entity && entity.type !== 'trigger'){
        this.previewSvc.iniciarPreviewSecuencia(entity, seq.id);
        this.animStatus = `Visualizando: ${seq.name}...`;
    }
  }

  copiarId(id: string) { navigator.clipboard.writeText(id); this.animStatus = '✅ ID Copiado'; }
}