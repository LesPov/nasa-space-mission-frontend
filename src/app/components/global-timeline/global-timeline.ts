
import { Component, inject, OnInit, ChangeDetectorRef, effect, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../services/api/episodios';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { AbstractMesh, Vector3, Mesh, StandardMaterial, Color3, MeshBuilder, TransformNode, Tags, Matrix } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { PlayerClipSequence, createPlayerSequence, createSequenceStep, cloneDefaultPlayerConfig, mergePlayerConfig } from '../../core/engine/models/player-config.model';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { EditorPreviewService } from '../../services/editor/editor-preview.service';
import { WorldSettingsService } from '../../core/engine/world/world-settings.service';
import { CinematicDirectorService } from '../../core/engine/runtime/systems/cinematic-director.service';
import { CinematicSequence, CinematicTrack, CinematicClip } from '../../core/engine/models/cinematic.model'; 
import { EditorCinematicService } from '../../services/editor/editor-cinematic.service';
import { EditorCameraService } from '../../services/editor/editor-camera.service';
import { Subscription } from 'rxjs';

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
export class GlobalTimeline implements OnInit, OnDestroy {
  public api = inject(EpisodiosService);
  public editorSvc = inject(EditorMapaService);
  private previewSvc = inject(EditorPreviewService);
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);
  public cinematicSvc = inject(EditorCinematicService); 
  private cameraSvc = inject(EditorCameraService);
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

  public platformLogic = {
    initialVariables: [] as { key: string, value: string }[],
    objetivosLocales: '',
    recompensasLocales: ''
  };

  get cinematics() { return this.cinematicSvc.cinematics(); }
  
  public selectedCinematicId: string | null = null;
  public selectedTrackIndex: number = -1;
  public selectedClipIndex: number = -1;
  public cinematicPlayhead: number = 0;
  public cinematicIsPlaying = false;
  private cinematicTimer: any;
  public cinematicDirector = inject(CinematicDirectorService);
  public sceneEntities: any[] = [];

  public isScrubbing = false;
  public isInsideCamera = false;
  private cameraProxies: Mesh[] = []; 
  private subs: Subscription[] = [];

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

    effect(() => {
      this.editorSvc.escenaIdActiva();
      this.cargarPlataformaLogic();
    });
  }

  ngOnInit() {
    this.cargarPrefabs();
    
    // 🔥 Suscribirse al movimiento de Gizmos para actualizar clips
    this.subs.push(
      this.cinematicSvc.onProxyMoved.subscribe(data => {
        if (this.currentCinematic) {
          this.currentCinematic.tracks.forEach(track => {
            track.clips.forEach(clip => {
              if (clip.id === data.clipId) {
                 clip.startPosition = { x: data.position.x, y: data.position.y, z: data.position.z };
                 clip.startRotation = { x: data.rotation.x, y: data.rotation.y, z: data.rotation.z };
              }
            });
          });
          this.persistCinematics();
          this.cdr.detectChanges();
        }
      })
    );
  }

  ngOnDestroy() {
    this.limpiarCamarasProxy();
    if (this.isInsideCamera) this.salirCamara();
    this.subs.forEach(s => s.unsubscribe());
  }

  cambiarTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'director') {
        this.sceneEntities = this.entityManager.getAllEntities()
            .map(e => ({ uid: e.uid, name: e.name }))
            .sort((a,b) => a.name.localeCompare(b.name));
        this.dibujarCamarasProxy();
    } else {
        this.limpiarCamarasProxy();
        if (this.isInsideCamera) this.salirCamara();
    }
  }

  // 🔥 Dibujar Mallas Representativas (Físicas) de Cámaras Cinemáticas
  private dibujarCamarasProxy(): void {
      this.limpiarCamarasProxy();
      const seq = this.currentCinematic;
      if (!seq || !this.motor3dSvc.getScene()) return;

      seq.tracks.forEach(track => {
          if (track.type === 'camera') {
              track.clips.forEach((clip, i) => {
                  // Creamos un Mesh unificado (Box) en lugar de TransformNode para permitir picking en Editor
                  const node = MeshBuilder.CreateBox(`proxy_cam_${clip.id}`, { width: 0.4, height: 0.3, depth: 0.5 }, this.motor3dSvc.getScene());
                  
                  const lens = MeshBuilder.CreateCylinder('lens', { height: 0.3, diameterTop: 0.3, diameterBottom: 0.15 }, this.motor3dSvc.getScene());
                  lens.rotation.x = Math.PI / 2;
                  lens.position.z = 0.4;
                  lens.parent = node;
                  
                  const mat = new StandardMaterial('mat', this.motor3dSvc.getScene());
                  mat.diffuseColor = new Color3(0, 0.5, 1);
                  mat.emissiveColor = new Color3(0, 0.2, 0.5);
                  node.material = mat; 
                  lens.material = mat;

                  node.isPickable = true;
                  lens.isPickable = true;
                  
                  // TAG CRÍTICO: Indica a ToolsSelection y ToolsGizmo que es seleccionable a pesar de no ser un GameEntity
                  Tags.AddTagsTo(node, "editor_only cinematic_proxy");
                  Tags.AddTagsTo(lens, "editor_only cinematic_proxy");
                  
                  node.position.set(clip.startPosition?.x||0, clip.startPosition?.y||0, clip.startPosition?.z||0);
                  const rx = (clip.startRotation?.x||0) * Math.PI/180;
                  const ry = (clip.startRotation?.y||0) * Math.PI/180;
                  const rz = (clip.startRotation?.z||0) * Math.PI/180;
                  node.rotation.set(rx, ry, rz);

                  this.cameraProxies.push(node);
              });
          }
      });
  }

  private limpiarCamarasProxy(): void {
      this.cameraProxies.forEach(p => p.dispose());
      this.cameraProxies = [];
  }

  cargarClipsDelObjeto() {
    const obj = this.editorSvc.objetoSeleccionado() as Mesh;
    const entity = this.entityManager.getEntityByMesh(obj);

    if (!entity) {
      this.sequences = [];
      this.selectedSequenceId = null;
      return;
    }
    
    this.esPersonaje = !!entity.characterConfig;
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
    if (entity.animationNames && Array.isArray(entity.animationNames)) rawClips.push(...entity.animationNames);

    this.motor3dSvc.getScene().meshes.forEach(m => {
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
      }
    });
  }

  guardarObjetoActualComoPrefab() {}

  instanciarPrefab(prefab: any) {
    let camTarget = new Vector3(0, 1, 0);
    if (this.motor3dSvc.getEditorCamera() && typeof this.motor3dSvc.getEditorCamera().getTarget === 'function') {
      camTarget = this.motor3dSvc.getEditorCamera().getTarget().clone();
    }
    this.editorSvc.instanciarPrefabFull(prefab, camTarget);
  }

  eliminarPrefab(id: number) {
    if (confirm('¿Seguro que deseas eliminar este Prefab global de la base de datos?')) {
      this.api.eliminarPrefab(id).subscribe({
        next: () => this.cargarPrefabs()
      });
    }
  }

  cargarPlataformaLogic() {
    const sceneData = this.editorSvc.escenaActualData();
    if (!sceneData || !sceneData.scene) return;

    const logic = sceneData.scene.environmentSettings?.logicSettings || {};
    this.platformLogic = {
      initialVariables: Array.isArray(logic.initialVariables) ? logic.initialVariables : [],
      objetivosLocales: Array.isArray(logic.objetivosLocales) ? logic.objetivosLocales.join('\n') : (logic.objetivosLocales || ''),
      recompensasLocales: Array.isArray(logic.recompensasLocales) ? logic.recompensasLocales.join('\n') : (logic.recompensasLocales || '')
    };

    this.cdr.detectChanges();
  }

  agregarVariableInicial() {
    this.platformLogic.initialVariables.push({ key: '', value: '' });
    this.persistPlatformLogic();
  }

  quitarVariableInicial(i: number) {
    this.platformLogic.initialVariables.splice(i, 1);
    this.persistPlatformLogic();
  }

  persistPlatformLogic() {
    const w = this.worldSettingsSvc.settings();
    const env = { ...w, logicSettings: { ...this.platformLogic } };
    (this.worldSettingsSvc as any).settings.set(env);
    this.editorSvc.triggerUpdate(); 
  }

  get currentCinematic() { return this.cinematics.find(c => c.id === this.selectedCinematicId) || null; }
  get currentTrack() { return this.currentCinematic?.tracks[this.selectedTrackIndex] || null; }
  
  get currentCinematicClip() { 
      const clip = this.currentTrack?.clips[this.selectedClipIndex] || null; 
      if (clip) {
          if (!clip.startPosition) clip.startPosition = {x:0, y:0, z:0};
          if (!clip.endPosition) clip.endPosition = {x:0, y:0, z:0};
          if (!clip.startRotation) clip.startRotation = {x:0, y:0, z:0};
          if (!clip.endRotation) clip.endRotation = {x:0, y:0, z:0};
      }
      return clip;
  }

  persistCinematics() {
    this.editorSvc.triggerUpdate(); 
  }

  seleccionarCinematica(id: string) {
    if (this.isInsideCamera) this.salirCamara();
    this.selectedCinematicId = id;
    this.selectedTrackIndex = -1;
    this.selectedClipIndex = -1;
    this.cinematicPlayhead = 0;
    if (this.cinematicIsPlaying) this.stopCinematic();
    this.dibujarCamarasProxy();
  }

  copiarId(id: string) {
    navigator.clipboard.writeText(id);
    alert('ID de cinemática copiado: ' + id);
  }

  nuevaCinematica() {
    const cin: CinematicSequence = {
      id: 'cin_' + Math.random().toString(36).substr(2, 6),
      name: 'Cinemática ' + (this.cinematics.length + 1),
      durationMs: 5000,
      tracks: []
    };
    this.cinematicSvc.cinematics.update(v => [...v, cin]);
    this.selectedCinematicId = cin.id;
    this.persistCinematics();
  }

  eliminarCinematica(id: string) {
    this.cinematicSvc.deletedCinematics.push(id);
    this.cinematicSvc.cinematics.update(v => v.filter(c => c.id !== id));
    this.selectedCinematicId = this.cinematics.length > 0 ? this.cinematics[0].id : null;
    this.persistCinematics();
    this.dibujarCamarasProxy();
  }

  agregarTrack(cin: CinematicSequence) {
      cin.tracks.push({
          id: 'trk_' + Math.random().toString(36).substr(2,6),
          name: 'Nueva Pista',
          type: 'camera',
          clips: []
      });
      this.persistCinematics();
  }
  
  quitarTrack(cin: CinematicSequence, index: number) {
      cin.tracks.splice(index, 1);
      this.selectedTrackIndex = -1;
      this.selectedClipIndex = -1;
      this.persistCinematics();
  }

  agregarClip(track: CinematicTrack) {
      track.clips.push({
         id: 'clip_' + Math.random().toString(36).substr(2,6),
         startTimeMs: 0,
         durationMs: 2000,
         easing: 'easeInOut',
         startPosition: {x:0, y:0, z:0},
         endPosition: {x:0, y:0, z:0},
         startRotation: {x:0, y:0, z:0},
         endRotation: {x:0, y:0, z:0},
         fadeMode: 'none'
      });
      this.persistCinematics();
      this.dibujarCamarasProxy();
  }

  seleccionarClip(tIdx: number, cIdx: number) {
     this.selectedTrackIndex = tIdx;
     this.selectedClipIndex = cIdx;
     
     const track = this.currentCinematic?.tracks[tIdx];
     if (track) {
         const clip = track.clips[cIdx];
         if (clip) {
             if (!clip.startPosition) clip.startPosition = {x:0, y:0, z:0};
             if (!clip.endPosition) clip.endPosition = {x:0, y:0, z:0};
             if (!clip.startRotation) clip.startRotation = {x:0, y:0, z:0};
             if (!clip.endRotation) clip.endRotation = {x:0, y:0, z:0};
             
             // 🔥 Enfocar suavemente cuando seleccionamos un clip de cámara en el editor
             if (track.type === 'camera' && !this.isInsideCamera) {
                 this.enfocarCamara();
                 
                 // Seleccionamos visualmente el Proxy para mostrar sus Gizmos
                 const proxyMesh = this.motor3dSvc.getScene().getMeshByName(`proxy_cam_${clip.id}`);
                 if (proxyMesh) this.editorSvc.seleccionarObjeto(proxyMesh);
             }
         }
     }
  }

  quitarClip() {
      if (this.currentTrack && this.selectedClipIndex >= 0) {
          this.currentTrack.clips.splice(this.selectedClipIndex, 1);
          this.selectedClipIndex = -1;
          this.persistCinematics();
          this.dibujarCamarasProxy();
      }
  }

  togglePlayCinematic() {
    const cin = this.currentCinematic;
    if (!cin) return;
    
    if (this.cinematicIsPlaying) {
      this.cinematicDirector.pause();
      this.cinematicIsPlaying = false;
      clearInterval(this.cinematicTimer);
    } else {
      const errors = this.cinematicSvc.validateCinematic(cin);
      if (errors.length > 0) {
         alert("Errores en la cinemática:\n" + errors.join('\n'));
         return;
      }
      
      // 🔥 Aseguramos la preferencia de visualización: si estoy dentro de la cámara, quiero secuestrar la visión. Si no, quiero observar.
      this.cinematicDirector.editorWantsCamera = this.isInsideCamera;

      this.cinematicDirector.play(cin);
      this.cinematicDirector.seek(this.cinematicPlayhead);
      this.cinematicIsPlaying = true;
      
      this.cinematicTimer = setInterval(() => {
         this.cinematicPlayhead = this.cinematicDirector.currentTimeMs;
         if (!this.cinematicDirector.isPlaying) {
             this.cinematicIsPlaying = false;
             clearInterval(this.cinematicTimer);
         }
         this.cdr.detectChanges();
      }, 16);
    }
  }

  stopCinematic() {
    this.cinematicDirector.stop();
    this.cinematicIsPlaying = false;
    this.cinematicPlayhead = 0;
    clearInterval(this.cinematicTimer);
    this.cdr.detectChanges();
  }

  getTimelineMarks(durationMs: number): number[] {
    const marks = [];
    const step = 1000; 
    for (let i = 0; i <= durationMs; i += step) {
      marks.push(i);
    }
    return marks;
  }

  onTimelineMouseDown(event: MouseEvent, durationMs: number) {
    this.isScrubbing = true;
    this.updateScrub(event, durationMs);
  }

  @HostListener('window:mousemove', ['$event'])
  onTimelineMouseMove(event: MouseEvent) {
    if (this.isScrubbing && this.currentCinematic) {
      this.updateScrub(event, this.currentCinematic.durationMs);
    }
  }

  @HostListener('window:mouseup')
  onTimelineMouseUp() {
    this.isScrubbing = false;
  }

  updateScrub(event: MouseEvent, durationMs: number) {
    const el = document.querySelector('.timeline-ruler') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    this.cinematicPlayhead = percent * durationMs;
    this.cinematicDirector.seek(this.cinematicPlayhead);
    this.motor3dSvc.getScene().render();
  }

  // 🔥 Controles Directos de Editor a Cámara
  enfocarCamara() {
     const clip = this.currentCinematicClip;
     if (clip && clip.startPosition) {
         const pos = new Vector3(clip.startPosition.x, clip.startPosition.y, clip.startPosition.z);
         this.cameraSvc.enfocarCoordenadas(pos, 4);
     }
  }

  entrarCamara() {
     const clip = this.currentCinematicClip;
     if (clip && clip.startPosition && clip.startRotation) {
         this.isInsideCamera = true;
         this.cinematicDirector.editorWantsCamera = true;
         
         const pos = new Vector3(clip.startPosition.x, clip.startPosition.y, clip.startPosition.z);
         const rot = new Vector3(clip.startRotation.x * Math.PI/180, clip.startRotation.y * Math.PI/180, clip.startRotation.z * Math.PI/180);
         
         this.cameraSvc.transicionACamaraCinematica(pos, rot, clip.startFov, () => {
             // Secuestra control temporal
             this.cameraSvc.entrarCamaraFija(pos, rot, clip.startFov);
         });
     }
  }

  salirCamara() {
     this.isInsideCamera = false;
     this.cinematicDirector.editorWantsCamera = false;
     
     const editorCam = this.motor3dSvc.getEditorCamera();
     this.cameraSvc.transicionDesdeCamaraCinematica(editorCam, () => {
         this.cameraSvc.salirCamaraFija();
     });
  }

  capturarPosRot(targetClip: CinematicClip, isStart: boolean) {
    if (!targetClip) return;
    
    let pos = {x:0, y:0, z:0};
    let rot = {x:0, y:0, z:0};

    if (this.currentTrack?.type === 'camera') {
        const cam = this.motor3dSvc.getEditorCamera();
        if (cam) {
           let globalPos = cam.globalPosition;
           
           if (targetClip.useLocalSpaceUid) {
               const baseEntity = this.entityManager.getEntityByUid(targetClip.useLocalSpaceUid);
               if (baseEntity && baseEntity.view) {
                   const inv = Matrix.Invert(baseEntity.view.getWorldMatrix());
                   const localPos = Vector3.TransformCoordinates(globalPos, inv);
                   pos = {x: localPos.x, y: localPos.y, z: localPos.z};
               }
           } else {
               pos = {x: globalPos.x, y: globalPos.y, z: globalPos.z};
           }

           const dir = cam.getDirection(Vector3.Forward());
           const yaw = Math.atan2(dir.x, dir.z);
           const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x*dir.x + dir.z*dir.z));
           rot = {x: pitch * 180 / Math.PI, y: yaw * 180 / Math.PI, z: 0};
        }
    } else if (this.currentTrack?.type === 'actor') {
        const entity = this.entityManager.getEntityByUid(this.currentTrack.targetUid || '');
        if (entity && entity.view) {
           pos = {x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z};
           rot = {x: entity.transform.rotation.x * 180 / Math.PI, y: entity.transform.rotation.y * 180 / Math.PI, z: entity.transform.rotation.z * 180 / Math.PI};
        }
    }

    if (isStart) {
        targetClip.startPosition = pos;
        targetClip.startRotation = rot;
    } else {
        targetClip.endPosition = pos;
        targetClip.endRotation = rot;
    }
    this.persistCinematics();
    this.dibujarCamarasProxy(); // Actualiza proxies al guardar
  }
}