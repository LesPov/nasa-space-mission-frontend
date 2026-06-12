import { Component, Input, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, AnimationGroup } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorPlayerService } from '../../../../services/editor/editor-player.service';
import { PlayerClipSequence, mergePlayerConfig, cloneDefaultPlayerConfig, createPlayerSequence, createSequenceStep } from '../../../../services/editor/player-config.model';
import { Motor3dService } from '../../../../services/motor-3d.service';
 
const ACTION_ROWS_CHAR = [
  { key: 'idle', label: 'Idle / Reposo' }, { key: 'walk', label: 'Walk (Caminar)' }, { key: 'run', label: 'Run (Correr)' }
];

const ACTION_ROWS_LIGHT = [
  { key: 'idle', label: 'Luz Fija (Encendida Mantiene Estado)' }, 
  { key: 'lightOn', label: 'Forzar Encender Luz' }, 
  { key: 'lightOff', label: 'Forzar Apagar Luz' }, 
  { key: 'lightPulse', label: 'Parpadeo Suave (Pulsar)' }, 
  { key: 'lightFlicker', label: 'Parpadeo Roto (Estroboscópico)' }
];

@Component({
  selector: 'app-prop-sequences',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-sequences.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropSequences implements OnInit, OnChanges {
  @Input() objeto!: AbstractMesh;
  private editorSvc = inject(EditorMapaService);
  private playerSvc = inject(EditorPlayerService);
  private motor3dSvc = inject(Motor3dService); 

  sequences: PlayerClipSequence[] = [];
  selectedSequenceId: string | null = null;
  actionRows: any[] = [];
  animStatus = '';
  
  availableClips: string[] = [];
  esPersonaje: boolean = false;
  esLuz: boolean = false;

  ngOnInit() {
    this.cargarDatos();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) {
      this.cargarDatos();
    }
  }

  cargarDatos() {
    if (!this.objeto) return;
    
    this.esPersonaje = this.objeto.metadata?.rol === 'npc' || this.objeto.metadata?.rol === 'spawn_point';
    this.esLuz = this.objeto.metadata?.type?.startsWith('light_');

    if (this.esLuz) {
        this.actionRows = ACTION_ROWS_LIGHT;
    } else {
        this.actionRows = ACTION_ROWS_CHAR;
    }
    
    const meta = this.objeto.metadata || {};
    const config = mergePlayerConfig(meta.playerConfig || null);
    this.sequences = Array.isArray(config.sequences) ? JSON.parse(JSON.stringify(config.sequences)) : [];
    if (this.sequences.length > 0) this.selectedSequenceId = this.sequences[0].id;

    const validTargets = new Set();
    validTargets.add(this.objeto);
    this.objeto.getDescendants(false).forEach(child => validTargets.add(child));

    let myAnimNames: string[] = this.objeto.metadata?.animationNames || [];
    if (myAnimNames.length === 0) {
        const childWithAnims = this.objeto.getChildMeshes(false).find(m => m.metadata?.animationNames && m.metadata.animationNames.length > 0);
        if (childWithAnims) {
            myAnimNames = childWithAnims.metadata.animationNames;
        }
    }
    
    if (myAnimNames.length > 0) {
        const groups = this.motor3dSvc.scene.animationGroups.filter(ag => myAnimNames.includes(ag.name));
        this.availableClips = groups.map(g => g.name);
    } else {
        const groups = this.motor3dSvc.scene.animationGroups.filter((ag: AnimationGroup) => {
          if (!ag.targetedAnimations || ag.targetedAnimations.length === 0) return false;
          return ag.targetedAnimations.some((ta: any) => validTargets.has(ta.target));
        });
        this.availableClips = groups.map(g => g.name);
    }
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
    const seq = createPlayerSequence(`Secuencia ${this.sequences.length + 1}`);
    if (!this.esPersonaje && seq.steps.length > 0) {
        seq.steps[0].action = 'idle';
        seq.steps[0].loop = true;
    }
    this.sequences.push(seq);
    this.selectedSequenceId = seq.id;
    this.persist();
  }

  eliminarSecuencia(id: string) {
    this.sequences = this.sequences.filter(s => s.id !== id);
    this.selectedSequenceId = this.sequences.length > 0 ? this.sequences[0].id : null;
    this.persist();
  }

  agregarPaso(seq: PlayerClipSequence) { 
    const step = createSequenceStep(this.esPersonaje ? 'walk' : 'idle');
    if (!this.esPersonaje) {
        step.loop = true; 
        if (this.availableClips.length > 0) {
            step.clipOverride = this.availableClips[0];
        }
    }
    seq.steps.push(step); 
    this.persist(); 
  }
  
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