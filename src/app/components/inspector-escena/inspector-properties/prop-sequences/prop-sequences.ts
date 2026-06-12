import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorPlayerService } from '../../../../services/editor/editor-player.service';
import { PlayerClipSequence, mergePlayerConfig, cloneDefaultPlayerConfig, createPlayerSequence, createSequenceStep } from '../../../../services/editor/player-config.model';
 
const ACTION_ROWS = [
  { key: 'idle', label: 'Idle' }, { key: 'walk', label: 'Walk' }, { key: 'run', label: 'Run' },
  { key: 'jumpStart', label: 'Jump Start' }, { key: 'jumpLoop', label: 'Jump Loop' },
  { key: 'fall', label: 'Fall' }, { key: 'landHard', label: 'Land Hard' },
  { key: 'climbUp', label: 'Climb Up' }, { key: 'climbFinish', label: 'Climb Finish' }
];

@Component({
  selector: 'app-prop-sequences',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-sequences.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropSequences implements OnInit {
  @Input() objeto!: AbstractMesh;
  private editorSvc = inject(EditorMapaService);
  private playerSvc = inject(EditorPlayerService);

  sequences: PlayerClipSequence[] = [];
  selectedSequenceId: string | null = null;
  actionRows = ACTION_ROWS;
  animStatus = '';

  ngOnInit() {
    const meta = this.objeto.metadata || {};
    const config = mergePlayerConfig(meta.playerConfig || null);
    this.sequences = Array.isArray(config.sequences) ? JSON.parse(JSON.stringify(config.sequences)) : [];
    if (this.sequences.length > 0) this.selectedSequenceId = this.sequences[0].id;
  }

  get currentSequence() { return this.sequences.find(s => s.id === this.selectedSequenceId) || null; }

  persist() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    if (!this.objeto.metadata.playerConfig) this.objeto.metadata.playerConfig = cloneDefaultPlayerConfig();
    this.objeto.metadata.playerConfig.sequences = JSON.parse(JSON.stringify(this.sequences));
    this.editorSvc.triggerUpdate();
    this.animStatus = 'Paso guardado';
  }

  nuevaSecuencia() {
    const seq = createPlayerSequence(`Seq ${this.sequences.length + 1}`);
    this.sequences.push(seq);
    this.selectedSequenceId = seq.id;
    this.persist();
  }

  eliminarSecuencia(id: string) {
    this.sequences = this.sequences.filter(s => s.id !== id);
    this.selectedSequenceId = this.sequences.length > 0 ? this.sequences[0].id : null;
    this.persist();
  }

  agregarPaso(seq: PlayerClipSequence) { seq.steps.push(createSequenceStep('walk')); this.persist(); }
  quitarPaso(seq: PlayerClipSequence, i: number) { seq.steps.splice(i, 1); this.persist(); }
  
  moverPaso(seq: PlayerClipSequence, index: number, dir: number) {
    const target = index + dir;
    if (target < 0 || target >= seq.steps.length) return;
    const arr = [...seq.steps]; const [item] = arr.splice(index, 1); arr.splice(target, 0, item);
    seq.steps = arr; this.persist();
  }

  probarSecuencia(seq: PlayerClipSequence) {
    this.persist();
    if(this.objeto.metadata.type !== 'trigger'){
        this.playerSvc.iniciarPreviewSecuencia(this.objeto, seq.id);
        this.animStatus = `Visualizando: ${seq.name}...`;
    }
  }

  copiarId(id: string) { navigator.clipboard.writeText(id); this.animStatus = '✅ ID Copiado'; }
}