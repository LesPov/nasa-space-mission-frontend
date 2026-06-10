import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { HistorialService } from '../../services/historial.service';
import { Motor3dService } from '../../services/motor-3d.service';
import {
  Node,
  AbstractMesh,
  Camera,
  Light,
  AnimationGroup,
  Quaternion,
  Vector3
} from '@babylonjs/core';
import { Subscription } from 'rxjs';
import {
  cloneDefaultPlayerConfig,
  mergePlayerConfig,
  normalizeAnimBinding,
  createPlayerSequence,
  createSequenceStep,
  PlayerRuntimeConfig,
  PlayerActionKey,
  PlayerClipSequence,
  PlayerSequenceStep
} from '../../services/editor/player-config.model';

interface ActionRow {
  key: PlayerActionKey;
  label: string;
  family: string;
  keywords: string[];
  help: string;
}

interface ClipViewModel {
  name: string;
  group: AnimationGroup;
  targetCount: number;
  speedRatio: number;
  loop: boolean;
  playing: boolean;
}

const ACTION_ROWS: ActionRow[] = [
  { key: 'idle', label: 'Idle', family: 'Movimiento base', keywords: ['idle'], help: 'Reposo / espera' },
  { key: 'walk', label: 'Walk', family: 'Movimiento base', keywords: ['walk'], help: 'Caminar' },
  { key: 'run', label: 'Run', family: 'Movimiento base', keywords: ['run'], help: 'Correr' },

  { key: 'jumpStart', label: 'Jump Start', family: 'Aire', keywords: ['jump start', 'jump_begin', 'jump'], help: 'Inicio del salto' },
  { key: 'jumpLoop', label: 'Jump Loop', family: 'Aire', keywords: ['jump loop', 'jump'], help: 'Fase en el aire' },
  { key: 'fall', label: 'Fall', family: 'Aire', keywords: ['fall', 'falling'], help: 'Caída' },
  { key: 'landSoft', label: 'Land Soft', family: 'Aire', keywords: ['land', 'soft landing'], help: 'Aterrizaje suave' },
  { key: 'landHard', label: 'Land Hard', family: 'Aire', keywords: ['hard landing'], help: 'Aterrizaje fuerte' },
  { key: 'recover', label: 'Recover', family: 'Aire', keywords: ['recover', 'recovery'], help: 'Recuperación' },

  { key: 'climbUp', label: 'Climb Up', family: 'Escalada', keywords: ['climb up', 'climb'], help: 'Subida inicial' },
  { key: 'hangIdle', label: 'Hang Idle', family: 'Escalada', keywords: ['hang idle', 'hang'], help: 'Colgado del borde' },
  { key: 'climbFinish', label: 'Climb Finish', family: 'Escalada', keywords: ['climb finish', 'pull up'], help: 'Terminar de subir' },
  { key: 'vault', label: 'Vault', family: 'Escalada', keywords: ['vault'], help: 'Impulso / salto corto' },
  { key: 'stepUp', label: 'Step Up', family: 'Escalada', keywords: ['step up', 'step'], help: 'Subir escalón' }
];

@Component({
  selector: 'app-inspector-escena',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspector-escena.html',
  styleUrl: './inspector-escena.css'
})
export class InspectorEscena implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);

  private _pestanaActiva: string = 'transform';
  get pestanaActiva() { return this._pestanaActiva; }
  set pestanaActiva(val: string) { this._pestanaActiva = val; }

  private subs: Subscription[] = [];
  public nodosExpandidos = new Set<string>();

  // Transformación
  localPosX = 0;
  localPosY = 0;
  localPosZ = 0;
  localRotX = 0;
  localRotY = 0;
  localRotZ = 0;
  localEscX = 1;
  localEscY = 1;
  localEscZ = 1;

  // Collider / cámara
  colliderType: string = 'mesh';
  colliderSizeX = 0.5;
  colliderSizeY = 0.5;
  colliderSizeZ = 0.5;
  colliderOffX = 0;
  colliderOffY = 0;
  colliderOffZ = 0;

  camPosX = 0;
  camPosY = 1.6;
  camPosZ = 0;

  // Player config
  public playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();
  public actionRows: ActionRow[] = ACTION_ROWS;

  public bindingInputs: Record<PlayerActionKey, string> = this.emptyBindingInputs();
  public bindingTokens: Record<PlayerActionKey, string[]> = this.emptyBindingTokens();

  public selectedAssignAction: PlayerActionKey = 'idle';

  // Animaciones
  public animationClips: ClipViewModel[] = [];
  public clipFilter = '';
  public animStatus = '';

  // Secuencias
  public sequences: PlayerClipSequence[] = [];
  public selectedSequenceId: string | null = null;
  public selectedStepIndex: number = -1;

  constructor() {
    effect(() => {
      const obj = this.editorSvc.objetoSeleccionado();
      if (obj) this.syncFromSelection(obj as AbstractMesh);
      else this.resetInspectorState();
      this.cdr.detectChanges();
    });
  }

  ngOnInit() {
    const refrescar = () => {
      const obj = this.editorSvc.objetoSeleccionado();
      if (obj) this.syncFromSelection(obj as AbstractMesh);
      this.cdr.detectChanges();
    };

    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(refrescar),
      this.editorSvc.onMapChanged.subscribe(refrescar)
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  get objetoActual() {
    return this.editorSvc.objetoSeleccionado() as any;
  }

  get listaNodos() {
    return this.editorSvc.nodosEscena();
  }

  get currentSequence(): PlayerClipSequence | null {
    return this.sequences.find(s => s.id === this.selectedSequenceId) || null;
  }

  private emptyBindingInputs(): Record<PlayerActionKey, string> {
    return ACTION_ROWS.reduce((acc, row) => {
      acc[row.key] = '';
      return acc;
    }, {} as Record<PlayerActionKey, string>);
  }

  private emptyBindingTokens(): Record<PlayerActionKey, string[]> {
    return ACTION_ROWS.reduce((acc, row) => {
      acc[row.key] = [];
      return acc;
    }, {} as Record<PlayerActionKey, string[]>);
  }

  private formatNum(val: number): number {
    return parseFloat(Number(val || 0).toFixed(3));
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  private resetInspectorState() {
    this.localPosX = 0;
    this.localPosY = 0;
    this.localPosZ = 0;
    this.localRotX = 0;
    this.localRotY = 0;
    this.localRotZ = 0;
    this.localEscX = 1;
    this.localEscY = 1;
    this.localEscZ = 1;

    this.colliderType = 'mesh';
    this.colliderSizeX = 0.5;
    this.colliderSizeY = 0.5;
    this.colliderSizeZ = 0.5;
    this.colliderOffX = 0;
    this.colliderOffY = 0;
    this.colliderOffZ = 0;

    this.camPosX = 0;
    this.camPosY = 1.6;
    this.camPosZ = 0;

    this.playerConfig = cloneDefaultPlayerConfig();
    this.bindingInputs = this.emptyBindingInputs();
    this.bindingTokens = this.emptyBindingTokens();
    this.animationClips = [];
    this.sequences = [];
    this.selectedSequenceId = null;
    this.selectedStepIndex = -1;
    this.animStatus = '';
  }

  private isPlayerLike(obj: any): boolean {
    if (!obj || !(obj instanceof AbstractMesh)) return false;
    return obj.metadata?.type === 'model' || obj.metadata?.rol === 'npc' || obj.metadata?.rol === 'spawn_point';
  }

  private getSelectedMesh(): AbstractMesh | null {
    const obj = this.editorSvc.objetoSeleccionado();
    if (!obj || !(obj instanceof AbstractMesh)) return null;
    return obj;
  }

  private getAvailableAnimationGroups(obj: AbstractMesh): AnimationGroup[] {
    const scene = this.motor3dSvc.scene;
    const names: string[] = Array.isArray(obj.metadata?.animationNames) ? obj.metadata.animationNames : [];

    let groups: AnimationGroup[] = [];
    if (names.length > 0) {
      groups = scene.animationGroups.filter(ag => names.includes(ag.name));
    }

    if (groups.length === 0) {
      groups = scene.animationGroups.filter((ag: AnimationGroup) =>
        ag.targetedAnimations.some((ta: any) => ta.target === obj || ta.target?.parent === obj)
      );
    }

    return groups;
  }

  private syncBindingDraftsFromConfig() {
    for (const action of this.actionRows) {
      const value = this.playerConfig.animations[action.key];
      const tokens = normalizeAnimBinding(value);
      this.bindingTokens[action.key] = [...tokens];
      this.bindingInputs[action.key] = tokens.join(', ');
    }
  }

  private syncClipsFromObject(obj: AbstractMesh) {
    const metaRuntime = obj.metadata?.playerConfig?.animationRuntime || {};
    const groups = this.getAvailableAnimationGroups(obj);

    this.animationClips = groups.map(group => {
      const runtime = metaRuntime?.[group.name] || {};
      const speedRatio = typeof runtime.speedRatio === 'number' ? runtime.speedRatio : (group.speedRatio ?? 1);
      const loop = typeof runtime.loop === 'boolean' ? runtime.loop : true;

      group.speedRatio = speedRatio;

      return {
        name: group.name,
        group,
        targetCount: group.targetedAnimations?.length ?? 0,
        speedRatio,
        loop,
        playing: !!group.isPlaying
      };
    });
  }

  private syncSequencesFromConfig() {
    this.sequences = Array.isArray(this.playerConfig.sequences)
      ? this.cloneJson(this.playerConfig.sequences)
      : [];

    if (!this.selectedSequenceId && this.sequences.length > 0) {
      this.selectedSequenceId = this.sequences[0].id;
    }

    if (this.selectedSequenceId && !this.sequences.some(s => s.id === this.selectedSequenceId)) {
      this.selectedSequenceId = this.sequences.length > 0 ? this.sequences[0].id : null;
    }

    if (this.currentSequence && this.selectedStepIndex >= this.currentSequence.steps.length) {
      this.selectedStepIndex = this.currentSequence.steps.length - 1;
    }

    if (!this.currentSequence) {
      this.selectedStepIndex = -1;
    }
  }

  private syncFromSelection(obj: AbstractMesh) {
    this.syncTransformFromBabylon(obj);

    const meta = obj.metadata || {};
    this.playerConfig = mergePlayerConfig(meta.playerConfig || null);
    this.syncBindingDraftsFromConfig();
    this.syncClipsFromObject(obj);
    this.syncSequencesFromConfig();

    this.animStatus = this.isPlayerLike(obj) ? 'Player listo para editar' : 'Objeto seleccionado';
  }

  private syncTransformFromBabylon(obj: any) {
    if (!obj || !obj.position) return;

    this.localPosX = this.formatNum(obj.position.x);
    this.localPosY = this.formatNum(obj.position.y);
    this.localPosZ = this.formatNum(obj.position.z);

    if (obj.rotationQuaternion) {
      const euler = obj.rotationQuaternion.toEulerAngles();
      this.localRotX = this.formatNum(euler.x * (180 / Math.PI));
      this.localRotY = this.formatNum(euler.y * (180 / Math.PI));
      this.localRotZ = this.formatNum(euler.z * (180 / Math.PI));
    } else {
      this.localRotX = this.formatNum(obj.rotation.x * (180 / Math.PI));
      this.localRotY = this.formatNum(obj.rotation.y * (180 / Math.PI));
      this.localRotZ = this.formatNum(obj.rotation.z * (180 / Math.PI));
    }

    if (obj.scaling) {
      this.localEscX = this.formatNum(obj.scaling.x);
      this.localEscY = this.formatNum(obj.scaling.y);
      this.localEscZ = this.formatNum(obj.scaling.z);
    }

    const col = obj.metadata?.collider;
    if (col) {
      this.colliderType = col.type || 'box';
      this.colliderSizeX = this.formatNum(col.sizeX ?? 0.5);
      this.colliderSizeY = this.formatNum(col.sizeY ?? 0.5);
      this.colliderSizeZ = this.formatNum(col.sizeZ ?? 0.5);
      this.colliderOffX = this.formatNum(col.offsetX ?? 0);
      this.colliderOffY = this.formatNum(col.offsetY ?? 0);
      this.colliderOffZ = this.formatNum(col.offsetZ ?? 0);
    }

    const camOffset = obj.metadata?.camOffset;
    if (camOffset) {
      this.camPosX = this.formatNum(camOffset.x);
      this.camPosY = this.formatNum(camOffset.y);
      this.camPosZ = this.formatNum(camOffset.z);
    }
  }

  private ensureMetadata(obj: AbstractMesh): any {
    if (!obj.metadata) obj.metadata = {};
    if (!obj.metadata.playerConfig) obj.metadata.playerConfig = cloneDefaultPlayerConfig();
    return obj.metadata;
  }

  private persistPlayerConfig(obj: AbstractMesh) {
    const meta = this.ensureMetadata(obj);
    meta.playerConfig = this.cloneJson(this.playerConfig);
    meta.playerConfig.animationRuntime ||= {};
    meta.animationNames = this.animationClips.map(c => c.name);
    this.editorSvc.triggerUpdate();
  }

  private persistAnimationRuntime(obj: AbstractMesh) {
    const meta = this.ensureMetadata(obj);
    meta.playerConfig = this.cloneJson(this.playerConfig);
    meta.playerConfig.animationRuntime ||= {};

    for (const clip of this.animationClips) {
      meta.playerConfig.animationRuntime[clip.name] = {
        speedRatio: clip.speedRatio,
        loop: clip.loop
      };
      clip.group.speedRatio = clip.speedRatio;
    }

    meta.animationNames = this.animationClips.map(c => c.name);
    this.editorSvc.triggerUpdate();
  }

  private persistSequences(obj: AbstractMesh) {
    const meta = this.ensureMetadata(obj);
    this.playerConfig.sequences = this.cloneJson(this.sequences);
    meta.playerConfig = this.cloneJson(this.playerConfig);
    meta.animationNames = this.animationClips.map(c => c.name);
    this.editorSvc.triggerUpdate();
  }

  aplicarPosicion() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.historialSvc.registrarCambioTransform(obj, () => {
      obj.position.set(this.localPosX, this.localPosY, this.localPosZ);
    });

    this.editorSvc.triggerUpdate();
  }

  aplicarRotacion() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    const rx = this.localRotX * (Math.PI / 180);
    const ry = this.localRotY * (Math.PI / 180);
    const rz = this.localRotZ * (Math.PI / 180);

    this.historialSvc.registrarCambioTransform(obj, () => {
      obj.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
      obj.rotation.set(0, 0, 0);
    });

    this.editorSvc.triggerUpdate();
  }

  aplicarEscala() {
    const obj = this.getSelectedMesh();
    if (!obj || !obj.scaling) return;

    this.historialSvc.registrarCambioTransform(obj, () => {
      obj.scaling.set(this.localEscX, this.localEscY, this.localEscZ);
    });

    this.editorSvc.triggerUpdate();
  }

  aplicarCollider() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    if (!obj.metadata) obj.metadata = {};
    obj.metadata.collider = {
      type: this.colliderType,
      sizeX: this.colliderSizeX,
      sizeY: this.colliderSizeY,
      sizeZ: this.colliderSizeZ,
      offsetX: this.colliderOffX,
      offsetY: this.colliderOffY,
      offsetZ: this.colliderOffZ
    };

    if (this.colliderType !== 'mesh') {
      obj.ellipsoid = new Vector3(
        this.colliderSizeX * obj.scaling.x,
        this.colliderSizeY * obj.scaling.y,
        this.colliderSizeZ * obj.scaling.z
      );
      obj.ellipsoidOffset = new Vector3(
        this.colliderOffX * obj.scaling.x,
        this.colliderOffY * obj.scaling.y,
        this.colliderOffZ * obj.scaling.z
      );
    }

    if (this.colliderType === 'mesh' && this.editorSvc.subObjetoSeleccionado() === 'collider') {
      this.editorSvc.subObjetoSeleccionado.set(null);
    }

    this.editorSvc.triggerUpdate();
  }

  aplicarCamara() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    if (!obj.metadata) obj.metadata = {};
    obj.metadata.camOffset = { x: this.camPosX, y: this.camPosY, z: this.camPosZ };

    this.editorSvc.triggerUpdate();
  }

  aplicarPlayerConfig() {
    const obj = this.getSelectedMesh();
    if (!obj) return;
    this.persistPlayerConfig(obj);
  }

  cambiarHabilitadoAnim(actionKey: PlayerActionKey, value: boolean) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.playerConfig.animationEnabled[actionKey] = value;
    this.persistPlayerConfig(obj);
    this.animStatus = `${actionKey} ${value ? 'activada' : 'desactivada'}`;
  }

  restaurarPlayerConfigDefault() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.playerConfig = cloneDefaultPlayerConfig();
    this.bindingInputs = this.emptyBindingInputs();
    this.bindingTokens = this.emptyBindingTokens();
    this.syncBindingDraftsFromConfig();
    this.syncSequencesFromConfig();
    this.persistPlayerConfig(obj);
    this.animStatus = 'Player config restaurado a valores base';
  }

  private normalizeList(raw: string): string[] {
    return raw.split(',').map(v => v.trim()).filter(Boolean);
  }

  agregarBinding(actionKey: PlayerActionKey) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    const raw = (this.bindingInputs[actionKey] || '').trim();
    if (!raw) return;

    const incoming = this.normalizeList(raw);
    const current = new Set(this.bindingTokens[actionKey] || []);
    for (const token of incoming) current.add(token);

    this.bindingTokens[actionKey] = Array.from(current);
    this.bindingInputs[actionKey] = '';
    this.playerConfig.animations[actionKey] = this.bindingTokens[actionKey].length > 0 ? [...this.bindingTokens[actionKey]] : null;
    this.persistPlayerConfig(obj);
    this.animStatus = `Binding agregado a ${actionKey}`;
  }

  quitarBinding(actionKey: PlayerActionKey, index: number) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    const tokens = [...(this.bindingTokens[actionKey] || [])];
    tokens.splice(index, 1);

    this.bindingTokens[actionKey] = tokens;
    this.playerConfig.animations[actionKey] = tokens.length > 0 ? [...tokens] : null;
    this.persistPlayerConfig(obj);
  }

  aplicarBinding(actionKey: PlayerActionKey) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    const raw = (this.bindingInputs[actionKey] || '').trim();
    if (!raw) {
      this.bindingTokens[actionKey] = [];
      this.playerConfig.animations[actionKey] = null;
      this.persistPlayerConfig(obj);
      return;
    }

    const parts = this.normalizeList(raw);
    const unique = Array.from(new Set(parts));

    this.bindingTokens[actionKey] = unique;
    this.playerConfig.animations[actionKey] = unique.length <= 1 ? (unique[0] || null) : unique;
    this.persistPlayerConfig(obj);
  }

  aplicarTodosLosBindings() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    for (const row of this.actionRows) {
      const raw = (this.bindingInputs[row.key] || '').trim();
      const tokens = this.normalizeList(raw);
      const unique = Array.from(new Set(tokens));

      this.bindingTokens[row.key] = unique;
      this.playerConfig.animations[row.key] = unique.length <= 1 ? (unique[0] || null) : unique;
    }

    this.persistPlayerConfig(obj);
    this.animStatus = 'Bindings actualizados';
  }

  limpiarBinding(actionKey: PlayerActionKey) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.bindingInputs[actionKey] = '';
    this.bindingTokens[actionKey] = [];
    this.playerConfig.animations[actionKey] = null;
    this.persistPlayerConfig(obj);
  }

  usarClipComoBinding(actionKey: PlayerActionKey, clipName: string) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    const current = new Set(this.bindingTokens[actionKey] || []);
    current.add(clipName);

    this.bindingTokens[actionKey] = Array.from(current);
    this.bindingInputs[actionKey] = '';
    this.playerConfig.animations[actionKey] = [...this.bindingTokens[actionKey]];
    this.persistPlayerConfig(obj);
    this.animStatus = `Asignado ${clipName} a ${actionKey}`;
  }

  getBindingText(actionKey: PlayerActionKey): string {
    const tokens = this.bindingTokens[actionKey] || [];
    return tokens.length ? tokens.join(', ') : 'Sin asignar';
  }

  actionBadge(actionKey: PlayerActionKey): string {
    const tokens = this.bindingTokens[actionKey] || [];
    return tokens.length ? `activo · ${tokens.length}` : 'vacío';
  }

  detectarBindingsAutomaticamente() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    for (const action of this.actionRows) {
      const current = new Set(this.bindingTokens[action.key] || []);

      for (const clip of this.animationClips) {
        const name = clip.name.toLowerCase();
        const match =
          action.key === 'jumpStart' ? ['jump start', 'jump_begin', 'jump'] :
          action.key === 'jumpLoop' ? ['jump loop', 'jump'] :
          action.key === 'landHard' ? ['hard landing'] :
          action.key === 'landSoft' ? ['land', 'soft landing'] :
          action.key === 'climbUp' ? ['climb up', 'climb'] :
          action.key === 'climbFinish' ? ['climb finish', 'pull up'] :
          action.key === 'hangIdle' ? ['hang idle', 'hang'] :
          action.key === 'stepUp' ? ['step up', 'step'] :
          action.key === 'vault' ? ['vault'] :
          [action.key];

        if (match.some(term => name.includes(term))) {
          current.add(clip.name);
        }
      }

      this.bindingTokens[action.key] = Array.from(current);
      this.playerConfig.animations[action.key] = this.bindingTokens[action.key].length > 0
        ? [...this.bindingTokens[action.key]]
        : null;
    }

    this.persistPlayerConfig(obj);
    this.animStatus = 'Bindings detectados automáticamente';
  }

  syncAnimationEnabledToConfig(actionKey: PlayerActionKey, value: boolean) {
    this.cambiarHabilitadoAnim(actionKey, value);
  }

  getBindingCount(actionKey: PlayerActionKey): number {
    return (this.bindingTokens[actionKey] || []).length;
  }

  // =========================================================
  // SECUENCIAS
  // =========================================================
  seleccionarSecuencia(seq: PlayerClipSequence) {
    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = seq.steps.length > 0 ? 0 : -1;
    this.animStatus = `Secuencia seleccionada: ${seq.name}`;
  }

  nuevaSecuencia() {
    const seq = createPlayerSequence(`Secuencia ${this.sequences.length + 1}`);
    this.sequences = [...this.sequences, seq];
    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = 0;
    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
    this.animStatus = `Nueva secuencia creada: ${seq.name}`;
  }

  duplicarSecuencia(seq: PlayerClipSequence) {
    const copy: PlayerClipSequence = {
      ...this.cloneJson(seq),
      id: crypto.randomUUID(),
      name: `${seq.name} copia`
    };

    this.sequences = [...this.sequences, copy];
    this.selectedSequenceId = copy.id;
    this.selectedStepIndex = copy.steps.length > 0 ? 0 : -1;
    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
    this.animStatus = `Secuencia duplicada: ${copy.name}`;
  }

  eliminarSecuencia(seqId: string) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.sequences = this.sequences.filter(s => s.id !== seqId);
    if (this.selectedSequenceId === seqId) {
      this.selectedSequenceId = this.sequences[0]?.id || null;
      this.selectedStepIndex = this.currentSequence ? 0 : -1;
    }

    this.persistSequences(obj);
    this.animStatus = 'Secuencia eliminada';
  }

  moverSecuencia(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= this.sequences.length) return;

    const arr = [...this.sequences];
    const [item] = arr.splice(index, 1);
    arr.splice(target, 0, item);
    this.sequences = arr;

    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
  }

  agregarPaso(seq: PlayerClipSequence) {
    seq.steps.push(createSequenceStep('walk'));
    this.selectedStepIndex = seq.steps.length - 1;
    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
    this.animStatus = 'Paso agregado';
  }

  duplicarPaso(seq: PlayerClipSequence, index: number) {
    const original = seq.steps[index];
    if (!original) return;

    const copy: PlayerSequenceStep = {
      ...this.cloneJson(original),
      id: crypto.randomUUID()
    };

    seq.steps.splice(index + 1, 0, copy);
    this.selectedStepIndex = index + 1;

    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
    this.animStatus = 'Paso duplicado';
  }

  quitarPaso(seq: PlayerClipSequence, index: number) {
    if (!seq.steps[index]) return;
    seq.steps.splice(index, 1);

    if (this.selectedStepIndex >= seq.steps.length) {
      this.selectedStepIndex = seq.steps.length - 1;
    }

    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
    this.animStatus = 'Paso eliminado';
  }

  moverPaso(seq: PlayerClipSequence, index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= seq.steps.length) return;

    const arr = [...seq.steps];
    const [item] = arr.splice(index, 1);
    arr.splice(target, 0, item);
    seq.steps = arr;
    this.selectedStepIndex = target;

    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
  }

  actualizarPaso() {
    const obj = this.getSelectedMesh();
    if (!obj || !this.currentSequence) return;
    this.persistSequences(obj);
  }

  crearPasoRapido(action: PlayerActionKey) {
    const seq = this.currentSequence;
    if (!seq) return;

    seq.steps.push({
      ...createSequenceStep(action),
      action
    });
    this.selectedStepIndex = seq.steps.length - 1;
    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
  }

  probarSecuencia(seq: PlayerClipSequence) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = seq.steps.length > 0 ? 0 : -1;

    (this.playerConfig as any).activeSequenceId = seq.id;
    this.persistSequences(obj);

    this.animStatus = `Secuencia lista para probar: ${seq.name}. Pulsa Jugar para verla en vivo.`;
  }

  detenerPreviewSecuencia() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    delete (this.playerConfig as any).activeSequenceId;
    this.persistSequences(obj);
    this.animStatus = 'Vista previa de secuencia detenida';
  }

  guardarSecuencias() {
    const obj = this.getSelectedMesh();
    if (!obj) return;
    this.persistSequences(obj);
    this.animStatus = 'Secuencias guardadas en metadata.playerConfig';
  }

  guardarTodo() {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    this.playerConfig.sequences = this.cloneJson(this.sequences);
    this.persistPlayerConfig(obj);
    this.animStatus = 'Configuración completa guardada';
  }

  // =========================================================
  // NAVEGACIÓN / UI
  // =========================================================
  esSeleccionado(nodo: Node): boolean {
    return this.editorSvc.objetoSeleccionado() === nodo;
  }

  esBloqueado(nodo: Node): boolean {
    return nodo instanceof Camera || nodo instanceof Light;
  }

  toggleExpandir(nodo: Node, event: Event) {
    event.stopPropagation();
    if (this.nodosExpandidos.has(nodo.name)) this.nodosExpandidos.delete(nodo.name);
    else this.nodosExpandidos.add(nodo.name);
  }

  estaExpandido(nodo: Node): boolean {
    return this.nodosExpandidos.has(nodo.name);
  }

  seleccionarSubItem(pestana: string, subObj: 'collider' | 'camera' | null, nodo: Node, event: Event) {
    event.stopPropagation();
    if (this.esBloqueado(nodo)) return;

    this.editorSvc.seleccionarObjeto(nodo);
    this.editorSvc.subObjetoSeleccionado.set(subObj);
    this.pestanaActiva = pestana;
  }

  seleccionarDesdeLista(nodo: Node) {
    if (this.esBloqueado(nodo)) return;
    this.editorSvc.seleccionarObjeto(nodo);
  }

  esSubSeleccionado(nodo: Node, subObj: 'collider' | 'camera'): boolean {
    return this.esSeleccionado(nodo) && this.editorSvc.subObjetoSeleccionado() === subObj;
  }

  esPersonajeOModelo(nodo: Node): boolean {
    if (!nodo || !(nodo as AbstractMesh).metadata) return false;
    const meta = (nodo as AbstractMesh).metadata;
    return meta.type === 'model' || meta.rol === 'npc' || meta.rol === 'spawn_point';
  }

  private getAnimationClipsForNode(nodo: Node): ClipViewModel[] {
    if (!(nodo instanceof AbstractMesh)) return [];
    return this.animationClips;
  }

  tieneAnimaciones(nodo: Node): boolean {
    return this.getAnimationClipsForNode(nodo).length > 0;
  }

  tieneCapsula(nodo: Node): boolean {
    return nodo instanceof AbstractMesh && !!nodo.metadata?.collider;
  }

  tieneCamara(nodo: Node): boolean {
    return this.esPersonajeOModelo(nodo);
  }

  getIcono(nodo: Node): string {
    if (nodo instanceof Camera) return '🎥';
    if (nodo instanceof Light) return '💡';
    if (nodo instanceof AbstractMesh) {
      if (nodo.metadata?.type === 'model') return '🧍';
      if (nodo.name.toLowerCase().includes('cubo')) return '🧊';
      if (nodo.name.toLowerCase().includes('esfera')) return '⚽';
      return '📐';
    }
    return '📌';
  }

  eliminarObjeto() {
    this.editorSvc.eliminarSeleccionado();
  }

  reproducirAnimacion(anim: AnimationGroup) {
    this.detenerAnimaciones();
    anim.reset();
    anim.play(true);
    this.animStatus = `Reproduciendo ${anim.name}`;
  }

  detenerAnimacion(anim: AnimationGroup) {
    anim.stop();
    this.animStatus = `Detenida ${anim.name}`;
  }

  detenerAnimaciones() {
    for (const clip of this.animationClips) {
      clip.group.stop();
      clip.playing = false;
    }
    this.animStatus = 'Todas las animaciones detenidas';
  }

  actualizarRuntimeClip(clip: ClipViewModel) {
    const obj = this.getSelectedMesh();
    if (!obj) return;

    clip.group.speedRatio = clip.speedRatio;
    this.persistAnimationRuntime(obj);
    this.animStatus = `Runtime actualizado: ${clip.name}`;
  }

  refreshClipPlayingFlags() {
    for (const clip of this.animationClips) {
      clip.playing = !!clip.group.isPlaying;
    }
  }

  get animationClipsFiltradas(): ClipViewModel[] {
    const q = this.clipFilter.trim().toLowerCase();
    this.refreshClipPlayingFlags();

    if (!q) return this.animationClips;
    return this.animationClips.filter(c => c.name.toLowerCase().includes(q));
  }

  get familiaResumen(): string {
    const obj = this.getSelectedMesh();
    if (!obj) return 'Sin selección';
    if (this.esPersonajeOModelo(obj)) return 'Personaje / Player';
    return 'Objeto normal';
  }

  get selectedSequence(): PlayerClipSequence | null {
    return this.currentSequence;
  }

  get selectedSequenceLabel(): string {
    return this.currentSequence ? this.currentSequence.name : 'Sin secuencia';
  }

  get sequenceStepCount(): number {
    return this.currentSequence?.steps.length || 0;
  }

  get selectedStep(): PlayerSequenceStep | null {
    if (!this.currentSequence) return null;
    if (this.selectedStepIndex < 0) return null;
    return this.currentSequence.steps[this.selectedStepIndex] || null;
  }

  seleccionarPaso(index: number) {
    this.selectedStepIndex = index;
  }

  actualizarPasoSeleccionado() {
    const obj = this.getSelectedMesh();
    if (!obj || !this.currentSequence || !this.selectedStep) return;
    this.persistSequences(obj);
    this.animStatus = 'Paso actualizado';
  }

  crearSecuenciaBasicaCaminarSaltar() {
    const seq = createPlayerSequence('Caminar y saltar');
    seq.steps = [
      {
        ...createSequenceStep('idle'),
        durationMs: 900,
        allowMovement: false,
        lockInput: false,
        blend: 0.08
      },
      {
        ...createSequenceStep('walk'),
        durationMs: 1200,
        allowMovement: true,
        lockInput: false,
        blend: 0.08
      },
      {
        ...createSequenceStep('jumpStart'),
        durationMs: 500,
        allowMovement: false,
        lockInput: true,
        blend: 0.05
      },
      {
        ...createSequenceStep('fall'),
        durationMs: 900,
        allowMovement: false,
        lockInput: true,
        blend: 0.05
      },
      {
        ...createSequenceStep('landHard'),
        durationMs: 700,
        allowMovement: false,
        lockInput: true,
        blend: 0.08
      },
      {
        ...createSequenceStep('recover'),
        durationMs: 1000,
        allowMovement: false,
        lockInput: true,
        blend: 0.05
      }
    ];

    this.sequences = [...this.sequences, seq];
    this.selectedSequenceId = seq.id;
    this.selectedStepIndex = 0;

    const obj = this.getSelectedMesh();
    if (obj) this.persistSequences(obj);
    this.animStatus = 'Secuencia base creada';
  }
}