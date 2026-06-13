import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect, Input, Output, EventEmitter } from '@angular/core';
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
import { PropPhysics } from './prop-physics/prop-physics';
import { PropWorld } from './prop-world/prop-world';
import { PropLight } from './prop-light/prop-light'; 
import { PropBubble } from './prop-bubble/prop-bubble';
import { PropVideo } from './prop-video/prop-video';

@Component({
  selector: 'app-inspector-properties',
  standalone: true,
  imports: [
    CommonModule, PropTransform, PropTrigger, PropPlayer, PropSequences, 
    PropAnimation, PropPhysics, PropWorld, PropLight, PropBubble, PropVideo
  ],
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
  public esLuz = false;
  public esLuzConModelo = false;
  public esBurbuja = false;
  public esVideo = false;

  constructor() {
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado() as AbstractMesh;
      this.objetoActual = obj || null;
      if (obj) {
        this.esTrigger = obj.metadata?.type === 'trigger';
        this.esLuz = obj.metadata?.type?.startsWith('light_');
        this.esLuzConModelo = this.esLuz && !!obj.metadata?.assetId;
        this.esBurbuja = obj.metadata?.type === 'bubble';
        this.esVideo = obj.metadata?.type === 'video_plane';
        this.esPersonaje = obj.metadata?.type === 'model' || obj.metadata?.rol === 'npc' || obj.metadata?.rol === 'spawn_point';
        
        if (this.esPersonaje) this.familiaResumen = 'Personaje / Player';
        else if (this.esTrigger) this.familiaResumen = 'Trigger de Evento';
        else if (this.esLuzConModelo) this.familiaResumen = 'Luz con Modelo 3D';
        else if (this.esLuz) this.familiaResumen = 'Fuente de Luz';
        else if (this.esBurbuja) this.familiaResumen = 'Burbuja (TWD)';
        else if (this.esVideo) this.familiaResumen = 'Pantalla TV/Video';
        else this.familiaResumen = 'Objeto normal';
        
        if (this.pestanaActiva === 'player' && (!this.esPersonaje || this.esTrigger)) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'animation' && (!this.esPersonaje && !this.esLuzConModelo)) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'sequences' && !this.esPersonaje && !this.esTrigger && !this.esLuz && !this.esBurbuja) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'light' && !this.esLuz) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'physics' && (this.esLuz && !this.esLuzConModelo || this.esBurbuja)) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'bubble' && !this.esBurbuja) this.cambiarPestana('transform');
        if (this.pestanaActiva === 'video' && !this.esVideo) this.cambiarPestana('transform');
      } else {
        this.esTrigger = false;
        this.esPersonaje = false;
        this.esLuz = false;
        this.esLuzConModelo = false;
        this.esBurbuja = false;
        this.esVideo = false;
        this.familiaResumen = 'Sin selección';
        
        if (this.pestanaActiva !== 'world') {
          this.cambiarPestana('world');
        }
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