
import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect, Input, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { auditTime } from 'rxjs/operators';

import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { EditorPreviewService } from '../../../services/editor/editor-preview.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { SceneNodesService } from '../../../services/editor/sceneservice/scene-nodes.service';
import { PrefabManagerService } from '../../../services/editor/prefab-manager.service'; 
import { EditorCinematicService } from '../../../services/editor/editor-cinematic.service';
import { EditorCinematicToolsService } from '../../../services/editor-cinematic-tools.service';
import { EditorCinematicProxyService } from '../../../services/editor-cinematic-proxy.service';
import { CinematicPlaybackManagerService } from '../../../core/engine/runtime/cinematics/cinematic-playback-manager.service';

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
import { CinematicInspector } from '../../global-timeline/tabs/timeline-director-tab/cinematic-inspector/cinematic-inspector/cinematic-inspector';
    
@Component({
  selector: 'app-inspector-properties',
  standalone: true,
  imports: [
    CommonModule, PropTransform, PropTrigger, PropPlayer, PropSequences, 
    PropAnimation, PropPhysics, PropWorld, PropLight, PropBubble, PropVideo, PropMission, CinematicInspector
  ],
  templateUrl: './inspector-properties.html',
  styleUrl: './inspector-properties.css'
})
export class InspectorProperties implements OnInit, OnDestroy {
  public editorSvc = EditorMapaService;
  public stateSvc = inject(EditorStateService);
  private sceneNodesSvc = inject(SceneNodesService);
  private previewSvc = inject(EditorPreviewService);
  private entityManager = inject(EntityManagerService);
  private prefabManager = inject(PrefabManagerService); 
  public cinematicSvc = inject(EditorCinematicService);
  private cinematicTools = inject(EditorCinematicToolsService);
  private proxySvc = inject(EditorCinematicProxyService);
  private playbackManager = inject(CinematicPlaybackManagerService);
  private cdr = inject(ChangeDetectorRef);
  private editorMapa = inject(EditorMapaService);

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

  public sceneEntities = computed(() => this.entityManager.getAllEntities().map(e => ({uid: e.uid, name: e.name})).sort((a,b)=>a.name.localeCompare(b.name)));

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
        
        if (this.pestanaActiva !== 'world' && this.pestanaActiva !== 'mission' && this.pestanaActiva !== 'cinematic') {
          if (this.stateSvc.activeBottomTab() === 'director') {
              this.cambiarPestana('cinematic');
          } else {
              this.cambiarPestana('world');
          }
        }
      }
      this.cdr.detectChanges();
    });

    effect(() => {
      const bottomTab = this.stateSvc.activeBottomTab();
      if (bottomTab === 'director') {
        if (this.pestanaActiva !== 'cinematic') {
           this.cambiarPestana('cinematic');
        }
      } else if (this.pestanaActiva === 'cinematic') {
         this.cambiarPestana('transform');
      }
    });
  }

  ngOnInit() {
    const refrescar = () => { this.cdr.detectChanges(); };

    this.subs.push(
      this.editorMapa.onGizmoDrag.pipe(auditTime(150)).subscribe(refrescar),
      this.editorMapa.onMapChanged.subscribe(refrescar)
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

  guardarComoPrefab() {
    if (!this.objetoActual) return;
    
    const nombreDefecto = this.objetoActual.name + '_Prefab';
    const nombre = prompt('Ingresa un nombre para el nuevo Prefab:', nombreDefecto);
    
    if (!nombre || nombre.trim() === '') return;
    
    this.prefabManager.createPrefabFromMesh(this.objetoActual, nombre).then(() => {
        alert('📦 Prefab guardado exitosamente.\nBúscalo en la pestaña "Prefabs" de la Línea de Tiempo.');
    }).catch(err => {
        alert('Error al crear Prefab: ' + err);
    });
  }

  // ==========================================
  // HANDLERS PARA CINEMATIC INSPECTOR
  // ==========================================
  onCinematicPropertyChanged() {
      this.editorMapa.onMapChanged.next();
  }

  onCinematicTimeChanged() {
      const track = this.cinematicSvc.currentTrack();
      const kf = this.cinematicSvc.currentKeyframe();
      if (track && kf) {
          track.keyframes.sort((a,b) => a.timeMs - b.timeMs);
          this.cinematicSvc.selectedKeyframeId.set(kf.id);
          this.editorMapa.onMapChanged.next();
          this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
          // 🔥 FORZAR EVALUACIÓN DE OVERLAYS PARA ACTUALIZAR VISTA PREVIA INSTANTÁNEAMENTE
          this.playbackManager.seek(this.playbackManager.playheadMs());
      }
  }

  onCinematicTransformChanged() {
      this.editorMapa.onMapChanged.next();
      this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
      const kf = this.cinematicSvc.currentKeyframe();
      if (kf) {
          const proxyMesh = this.proxySvc.getProxyById(kf.id);
          if (proxyMesh) this.stateSvc.seleccionarObjeto(proxyMesh);
      }
      // 🔥 FORZAR EVALUACIÓN DE OVERLAYS PARA ACTUALIZAR VISTA PREVIA INSTANTÁNEAMENTE
      this.playbackManager.seek(this.playbackManager.playheadMs());
  }

  eliminarCinematica() {
      const id = this.cinematicSvc.selectedCinematicId();
      if (id) {
          this.cinematicSvc.eliminarCinematica(id);
          this.editorMapa.onMapChanged.next();
          this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
      }
  }

  quitarTrack() {
      const cin = this.cinematicSvc.currentCinematic();
      const idx = this.cinematicSvc.selectedTrackIndex();
      if (cin && idx >= 0) {
          this.cinematicSvc.quitarTrack(cin, idx);
          this.editorMapa.onMapChanged.next();
          this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
      }
  }

  quitarKeyframe(kfId: string) {
      const track = this.cinematicSvc.currentTrack();
      if (track) {
          this.cinematicSvc.quitarKeyframe(track, kfId);
          this.editorMapa.onMapChanged.next();
          this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
      }
  }

  capturarPosRot(targetKf: any) {
      this.cinematicTools.capturarPosRot(this.cinematicSvc.currentTrack(), targetKf);
      this.editorMapa.onMapChanged.next();
      this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
      const proxyMesh = this.proxySvc.getProxyById(targetKf.id);
      if (proxyMesh) this.stateSvc.seleccionarObjeto(proxyMesh);
  }
}