import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { cloneDefaultPlayerConfig, createPlayerSequence, createSequenceStep, PlayerClipSequence } from '../player-config.model';

@Injectable({ providedIn: 'root' })
export class SequenceMutatorService {
  private editorSvc = inject(EditorMapaService);

  public persistirSecuencias(objeto: AbstractMesh, sequences: PlayerClipSequence[]): void {
    if (!objeto.metadata) objeto.metadata = {};
    if (!objeto.metadata.playerConfig) objeto.metadata.playerConfig = cloneDefaultPlayerConfig();
    objeto.metadata.playerConfig.sequences = JSON.parse(JSON.stringify(sequences));
    this.editorSvc.triggerUpdate();
  }

  public crearNuevaSecuencia(objeto: AbstractMesh, sequences: PlayerClipSequence[], isPersonaje: boolean, availableClips: string[]): string {
    const seq = createPlayerSequence(`Secuencia ${sequences.length + 1}`);
    if (!isPersonaje && seq.steps.length > 0) {
        seq.steps[0].action = 'idle';
        seq.steps[0].loop = true;
    }
    sequences.push(seq);
    this.persistirSecuencias(objeto, sequences);
    return seq.id;
  }

  public eliminarSecuencia(objeto: AbstractMesh, sequences: PlayerClipSequence[], id: string): string | null {
    const filtered = sequences.filter(s => s.id !== id);
    sequences.length = 0;
    sequences.push(...filtered);
    this.persistirSecuencias(objeto, sequences);
    return sequences.length > 0 ? sequences[0].id : null;
  }

  public agregarPaso(objeto: AbstractMesh, seq: PlayerClipSequence, isPersonaje: boolean, availableClips: string[]): void {
    const step = createSequenceStep(isPersonaje ? 'walk' : 'idle');
    if (!isPersonaje) {
        step.loop = true; 
        if (availableClips.length > 0) {
            step.clipOverride = availableClips[0];
        }
    }
    seq.steps.push(step); 
    this.persistirSecuencias(objeto, [seq]); // Simplificado para que el array referenciado actualice la metadata real
  }

  public quitarPaso(objeto: AbstractMesh, seq: PlayerClipSequence, index: number): void {
    seq.steps.splice(index, 1);
    this.persistirSecuencias(objeto, [seq]);
  }

  public moverPaso(objeto: AbstractMesh, seq: PlayerClipSequence, index: number, dir: number): void {
    const target = index + dir;
    if (target < 0 || target >= seq.steps.length) return;
    const arr = [...seq.steps]; 
    const [item] = arr.splice(index, 1); 
    arr.splice(target, 0, item);
    seq.steps.length = 0;
    seq.steps.push(...arr);
    this.persistirSecuencias(objeto, [seq]);
  }
}