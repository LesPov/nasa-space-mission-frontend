
// src/app/core/engine/entities/game.entity.ts

import { AbstractMesh, Vector3, Quaternion, StandardMaterial } from '@babylonjs/core';
import { PlayerRuntimeConfig } from '../models/player-config.model';

// ==========================================
// 1. DEFINICIÓN DE COMPONENTES ECS
// ==========================================

export class TransformComponent {
  constructor(
    public position = { x: 0, y: 0, z: 0 },
    public rotation = { x: 0, y: 0, z: 0 },
    public scale = { x: 1, y: 1, z: 1 }
  ) {}
}

export class VisualComponent {
  constructor(
    public color = '#ffffff', 
    public colorBW = '#ffffff', 
    public isSolid = true, 
    public isSelectable = true, 
    public ignoraNiebla = false, 
    public esEmisivo = false, 
    public brilloIntensidad = 1.0, 
    public assetId?: number | null, 
    public path?: string
  ) {}
}

export class PhysicsComponent {
  constructor(
    public type = 'box', 
    public sizeX = 0.5, 
    public sizeY = 0.5, 
    public sizeZ = 0.5, 
    public offsetX = 0, 
    public offsetY = 0, 
    public offsetZ = 0
  ) {}
}

export class InteractionComponent {
  constructor(
    public mensaje = '', 
    public interactDistanceFPS = 3.0, 
    public interactDistanceTPS = 5.0, 
    public interactSequenceIdFPS = '', 
    public interactSequenceIdTPS = '', 
    public interactSequenceId = '', 
    public respawnTime = 8
  ) {}
}

export class LightComponent {
  constructor(
    public lightColor = '#ffffff', 
    public intensity = 1.0, 
    public range = 50, 
    public angle = 60, 
    public lightPosX = 0, 
    public lightPosY = 0, 
    public lightPosZ = 0, 
    public attachedNodePath = '', 
    public attachedNodeName = ''
  ) {}
}

export class MediaComponent {
  constructor(
    public videoUrl = '', 
    public imageUrl = '', 
    public profundidadProyeccion = 10, 
    public anguloProyeccion = 0, 
    public proyeccionAncho = 2, 
    public proyeccionAlto = 2, 
    public proyeccionRepeticiones = 1, 
    public proyeccionEspaciado = 2, 
    public proyeccionEje = 'Y', 
    public fadeDistance = 0, 
    public runtimeDecals: AbstractMesh[] = [], 
    public runtimeDecalMaterial?: StandardMaterial, 
    public lastVisualModeBW?: boolean
  ) {}
}

export class TriggerComponent {
  constructor(
    public isComposite = false, 
    public triggerShape = 'cube', 
    public conditions: string[] = [], 
    public mensajeEntrada = '', 
    public mensajeSalida = '', 
    public soundUrlEntrada = '', 
    public soundUrlSalida = '', 
    public seqEntrada = '', 
    public seqSalida = '', 
    public timeEntrada = 4.5, 
    public timeSalida = 4.5, 
    public videoEntrada = '', 
    public videoSalida = '', 
    public condition = 'on_enter', 
    public mensaje = '', 
    public soundUrl = '', 
    public interactSequenceId = '', 
    public timeNorm = 4.5, 
    public videoNorm = '', 
    public isRepeatable = false, 
    public isEnabled = true, 
    public hasTriggeredEnter = false, 
    public hasTriggeredExit = false, 
    public gameConditions: any[] = [], 
    public stateMutations: any[] = []
  ) {}
}

export class PlayerStateComponent {
  constructor(
    public playerConfig?: PlayerRuntimeConfig,
    public selectionRange = { fpsAdminMax: 10000, fpsUserMax: 3 },
    public camOffset = { x: 0, y: 1.6, z: 0 },
    public animationNames: string[] = [],
    public autoAnim: any = null,
    public initialHeadLocal?: Vector3
  ) {}
}


// ==========================================
// 2. ENTIDAD BASE (ECS CONTENEDOR)
// ==========================================

export class GameEntity {
  public uid: string;
  public name: string;
  public type: string;
  public rol: string;
  public parentId: string | null = null;
  public orderIndex: number = 0;

  public view: AbstractMesh | null = null;
  
  // 🔥 DIRTY TRACKING: Si es true, el SceneSaverService la enviará al backend.
  public isDirty: boolean = true; 

  // 🔥 MAPA CENTRAL DE COMPONENTES ECS
  private components = new Map<string, any>();

  // Variables volátiles de Runtime (No se guardan en BD, no son componentes)
  public isHovered: boolean = false;
  public currentHoverScale: number = 1.0;
  public isProcessingAction: boolean = false;

  constructor(uid: string, name: string, type: string, rol: string = 'prop') {
    this.uid = uid;
    this.name = name;
    this.type = type;
    this.rol = rol;

    // Inicializamos los componentes básicos que todos tienen
    this.addComponent('transform', new TransformComponent());
    this.addComponent('visual', new VisualComponent());
    
    const isSphere = type === 'sphere' || type === 'bubble';
    this.addComponent('physics', new PhysicsComponent(isSphere ? 'sphere' : 'box'));
    this.addComponent('interaction', new InteractionComponent());
    this.addComponent('playerState', new PlayerStateComponent());

    // Componentes específicos por tipo
    if (type.startsWith('light_')) {
      this.addComponent('light', new LightComponent());
    }

    if (type === 'video_plane' || type === 'image_plane') {
      this.addComponent('media', new MediaComponent());
    }
  }

  // ==========================================
  // API ECS (Entity-Component-System)
  // ==========================================
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

  // ==========================================
  // GETTERS DE COMPATIBILIDAD (Para no romper el proyecto mientras refactorizamos todos los systems)
  // ==========================================
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

  get media(): MediaComponent | undefined { return this.getComponent<MediaComponent>('media'); }
  set media(v) { if(v) this.addComponent('media', v); }

  get trigger(): TriggerComponent | undefined { return this.getComponent<TriggerComponent>('trigger'); }
  set trigger(v) { if(v) this.addComponent('trigger', v); }

  // Atajos hacia PlayerStateComponent
  get playerConfig() { return this.getComponent<PlayerStateComponent>('playerState')?.playerConfig; }
  set playerConfig(v) { const p = this.getComponent<PlayerStateComponent>('playerState'); if(p) p.playerConfig = v; }
  
  get selectionRange() { return this.getComponent<PlayerStateComponent>('playerState')!.selectionRange; }
  set selectionRange(v) { const p = this.getComponent<PlayerStateComponent>('playerState'); if(p) p.selectionRange = v; }
  
  get camOffset() { return this.getComponent<PlayerStateComponent>('playerState')!.camOffset; }
  set camOffset(v) { const p = this.getComponent<PlayerStateComponent>('playerState'); if(p) p.camOffset = v; }

  get animationNames() { return this.getComponent<PlayerStateComponent>('playerState')!.animationNames; }
  set animationNames(v) { const p = this.getComponent<PlayerStateComponent>('playerState'); if(p) p.animationNames = v; }

  get autoAnim() { return this.getComponent<PlayerStateComponent>('playerState')!.autoAnim; }
  set autoAnim(v) { const p = this.getComponent<PlayerStateComponent>('playerState'); if(p) p.autoAnim = v; }

  get initialHeadLocal() { return this.getComponent<PlayerStateComponent>('playerState')?.initialHeadLocal; }
  set initialHeadLocal(v) { const p = this.getComponent<PlayerStateComponent>('playerState'); if(p) p.initialHeadLocal = v; }


  // ==========================================
  // VIEW BINDING
  // ==========================================
  public bindView(mesh: AbstractMesh): void {
    this.view = mesh;
    if (!mesh.metadata) mesh.metadata = {};
    mesh.metadata.entityUid = this.uid;
    this.syncToView(); 
  }

  public syncToView(): void {
    if (!this.view) return;
    const t = this.getComponent<TransformComponent>('transform')!;

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
    const t = this.getComponent<TransformComponent>('transform')!;

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
      const t = this.getComponent<TransformComponent>('transform')!;
      return new Vector3(t.position.x, t.position.y, t.position.z);
    }
    return this.view.getAbsolutePosition();
  }

  public destroyView(): void {
    if (this.view && !this.view.isDisposed()) {
      this.view.dispose();
    }
    this.view = null;
  }
}