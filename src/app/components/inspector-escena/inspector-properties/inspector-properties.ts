import {
  Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect, Input, Output, EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorPlayerService } from '../../../services/editor/editor-player.service';

import { PropTransform } from './prop-transform/prop-transform';
import { PropTrigger } from './prop-trigger/prop-trigger';
import { PropPlayer } from './prop-player/prop-player';
import { PropSequences } from './prop-sequences/prop-sequences';
import { PropAnimation } from './prop-animation/prop-animation';
// 🔥 IMPORTAMOS FÍSICAS
import { PropPhysics } from './prop-physics/prop-physics';

@Component({
  selector: 'app-inspector-properties',
  standalone: true,
  // 🔥 LO AGREGAMOS AL IMPORTS
  imports: [CommonModule, PropTransform, PropTrigger, PropPlayer, PropSequences, PropAnimation, PropPhysics],
  templateUrl: './inspector-properties.html',
  styleUrl: './inspector-properties.css'
})
export class InspectorProperties implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private playerSvc = inject(EditorPlayerService);
  private cdr = inject(ChangeDetectorRef);

  private _pestanaActiva: string = 'transform';
  @Input() set pestanaActiva(val: string) { 
    this._pestanaActiva = val; 
    this.playerSvc.detenerPreviewSecuencia();
  }
  get pestanaActiva() { return this._pestanaActiva; }
  @Output() pestanaActivaChange = new EventEmitter<string>();

  private subs: Subscription[] = [];
  public objetoActual: AbstractMesh | null = null;
  public familiaResumen = '';
  public esPersonaje = false;
  public esTrigger = false;

  constructor() {
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado() as AbstractMesh;
      this.objetoActual = obj || null;
      if (obj) {
        this.esTrigger = obj.metadata?.type === 'trigger';
        this.esPersonaje = obj.metadata?.type === 'model' || obj.metadata?.rol === 'npc' || obj.metadata?.rol === 'spawn_point';
        this.familiaResumen = this.esPersonaje ? 'Personaje / Player' : (this.esTrigger ? 'Trigger de Evento' : 'Objeto normal');
        
        if (this.pestanaActiva === 'player' && (!this.esPersonaje || this.esTrigger)) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'animation' && (!this.esPersonaje || this.esTrigger)) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'sequences' && !this.esPersonaje && !this.esTrigger) this.cambiarPestana('transform');
      } else {
        this.esTrigger = false;
        this.esPersonaje = false;
        this.familiaResumen = 'Sin selección';
      }
      this.cdr.detectChanges();
    });
  }

  ngOnInit() {
    const refrescar = () => { this.cdr.detectChanges(); };
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(refrescar),
      this.editorSvc.onMapChanged.subscribe(refrescar)
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.playerSvc.detenerPreviewSecuencia(); 
  }

  cambiarPestana(tab: string) {
    this.pestanaActivaChange.emit(tab);
  }

  eliminarObjeto() {
    this.editorSvc.eliminarSeleccionado();
  }
}