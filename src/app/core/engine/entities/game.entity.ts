
import { AbstractMesh, Vector3, Quaternion, StandardMaterial } from '@babylonjs/core';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../models/player-config.model';
import { SeqRuntime } from '../runtime/systems/player-sequence.service';
import { TransformTelemetryService } from '../telemetry/transform-telemetry.service';
import { 
  SelectionRangeComponent, CamOffsetComponent, 
  AnimationNamesComponent, AutoAnimComponent, InitialHeadLocalComponent 
} from './player-sub-components';

export class TransformComponent {
  constructor(
    public position = { x: 0, y: 0, z: 0 }, 
    public rotation = { x: 0, y: 0, z: 0 }, 
    public scale = { x: 1, y: 1, z: 1 },
    public rotationQuaternion?: { x: number, y: number, z: number, w: number } | null
  ) {}
}

export class VisualComponent {
  constructor(
    public color = '#ffffff', public colorBW = '#ffffff', public isSolid = true, 
    public isSelectable = true, public ignoraNiebla = false, public esEmisivo = false, 
    public brilloIntensidad = 1.0, public assetId?: number | null, public path?: string,
    public mostrarBorde: boolean = true,
    public internalScale?: number,
    public ambientColor = '#ffffff',
    public ambientColorBW = '#ffffff'
  ) {}
}

export class PhysicsComponent {
  constructor(public type = 'box', public sizeX = 0.5, public sizeY = 0.5, public sizeZ = 0.5, public offsetX = 0, public offsetY = 0, public offsetZ = 0) {}
}

export class InteractionComponent {
  constructor(
    public mensaje = '', public interactDistanceFPS = 3.0, public interactDistanceTPS = 5.0, 
    public interactSequenceIdFPS = '', public interactSequenceIdTPS = '', 
    public interactSequenceId = '', public respawnTime = 8
  ) {}
}

export class LightComponent {
  constructor(
    public lightColor = '#ffffff', public lightColorBW = '#ffffff', public intensity = 1.0, 
    public range = 50, public angle = 60, public lightPosX = 0, public lightPosY = 0, 
    public lightPosZ = 0, public attachedNodePath = '', public attachedNodeName = '',
    public renderIntensity?: number,
    public enabled: boolean = true,
    public castShadows: boolean = true,
    public lightRotX: number = 0,
    public lightRotY: number = 0,
    public lightRotZ: number = 0
  ) {}
}

export class MediaConfigComponent {
  constructor(
    public videoUrl = '', public imageUrl = '', public profundidadProyeccion = 10, 
    public anguloProyeccion = 0, public proyeccionAncho = 2, public proyeccionAlto = 2, 
    public proyeccionRepeticiones = 1, public proyeccionEspaciado = 2, public proyeccionEje = 'Y', 
    public fadeDistance = 0
  ) {}
}

export class TriggerConfigComponent {
  constructor(
    public isComposite = false, public triggerShape = 'cube', public conditions: string[] = [], 
    public mensajeEntrada = '', public mensajeSalida = '', public soundUrlEntrada = '', 
    public soundUrlSalida = '', public seqEntrada = '', public seqSalida = '', 
    public timeEntrada = 4.5, public timeSalida = 4.5, public videoEntrada = '', 
    public videoSalida = '', public condition = 'on_enter', public mensaje = '', 
    public soundUrl = '', public interactSequenceId = '', public timeNorm = 4.5, 
    public videoNorm = '', public isRepeatable = false, public gameConditions: any[] = [], 
    public stateMutations: any[] = [],
    public actionType: 'show_message' | 'change_scene' = 'show_message',
    public targetSceneId: number | null = null,
    public audioLoopEntrada = false, public audioVolumeEntrada = 0.8, public audioMaxDistEntrada = 50, public audioFadeInEntrada = 1.0,
    public audioProximityEntrada = false, public audioSpatialEntrada = true,
    public audioLoopSalida = false, public audioVolumeSalida = 0.8, public audioMaxDistSalida = 50, public audioFadeInSalida = 1.0,
    public audioProximitySalida = false, public audioSpatialSalida = true,
    public audioLoopNorm = false, public audioVolumeNorm = 0.8, public audioMaxDistNorm = 50, public audioFadeInNorm = 1.0,
    public audioProximityNorm = false, public audioSpatialNorm = true
  ) {}
}

export class CharacterConfigComponent {
  constructor(public characterType: string = 'generic', public isPlayable: boolean = false, public faction: string = 'neutral') {}
}

export class InteractionRuntimeComponent {
  constructor(public isHoveredByPlayer = false, public currentHoverScale = 1.0, public isProcessingAction = false) {}
}

export class MediaRuntimeComponent {
  constructor(
    public runtimeDecals: AbstractMesh[] = [], public runtimeDecalMaterial?: StandardMaterial, 
    public lastVisualModeBW?: boolean, public videoCommand?: 'play' | 'pause' | 'stop'
  ) {}
}

export class TriggerRuntimeComponent {
  constructor(public isEnabled = true, public hasTriggeredEnter = false, public hasTriggeredExit = false) {}
}

export class PlayerRuntimeComponent {
  constructor(
    public intentions = { moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, run: false, jump: false },
    public physicsState = {
      isMoving: false, isRunning: false, isGrounded: true, isJumping: false, isFalling: false,
      isHardLanding: false, isRecoveringFromFall: false, landingFrame: 0, recoveryFrame: 0,
      velocidadY: -0.1, highestY: -9999
    },
    public seqRuntime: SeqRuntime | null = null,
    public stopBakedRequested: boolean = false,
    public cinematicAnimation: string | null = null,
    public cinematicClipOverride: string | null = null
  ) {}
}

export type MovementAuthority = 'GAMEPLAY' | 'CINEMATIC_FULL' | 'CINEMATIC_LOCOMOTION';

export class GameEntity {
  public uid: string;
  public name: string;
  public type: string;
  public rol: string; 
  public parentId: string | null = null;
  public orderIndex: number = 0;
  public isPersistent: boolean = false;

  public movementAuthority: MovementAuthority = 'GAMEPLAY';

  get isCinematicControlled(): boolean { 
    return this.movementAuthority !== 'GAMEPLAY'; 
  }
  set isCinematicControlled(val: boolean) { 
    this.movementAuthority = val ? 'CINEMATIC_FULL' : 'GAMEPLAY'; 
  }

  public view: AbstractMesh | null = null;
  public isDirty: boolean = true; 

  private components = new Map<string, any>();
  private _tempVisualCenterLocal = Vector3.Zero();

  constructor(uid: string, name: string, type: string, rol: string = 'prop') {
    this.uid = uid;
    this.name = name;
    this.type = type;
    this.rol = rol;

    this.addComponent('transform', new TransformComponent());
    this.addComponent('visual', new VisualComponent());
    
    const isSphere = type === 'sphere' || type === 'bubble';
    this.addComponent('physics', new PhysicsComponent(isSphere ? 'sphere' : 'box'));
    this.addComponent('interaction', new InteractionComponent());
    this.addComponent('interactionRuntime', new InteractionRuntimeComponent());

    if (['player', 'npc', 'politico', 'militar'].includes(rol)) {
      this.addComponent('characterConfig', new CharacterConfigComponent(rol, rol === 'player'));
      this.addComponent('playerRuntime', new PlayerRuntimeComponent());
      this.playerConfig = cloneDefaultPlayerConfig(); 
    }

    if (type.startsWith('light_')) {
      this.addComponent('light', new LightComponent());
    }

    if (type === 'video_plane' || type === 'image_plane') {
      this.addComponent('mediaConfig', new MediaConfigComponent());
      this.addComponent('mediaRuntime', new MediaRuntimeComponent());
    }

    if (type === 'trigger' || type === 'trigger_compuesto') {
      this.addComponent('triggerConfig', new TriggerConfigComponent());
      this.addComponent('triggerRuntime', new TriggerRuntimeComponent());
    }
  }

  /**
   * FASE A - NORMALIZACIÓN VISUAL CENTER
   * Obtiene el centro visual local (Camera Focus Point) sin instanciar nuevos objetos.
   * Derivado dinámicamente de las dimensiones físicas reales (Capsule/Box).
   */
  public getVisualCenterLocalToRef(result: Vector3): void {
    const col = this.collider;
    const isCharacter = !!this.characterConfig;
    
    let cx = col?.offsetX || 0;
    let cy = col?.offsetY || 0;
    let cz = col?.offsetZ || 0;

    if (isCharacter) {
        // 'offsetY' es el centro de gravedad (cintura).
        // 'sizeY' es la mitad de la altura.
        // Sumamos la mitad del segmento superior para llegar al pecho/cuello.
        cy += (col?.sizeY || 0.9) * 0.5;
    }

    result.set(cx, cy, cz);
  }

  /**
   * FASE A - NORMALIZACIÓN VISUAL CENTER
   * Obtiene el centro visual en coordenadas absolutas del mundo (World Space).
   * O(1) Allocation-Free (Apto para Update Loops).
   */
  public getVisualCenterAbsoluteToRef(result: Vector3): void {
    this.getVisualCenterLocalToRef(this._tempVisualCenterLocal);
    
    if (this.view) {
        this.view.computeWorldMatrix(true);
        Vector3.TransformCoordinatesToRef(this._tempVisualCenterLocal, this.view.getWorldMatrix(), result);
    } else {
        // Fallback matemático puro si la malla no está renderizada
        result.set(
            this.transform.position.x + this._tempVisualCenterLocal.x,
            this.transform.position.y + this._tempVisualCenterLocal.y,
            this.transform.position.z + this._tempVisualCenterLocal.z
        );
    }
  }

  public addComponent<T>(key: string, component: T): void {
    this.components.set(key, component);
    this.isDirty = true;
  }

  public getComponent<T>(key: string): T | undefined {
    return this.components.get(key) as T;
  }

  public hasComponent(key: string): boolean {
    return this.components.has(key);
  }

  public removeComponent(key: string): void {
    this.components.delete(key);
    this.isDirty = true;
  }

  get transform(): TransformComponent { return this.getComponent<TransformComponent>('transform')!; }
  set transform(v) { this.addComponent('transform', v); }

  get visual(): VisualComponent { return this.getComponent<VisualComponent>('visual')!; }
  set visual(v) { this.addComponent('visual', v); }

  get collider(): PhysicsComponent { return this.getComponent<PhysicsComponent>('physics')!; }
  set collider(v) { this.addComponent('physics', v); }

  get interaction(): InteractionComponent { return this.getComponent<InteractionComponent>('interaction')!; }
  set interaction(v) { this.addComponent('interaction', v); }

  get light(): LightComponent | undefined { return this.getComponent<LightComponent>('light'); }
  set light(v) { if(v) this.addComponent('light', v); }

  get media(): MediaConfigComponent | undefined { return this.getComponent<MediaConfigComponent>('mediaConfig'); }
  set media(v) { if(v) this.addComponent('mediaConfig', v); }

  get trigger(): TriggerConfigComponent | undefined { return this.getComponent<TriggerConfigComponent>('triggerConfig'); }
  set trigger(v) { if(v) this.addComponent('triggerConfig', v); }

  get characterConfig(): CharacterConfigComponent | undefined { return this.getComponent<CharacterConfigComponent>('characterConfig'); }
  set characterConfig(v) { if(v) this.addComponent('characterConfig', v); }

  get mediaRuntime(): MediaRuntimeComponent | undefined { return this.getComponent<MediaRuntimeComponent>('mediaRuntime'); }
  get triggerRuntime(): TriggerRuntimeComponent | undefined { return this.getComponent<TriggerRuntimeComponent>('triggerRuntime'); }
  get playerRuntime(): PlayerRuntimeComponent { return this.getComponent<PlayerRuntimeComponent>('playerRuntime')!; }
  get interactionRuntime(): InteractionRuntimeComponent { return this.getComponent<InteractionRuntimeComponent>('interactionRuntime')!; }

  get initialHeadLocal() { return this.getComponent<InitialHeadLocalComponent>('initialHeadLocal')?.position; }
  set initialHeadLocal(v) { if(v) this.addComponent('initialHeadLocal', new InitialHeadLocalComponent(v)); else this.removeComponent('initialHeadLocal'); }

  get selectionRange() { return this.getComponent<SelectionRangeComponent>('selectionRange')?.config || { fpsAdminMax: 10000, fpsUserMax: 3 }; }
  set selectionRange(v) { this.addComponent('selectionRange', new SelectionRangeComponent(v)); }

  get camOffset() { return this.getComponent<CamOffsetComponent>('camOffset')?.config || { x: 0, y: 1.6, z: 0 }; }
  set camOffset(v) { this.addComponent('camOffset', new CamOffsetComponent(v)); }

  get animationNames() { return this.getComponent<AnimationNamesComponent>('animationNames')?.names || []; }
  set animationNames(v) { this.addComponent('animationNames', new AnimationNamesComponent(v)); }

  get autoAnim() { return this.getComponent<AutoAnimComponent>('autoAnim')?.config || null; }
  set autoAnim(v) { if(v) this.addComponent('autoAnim', new AutoAnimComponent(v)); else this.removeComponent('autoAnim'); }

  get playerConfig(): PlayerRuntimeConfig | undefined {
    return this.getComponent<PlayerRuntimeConfig>('playerConfig');
  }

  set playerConfig(v: PlayerRuntimeConfig | undefined) {
    if (!v) {
        this.removeComponent('playerConfig');
        return;
    }
    this.addComponent('playerConfig', v);
  }

  public bindView(mesh: AbstractMesh): void {
    this.view = mesh;
    if (!mesh.metadata) mesh.metadata = {};
    mesh.metadata.entityUid = this.uid;
    this.syncToView(); 
  }

  public syncToView(): void {
    if (!this.view) return;
    const t = this.transform;
    const telemetry = TransformTelemetryService.instance;

    const qBefore = this.view.rotationQuaternion ? this.view.rotationQuaternion.clone() : null;

    const p = this.view.position;
    if (Math.abs(p.x - t.position.x) > 0.0001 || Math.abs(p.y - t.position.y) > 0.0001 || Math.abs(p.z - t.position.z) > 0.0001) {
        this.view.position.set(t.position.x, t.position.y, t.position.z);
    }

    const s = this.view.scaling;
    if (Math.abs(s.x - t.scale.x) > 0.0001 || Math.abs(s.y - t.scale.y) > 0.0001 || Math.abs(s.z - t.scale.z) > 0.0001) {
        this.view.scaling.set(t.scale.x, t.scale.y, t.scale.z);
    }

    if (this.view.rotationQuaternion) {
      let targetQuat: Quaternion;
      if (t.rotationQuaternion) {
         targetQuat = new Quaternion(t.rotationQuaternion.x, t.rotationQuaternion.y, t.rotationQuaternion.z, t.rotationQuaternion.w);
      } else {
         targetQuat = Quaternion.FromEulerAngles(t.rotation.x, t.rotation.y, t.rotation.z);
         t.rotationQuaternion = { x: targetQuat.x, y: targetQuat.y, z: targetQuat.z, w: targetQuat.w };
      }

      const dot = Quaternion.Dot(this.view.rotationQuaternion, targetQuat);
      
      if (Math.abs(dot) < 0.99999) { 
          this.view.rotationQuaternion.copyFrom(targetQuat);
      }
      this.view.rotation.set(0, 0, 0);
    } else {
      const r = this.view.rotation;
      if (Math.abs(r.x - t.rotation.x) > 0.0001 || Math.abs(r.y - t.rotation.y) > 0.0001 || Math.abs(r.z - t.rotation.z) > 0.0001) {
          this.view.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
      }
    }

    if (telemetry && telemetry.enabled) {
      telemetry.logEvent(
        this.uid, this.rol, 'GameEntity (syncToView)', 'rotationQuaternion', 'SYNC',
        qBefore, this.view.rotationQuaternion, telemetry.calculateQuaternionError(qBefore, this.view.rotationQuaternion)
      );
    }

    this.view.name = this.name;
    this.view.metadata = { uid: this.uid, entityUid: this.uid };
  }

  public syncTransformFromView(): void {
    if (!this.view) return;
    const t = this.transform;
    const telemetry = TransformTelemetryService.instance;

    t.position = { x: this.view.position.x, y: this.view.position.y, z: this.view.position.z };
    t.scale = { x: this.view.scaling.x, y: this.view.scaling.y, z: this.view.scaling.z };
    
    if (this.view.rotationQuaternion) {
      if (!t.rotationQuaternion) t.rotationQuaternion = { x: 0, y: 0, z: 0, w: 1 };
      t.rotationQuaternion.x = this.view.rotationQuaternion.x;
      t.rotationQuaternion.y = this.view.rotationQuaternion.y;
      t.rotationQuaternion.z = this.view.rotationQuaternion.z;
      t.rotationQuaternion.w = this.view.rotationQuaternion.w;
      
      if (telemetry && telemetry.enabled) {
        telemetry.logEvent(
          this.uid, this.rol, 'GameEntity (syncTransformFromView)', 'transform.rotation', 'SYNC',
          this.view.rotationQuaternion, new Vector3(0,0,0)
        );
      }
    } else {
      t.rotation = { x: this.view.rotation.x, y: this.view.rotation.y, z: this.view.rotation.z };
      t.rotationQuaternion = null;
    }
  }

  public getAbsolutePosition(): Vector3 {
    if (!this.view) {
      const t = this.transform;
      return new Vector3(t.position.x, t.position.y, t.position.z);
    }
    return this.view.getAbsolutePosition();
  }

  public destroyView(): void {
    if (this.mediaRuntime) {
      if (Array.isArray(this.mediaRuntime.runtimeDecals)) {
        this.mediaRuntime.runtimeDecals.forEach((d: AbstractMesh) => {
          if (d && typeof d.isDisposed === 'function' && !d.isDisposed()) {
              d.dispose(false, true);
          }
        });
      }
      if (this.mediaRuntime.runtimeDecalMaterial) {
        try { this.mediaRuntime.runtimeDecalMaterial.dispose(); } catch (e) {}
      }
      this.mediaRuntime.runtimeDecals = [];
    }

    if (this.view && typeof this.view.isDisposed === 'function' && !this.view.isDisposed()) {
      const scene = this.view.getScene();
      if (scene) {
        const descendants = new Set<any>([this.view, ...this.view.getDescendants(false)]);
        const agsToDispose: any[] = [];
        scene.animationGroups.forEach(ag => {
          const isTargetingMe = ag.targetedAnimations?.some((ta: any) => descendants.has(ta.target));
          if (isTargetingMe) {
            agsToDispose.push(ag);
          }
        });
        agsToDispose.forEach(ag => {
          ag.stop();
          ag.dispose();
        });
      }
      
      const isModelBased = this.type === 'model' || (this.type.startsWith('light_') && (!!this.visual?.assetId || !!this.visual?.path));
      const disposeMaterials = !isModelBased;
      
      this.view.dispose(false, disposeMaterials);
    }
    this.view = null;
  }
}