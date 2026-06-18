
import { Component, inject, OnInit, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../services/api/episodios';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { AbstractMesh, Vector3, AnimationGroup, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../../services/motor-3d.service';
import { PlayerClipSequence, createPlayerSequence, createSequenceStep, cloneDefaultPlayerConfig, mergePlayerConfig } from '../../core/engine/models/player-config.model';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { EditorPreviewService } from '../../services/editor/editor-preview.service';

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
  { key: 'lightOn', label: '💡 Encender Luz al 100%' }, 
  { key: 'lightOff', label: '🔌 Apagar Luz' }, 
  { key: 'lightPulse', label: '💓 Parpadeo Suave (Pulso)' }, 
  { key: 'lightFlicker', label: '⚡ Estroboscópico (Roto)' }
];

@Component({
  selector: 'app-global-timeline', 
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './global-timeline.html',
  styleUrl: './global-timeline.css'
})
export class GlobalTimeline implements OnInit {
  public api = inject(EpisodiosService);
  public editorSvc = inject(EditorMapaService);
  private previewSvc = inject(EditorPreviewService);
  private motor3dSvc = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  public activeTab: string = 'clips';
  public currentObjectId: string | null = null;
  
  public prefabsDisponibles: any[] = [];
  public nuevoPrefabNombre: string = '';
  public guardandoPrefab = false;

  public autoAnimConfig = {
    enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2, stopBaked: false
  };

  public sequences: PlayerClipSequence[] = [];
  public selectedSequenceId: string | null = null;
  public selectedStepIndex: number = -1;
  public actionRows: any[] = [];
  public availableClips: string[] = [];
  public esPersonaje: boolean = false;
  public esLuz: boolean = false;
  public esTrigger: boolean = false;

  constructor() {
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado() as Mesh;
      const entity = this.entityManager.getEntityByMesh(obj);
      const objId = entity ? entity.uid : null;
      
      if (this.currentObjectId !== objId) {
          this.currentObjectId = objId;
          this.leerAutoAnimacionDelObjeto();
          this.cargarClipsDelObjeto();
      }
    });
  }

  ngOnInit() {
    this.cargarPrefabs();
  }

  cargarClipsDelObjeto() {
    const obj = this.editorSvc.objetoSeleccionado() as Mesh;
    const entity = this.entityManager.getEntityByMesh(obj);

    if (!entity) {
      this.sequences = [];
      this.selectedSequenceId = null;
      return;
    }
    
    this.esPersonaje = entity.rol === 'npc' || entity.rol === 'spawn_point';
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

    const rawClips: string[] = [];
    
    if (entity.animationNames && Array.isArray(entity.animationNames)) {
        rawClips.push(...entity.animationNames);
    }

    this.motor3dSvc.scene.meshes.forEach(m => {
        const testEnt = this.entityManager.getEntityByMesh(m);
        if (testEnt && testEnt.type === 'video_plane') rawClips.push(m.name);
    });

    this.availableClips = [...new Set(rawClips)];
    this.cdr.detectChanges();
  }

  get currentSequence() { return this.sequences.find(s => s.id === this.selectedSequenceId) || null; }
  get currentStep() { return this.currentSequence?.steps[this.selectedStepIndex] || null; }

  seleccionarSecuencia(id: string) {
    this.selectedSequenceId = id;
    this.selectedStepIndex = 0;
  }

  persist() {
    const obj = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!obj) return;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity) {
        if (!entity.playerConfig) entity.playerConfig = cloneDefaultPlayerConfig();
        entity.playerConfig.sequences = JSON.parse(JSON.stringify(this.sequences));
        entity.syncToView();
        this.editorSvc.triggerUpdate();
    }
  }

  nuevaSecuencia() {
    const seq = createPlayerSequence(`Clip Cinemático ${this.sequences.length + 1}`);
    if (!this.esPersonaje && seq.steps.length > 0) {
        seq.steps[0].action = 'idle';
        seq.steps[0].loop = true;
    }
    this.sequences.push(seq);
    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = 0;
    this.persist();
  }

  eliminarSecuencia(id: string) {
    this.sequences = this.sequences.filter(s => s.id !== id);
    this.selectedSequenceId = this.sequences.length > 0 ? this.sequences[0].id : null;
    this.selectedStepIndex = this.sequences.length > 0 ? 0 : -1;
    this.persist();
  }

  agregarPaso(seq: PlayerClipSequence) { 
    const step = createSequenceStep(this.esPersonaje ? 'walk' : 'idle');
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

  probarSecuencia(seq: PlayerClipSequence) {
    this.persist();
    const obj = this.editorSvc.objetoSeleccionado() as Mesh;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity && entity.type !== 'trigger' && entity.type !== 'trigger_compuesto') {
        this.previewSvc.iniciarPreviewSecuencia(entity, seq.id);
    }
  }

  getActionLabel(key: string): string {
    const act = this.actionRows.find(r => r.key === key);
    return act ? act.label : key;
  }

  leerAutoAnimacionDelObjeto() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    const entity = this.entityManager.getEntityByMesh(seleccionado);
    if (entity && entity.autoAnim) {
      this.autoAnimConfig = { ...entity.autoAnim };
    } else {
      this.autoAnimConfig = { enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2, stopBaked: false };
    }
    this.cdr.detectChanges();
  }

  guardarAutoAnimacion() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    const entity = this.entityManager.getEntityByMesh(seleccionado);
    if (entity) {
        entity.autoAnim = { ...this.autoAnimConfig };
        entity.syncToView();
        this.editorSvc.triggerUpdate(); 
    }
  }

  cargarPrefabs() {
    this.api.obtenerPrefabs().subscribe({
      next: (res) => {
        this.prefabsDisponibles = res;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Error cargando prefabs:', err)
    });
  }

  guardarObjetoActualComoPrefab() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!seleccionado || !this.nuevoPrefabNombre.trim()) return;

    this.guardandoPrefab = true;

    const entity = this.entityManager.getEntityByMesh(seleccionado);
    if(!entity) {
       this.guardandoPrefab = false;
       return;
    }

    entity.syncTransformFromView();

    const propertiesToSave = {
      color: entity.visual.color,
      colorBW: entity.visual.colorBW,
      rol: entity.rol,
      isSolid: entity.visual.isSolid,
      isSelectable: entity.visual.isSelectable,
      ignoraNiebla: entity.visual.ignoraNiebla,
      esEmisivo: entity.visual.esEmisivo,
      brilloIntensidad: entity.visual.brilloIntensidad,
      mensaje: entity.interaction.mensaje,
      interactDistanceFPS: entity.interaction.interactDistanceFPS,
      interactDistanceTPS: entity.interaction.interactDistanceTPS,
      interactSequenceIdFPS: entity.interaction.interactSequenceIdFPS,
      interactSequenceIdTPS: entity.interaction.interactSequenceIdTPS,
      collider: entity.collider,
      camOffset: entity.camOffset,
      playerConfig: entity.playerConfig,
      selectionRange: entity.selectionRange,
      animationNames: entity.animationNames,
      autoAnim: entity.autoAnim,
      path: entity.visual.path,
      scale: entity.transform.scale,
      rotation: entity.transform.rotation
    };

    let finalProperties: any = { ...propertiesToSave };

    if (entity.type.startsWith('light_') && entity.light) {
      finalProperties = { ...finalProperties, ...entity.light };
    } else if ((entity.type === 'video_plane' || entity.type === 'image_plane') && entity.media) {
      finalProperties = { ...finalProperties, ...entity.media };
    }

    const data = {
      name: this.nuevoPrefabNombre,
      type: entity.type || 'model',
      assetId: entity.visual.assetId || null,
      properties: finalProperties
    };

    this.api.crearPrefab(data).subscribe({
      next: () => {
        this.nuevoPrefabNombre = '';
        this.guardandoPrefab = false;
        this.cargarPrefabs();
        alert('Prefab guardado con éxito (Modelo 3D, Luces y Secuencias/Clips incluidos).');
      },
      error: (err) => {
        console.error('Error guardando prefab:', err);
        this.guardandoPrefab = false;
        alert('Error al guardar el Prefab.');
      }
    });
  }

  instanciarPrefab(prefab: any) {
    let camTarget = new Vector3(0, 1, 0);
    if (this.motor3dSvc.editorCamera && typeof this.motor3dSvc.editorCamera.getTarget === 'function') {
      camTarget = this.motor3dSvc.editorCamera.getTarget().clone();
    }
    this.editorSvc.instanciarPrefabFull(prefab, camTarget);
  }

  eliminarPrefab(id: number) {
    if (confirm('¿Seguro que deseas eliminar este Prefab global de la base de datos?')) {
      this.api.eliminarPrefab(id).subscribe({
        next: () => this.cargarPrefabs(),
        error: () => alert('Error eliminando prefab')
      });
    }
  }}