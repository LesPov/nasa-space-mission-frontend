
import { Component, inject, OnInit, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../services/api/episodios';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { AbstractMesh, Vector3, AnimationGroup, Mesh } from '@babylonjs/core';
import { EditorPlayerService } from '../../services/editor/editor-player.service';
import { Motor3dService } from '../../services/motor-3d.service';
import { PlayerClipSequence, createPlayerSequence, createSequenceStep, cloneDefaultPlayerConfig, mergePlayerConfig } from '../../services/editor/player-config.model';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

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
  private playerSvc = inject(EditorPlayerService);
  private motor3dSvc = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  public activeTab: string = 'clips';
  public currentObjectId: string | null = null;
  
  // PREFABS
  public prefabsDisponibles: any[] = [];
  public nuevoPrefabNombre: string = '';
  public guardandoPrefab = false;

  // AUTO-ANIM
  public autoAnimConfig = {
    enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2, stopBaked: false
  };

  // CLIPS (SECUENCIAS)
  public sequences: PlayerClipSequence[] = [];
  public selectedSequenceId: string | null = null;
  public selectedStepIndex: number = -1;
  public actionRows: any[] = [];
  public availableClips: string[] = [];
  public esPersonaje: boolean = false;
  public esLuz: boolean = false;

  constructor() {
    // 🔥 EFECTO REACTIVO: Evita que se pierda el foco de los inputs o se borre tu data no guardada
    // ya que solo recarga la info de la línea de tiempo si realmente seleccionas OTRO objeto.
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado() as Mesh;
      const objId = obj ? (obj.metadata?.uid || obj.uniqueId.toString()) : null;
      
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

  // ==========================================
  // LÓGICA DE CLIPS Y SECUENCIAS
  // ==========================================
  cargarClipsDelObjeto() {
    const obj = this.editorSvc.objetoSeleccionado() as Mesh;
    if (!obj) {
      this.sequences = [];
      this.selectedSequenceId = null;
      return;
    }
    
    this.esPersonaje = obj.metadata?.rol === 'npc' || obj.metadata?.rol === 'spawn_point';
    this.esLuz = obj.metadata?.type?.startsWith('light_');

    if (this.esPersonaje) this.actionRows = ACTION_ROWS_CHAR;
    else if (this.esLuz) this.actionRows = ACTION_ROWS_LIGHT;
    else this.actionRows = ACTION_ROWS_PROP;
    
    const meta = obj.metadata || {};
    const config = mergePlayerConfig(meta.playerConfig || null);
    this.sequences = Array.isArray(config.sequences) ? JSON.parse(JSON.stringify(config.sequences)) : [];
    
    if (this.sequences.length > 0 && (!this.selectedSequenceId || !this.sequences.find(s => s.id === this.selectedSequenceId))) {
      this.selectedSequenceId = this.sequences[0].id;
      this.selectedStepIndex = 0;
    } else if (this.sequences.length === 0) {
      this.selectedSequenceId = null;
      this.selectedStepIndex = -1;
    }

    const rawClips: string[] = [];
    
    // 🔥 LÓGICA SÓLIDA PARA DETECTAR ANIMACIONES (Incluso huesos perdidos dentro del GLB)
    if (obj.metadata?.animationNames && Array.isArray(obj.metadata.animationNames)) {
        rawClips.push(...obj.metadata.animationNames);
    }
    
    obj.getChildMeshes(false).forEach(child => {
        if (child.metadata?.animationNames && Array.isArray(child.metadata.animationNames)) {
            rawClips.push(...child.metadata.animationNames);
        }
    });

    this.motor3dSvc.scene.meshes.forEach(m => {
        if (m.metadata?.type === 'video_plane') rawClips.push(m.name);
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
    const obj = this.editorSvc.objetoSeleccionado();
    if (!obj) return;
    if (!obj.metadata) obj.metadata = {};
    if (!obj.metadata.playerConfig) obj.metadata.playerConfig = cloneDefaultPlayerConfig();
    obj.metadata.playerConfig.sequences = JSON.parse(JSON.stringify(this.sequences));
    this.editorSvc.triggerUpdate(); // Dispara el guardado automático
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
    if (obj.metadata.type !== 'trigger') {
        const entity = this.entityManager.getEntityByMesh(obj);
        if (entity) {
            this.playerSvc.iniciarPreviewSecuencia(entity, seq.id);
        }
    }
  }

  getActionLabel(key: string): string {
    const act = this.actionRows.find(r => r.key === key);
    return act ? act.label : key;
  }

  // ==========================================
  // LÓGICA DE ANIMACIÓN BÁSICA (AUTO-ANIM)
  // ==========================================
  leerAutoAnimacionDelObjeto() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (seleccionado && seleccionado.metadata) {
      const savedAnim = seleccionado.metadata.autoAnim;
      if (savedAnim) {
        this.autoAnimConfig = { ...savedAnim };
      } else {
        this.autoAnimConfig = { enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2, stopBaked: false };
      }
      this.cdr.detectChanges();
    }
  }

  guardarAutoAnimacion() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!seleccionado) return;
    if (!seleccionado.metadata) seleccionado.metadata = {};
    seleccionado.metadata.autoAnim = { ...this.autoAnimConfig };
    this.editorSvc.triggerUpdate(); 
  }

  // ==========================================
  // LÓGICA DE PREFABS
  // ==========================================
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

    const meta = seleccionado.metadata || {};
    const propertiesToSave = JSON.parse(JSON.stringify(meta));
    
    delete propertiesToSave.uid;
    delete propertiesToSave.parentId;
    delete propertiesToSave.isHovered;
    delete propertiesToSave.currentHoverScale;
    delete propertiesToSave.baseScaleX;
    delete propertiesToSave.baseScaleY;
    delete propertiesToSave.baseScaleZ;

    propertiesToSave.scale = { x: seleccionado.scaling.x, y: seleccionado.scaling.y, z: seleccionado.scaling.z };
    const rot = seleccionado.rotationQuaternion ? seleccionado.rotationQuaternion.toEulerAngles() : seleccionado.rotation;
    propertiesToSave.rotation = { x: rot.x, y: rot.y, z: rot.z };

    const assetId = meta.assetId || null;
    const type = meta.type || 'cube';

    this.guardandoPrefab = true;

    this.api.crearPrefab({
      name: this.nuevoPrefabNombre,
      type: type,
      assetId: assetId,
      properties: propertiesToSave
    }).subscribe({
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
    const camTarget = this.editorSvc.state.cameraPivot?.position || new Vector3(0, 1, 0);
    this.editorSvc.instanciarPrefabFull(prefab, camTarget);
  }

  eliminarPrefab(id: number) {
    if (confirm('¿Seguro que deseas eliminar este Prefab global de la base de datos?')) {
      this.api.eliminarPrefab(id).subscribe({
        next: () => this.cargarPrefabs(),
        error: () => alert('Error eliminando prefab')
      });
    }
  }
}