
// src/app/core/engine/entities/game.entity.ts

import { AbstractMesh, Vector3, Quaternion, StandardMaterial } from '@babylonjs/core';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../models/player-config.model';
import { SeqRuntime } from '../runtime/systems/player-sequence.service';
import { 
  MovementComponent, JumpComponent, PlayerCameraConfigComponent, FogConfigComponent, 
  AnimationBindingsComponent, SequencesComponent, PhysicsConfigComponent, BlendConfigComponent, 
  AnimationEnabledComponent, DebugConfigComponent, SelectionRangeComponent, CamOffsetComponent, 
  AnimationNamesComponent, AutoAnimComponent, InitialHeadLocalComponent 
} from './player-sub-components';

export class TransformComponent {
  constructor(public position = { x: 0, y: 0, z: 0 }, public rotation = { x: 0, y: 0, z: 0 }, public scale = { x: 1, y: 1, z: 1 }) {}
}

export class VisualComponent {
  constructor(
    public color = '#ffffff', public colorBW = '#ffffff', public isSolid = true, 
    public isSelectable = true, public ignoraNiebla = false, public esEmisivo = false, 
    public brilloIntensidad = 1.0, public assetId?: number | null, public path?: string,
    public mostrarBorde: boolean = true // 🔥 NUEVO: Control manual del borde (Highlight)
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
    public lightPosZ = 0, public attachedNodePath = '', public attachedNodeName = ''
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
    public targetSceneId: number | null = null
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

export class LightRuntimeComponent {
  constructor(public currentIntensity?: number) {}
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
    public cinematicAnimation: string | null = null
  ) {}
}

export class GameEntity {
  public uid: string;
  public name: string;
  public type: string;
  public rol: string; 
  public parentId: string | null = null;
  public orderIndex: number = 0;
  public isPersistent: boolean = false;

  public isCinematicControlled: boolean = false;

  public view: AbstractMesh | null = null;
  public isDirty: boolean = true; 

  private components = new Map<string, any>();

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
      this.addComponent('lightRuntime', new LightRuntimeComponent()); 
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
  get lightRuntime(): LightRuntimeComponent | undefined { return this.getComponent<LightRuntimeComponent>('lightRuntime'); }
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
    const isCharacter = this.hasComponent('characterConfig');
    if (!isCharacter && !this.hasComponent('sequences') && !this.hasComponent('fogConfig') && !this.hasComponent('animations')) {
        return undefined;
    }

    const base = cloneDefaultPlayerConfig();
    return {
         movement: this.getComponent<MovementComponent>('movement')?.config ?? base.movement,
         jump: this.getComponent<JumpComponent>('jump')?.config ?? base.jump,
         camera: this.getComponent<PlayerCameraConfigComponent>('playerCamera')?.config ?? base.camera,
         fog: this.getComponent<FogConfigComponent>('fogConfig')?.config ?? base.fog,
         animations: this.getComponent<AnimationBindingsComponent>('animations')?.config ?? base.animations,
         sequences: this.getComponent<SequencesComponent>('sequences')?.sequences ?? [],
         physics: this.getComponent<PhysicsConfigComponent>('physicsConfig')?.config ?? base.physics,
         blend: this.getComponent<BlendConfigComponent>('blendConfig')?.config ?? base.blend,
         animationEnabled: this.getComponent<AnimationEnabledComponent>('animationEnabled')?.config ?? base.animationEnabled,
         debug: this.getComponent<DebugConfigComponent>('debugConfig')?.config ?? base.debug,
    };
  }

  set playerConfig(v: PlayerRuntimeConfig | undefined) {
    if (!v) {
        this.removeComponent('movement'); this.removeComponent('jump'); this.removeComponent('playerCamera');
        this.removeComponent('fogConfig'); this.removeComponent('animations'); this.removeComponent('sequences');
        this.removeComponent('physicsConfig'); this.removeComponent('blendConfig');
        this.removeComponent('animationEnabled'); this.removeComponent('debugConfig');
        return;
    }
    this.addComponent('movement', new MovementComponent(v.movement));
    this.addComponent('jump', new JumpComponent(v.jump));
    this.addComponent('playerCamera', new PlayerCameraConfigComponent(v.camera));
    this.addComponent('fogConfig', new FogConfigComponent(v.fog));
    this.addComponent('animations', new AnimationBindingsComponent(v.animations));
    this.addComponent('sequences', new SequencesComponent(v.sequences));
    this.addComponent('physicsConfig', new PhysicsConfigComponent(v.physics));
    this.addComponent('blendConfig', new BlendConfigComponent(v.blend));
    this.addComponent('animationEnabled', new AnimationEnabledComponent(v.animationEnabled));
    this.addComponent('debugConfig', new DebugConfigComponent(v.debug));
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

    this.view.position.set(t.position.x, t.position.y, t.position.z);
    this.view.scaling.set(t.scale.x, t.scale.y, t.scale.z);

    if (this.view.rotationQuaternion) {
      Quaternion.FromEulerAnglesToRef(t.rotation.x, t.rotation.y, t.rotation.z, this.view.rotationQuaternion);
      this.view.rotation.set(0, 0, 0);
    } else {
      this.view.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
    }

    this.view.name = this.name;
    this.view.metadata = { uid: this.uid, entityUid: this.uid };
  }

  public syncTransformFromView(): void {
    if (!this.view) return;
    const t = this.transform;

    t.position = { x: this.view.position.x, y: this.view.position.y, z: this.view.position.z };
    t.scale = { x: this.view.scaling.x, y: this.view.scaling.y, z: this.view.scaling.z };
    
    if (this.view.rotationQuaternion) {
      const euler = this.view.rotationQuaternion.toEulerAngles();
      t.rotation = { x: euler.x, y: euler.y, z: euler.z };
    } else {
      t.rotation = { x: this.view.rotation.x, y: this.view.rotation.y, z: this.view.rotation.z };
    }
    this.isDirty = true;
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
      const disposeMaterials = this.type !== 'model';
      this.view.dispose(false, disposeMaterials);
    }
    this.view = null;
  }
}