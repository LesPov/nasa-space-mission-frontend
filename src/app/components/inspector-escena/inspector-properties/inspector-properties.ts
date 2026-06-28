

import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { auditTime } from 'rxjs/operators';

import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { EditorPreviewService } from '../../../services/editor/editor-preview.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { SceneNodesService } from '../../../services/editor/sceneservice/scene-nodes.service';

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
import { PropMission } from './prop-mission/prop-mission';
 
@Component({
  selector: 'app-inspector-properties',
  standalone: true,
  imports: [
    CommonModule, PropTransform, PropTrigger, PropPlayer, PropSequences, 
    PropAnimation, PropPhysics, PropWorld, PropLight, PropBubble, PropVideo, PropMission
  ],
  templateUrl: './inspector-properties.html',
  styleUrl: './inspector-properties.css'
})
export class InspectorProperties implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  public stateSvc = inject(EditorStateService);
  private sceneNodesSvc = inject(SceneNodesService);
  private previewSvc = inject(EditorPreviewService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  private _pestanaActiva: string = 'transform';
  @Input() set pestanaActiva(val: string) { 
    this._pestanaActiva = val; 
    this.previewSvc.detenerPreviewSecuencia();
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
      const obj = this.stateSvc.objetoSeleccionado() as AbstractMesh;
      this.objetoActual = obj || null;
      if (obj) {
        const entity = this.entityManager.getEntityByMesh(obj);
        const type = entity?.type || 'unknown';

        this.esTrigger = type === 'trigger' || type === 'trigger_compuesto';
        this.esLuz = type.startsWith('light_');
        this.esLuzConModelo = this.esLuz && !!entity?.visual?.assetId;
        this.esBurbuja = type === 'bubble';
        this.esVideo = type === 'video_plane';
        this.esPersonaje = !!entity?.characterConfig;
        
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
        
        if (this.pestanaActiva !== 'world' && this.pestanaActiva !== 'mission') {
          this.cambiarPestana('world');
        }
      }
      this.cdr.detectChanges();
    });
  }

  ngOnInit() {
    const refrescar = () => { this.cdr.detectChanges(); };

    this.subs.push(
      this.editorSvc.onGizmoDrag.pipe(auditTime(150)).subscribe(refrescar),
      this.editorSvc.onMapChanged.subscribe(refrescar)
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.previewSvc.detenerPreviewSecuencia(); 
  }

  cambiarPestana(tab: string) {
    this.pestanaActivaChange.emit(tab);
  }

  eliminarObjeto() {
    this.sceneNodesSvc.eliminarSeleccionado();
  }
}
