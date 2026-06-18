// src/app/core/engine/entities/game.entity.ts
import { AbstractMesh, Vector3, Quaternion } from '@babylonjs/core';
import { PlayerRuntimeConfig } from '../../../services/editor/player-config.model';

export interface TransformData {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export interface ColliderComponent { 
  type: string; 
  sizeX: number; sizeY: number; sizeZ: number; 
  offsetX: number; offsetY: number; offsetZ: number; 
}

export interface VisualComponent { 
  color: string; 
  colorBW: string; 
  isSolid: boolean; 
  isSelectable: boolean; 
  ignoraNiebla: boolean; 
  esEmisivo: boolean; 
  brilloIntensidad: number; 
  assetId?: number | null; 
  path?: string; 
}

export interface InteractionComponent { 
  mensaje: string; 
  interactDistanceFPS: number; 
  interactDistanceTPS: number; 
  interactSequenceIdFPS: string; 
  interactSequenceIdTPS: string; 
  interactSequenceId: string; 
  respawnTime?: number;
}

export interface LightComponent {
  lightColor: string;
  intensity: number;
  range: number;
  angle: number;
  lightPosX: number;
  lightPosY: number;
  lightPosZ: number;
  attachedNodePath: string;
  attachedNodeName: string;
}

export interface MediaComponent {
  videoUrl?: string;
  imageUrl?: string;
  profundidadProyeccion?: number;
  anguloProyeccion?: number;
  proyeccionAncho?: number;
  proyeccionAlto?: number;
  proyeccionRepeticiones?: number;
  proyeccionEspaciado?: number;
  proyeccionEje?: string;
  fadeDistance?: number;
}

export interface SelectionRangeComponent {
  fpsAdminMax: number;
  fpsUserMax: number;
}

export interface TriggerComponent {
  isComposite: boolean;
  triggerShape: string;
  conditions: string[];
  mensajeEntrada: string;
  mensajeSalida: string;
  soundUrlEntrada: string;
  soundUrlSalida: string;
  seqEntrada: string;
  seqSalida: string;
  timeEntrada: number;
  timeSalida: number;
  videoEntrada: string;
  videoSalida: string;
  condition: string;
  mensaje: string;
  soundUrl: string;
  interactSequenceId: string;
  timeNorm: number;
  videoNorm: string;
  isRepeatable: boolean;
  isEnabled: boolean;
  hasTriggeredEnter: boolean;
  hasTriggeredExit: boolean;
  gameConditions?: any[];
  stateMutations?: any[];
}

export class GameEntity {
  public uid: string;
  public name: string;
  public type: string;
  public rol: string;
  public parentId: string | null = null;
  public orderIndex: number = 0;

  public view: AbstractMesh | null = null;

  public transform: TransformData;
  public visual: VisualComponent;
  public collider: ColliderComponent;
  public interaction: InteractionComponent;
  public selectionRange: SelectionRangeComponent;
  
  public playerConfig?: PlayerRuntimeConfig;
  public light?: LightComponent;
  public media?: MediaComponent;
  public trigger?: TriggerComponent;
  
  public camOffset = { x: 0, y: 1.6, z: 0 };
  public animationNames: string[] = [];
  public autoAnim: any = null;
  public initialHeadLocal?: Vector3;
  
  public isHovered: boolean = false;
  public currentHoverScale: number = 1.0;
  public isProcessingAction: boolean = false;

  constructor(uid: string, name: string, type: string, rol: string = 'prop') {
    this.uid = uid;
    this.name = name;
    this.type = type;
    this.rol = rol;

    this.transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    };

    this.visual = {
      color: '#ffffff', colorBW: '#ffffff', isSolid: true, isSelectable: true,
      ignoraNiebla: false, esEmisivo: false, brilloIntensidad: 1.0
    };

    this.collider = {
      type: type === 'sphere' || type === 'bubble' ? 'sphere' : 'box',
      sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5,
      offsetX: 0, offsetY: 0, offsetZ: 0
    };

    this.interaction = {
      mensaje: '', interactDistanceFPS: 3.0, interactDistanceTPS: 5.0,
      interactSequenceIdFPS: '', interactSequenceIdTPS: '', interactSequenceId: '',
      respawnTime: 8
    };

    this.selectionRange = { fpsAdminMax: 10000, fpsUserMax: 3 };

    if (type.startsWith('light_')) {
      this.light = { lightColor: '#ffffff', intensity: 1.0, range: 50, angle: 60, lightPosX: 0, lightPosY: 0, lightPosZ: 0, attachedNodePath: '', attachedNodeName: '' };
    }

    if (type === 'video_plane' || type === 'image_plane') {
      this.media = { profundidadProyeccion: 10, anguloProyeccion: 0, proyeccionAncho: 2, proyeccionAlto: 2, proyeccionRepeticiones: 1, proyeccionEspaciado: 2, proyeccionEje: 'Y', fadeDistance: 0 };
    }
  }

  public bindView(mesh: AbstractMesh): void {
    this.view = mesh;
    if (!mesh.metadata) mesh.metadata = {};
    mesh.metadata.entityUid = this.uid;
    this.syncToView(); 
  }

  public syncToView(): void {
    if (!this.view) return;

    this.view.position.set(this.transform.position.x, this.transform.position.y, this.transform.position.z);
    this.view.scaling.set(this.transform.scale.x, this.transform.scale.y, this.transform.scale.z);

    if (this.view.rotationQuaternion) {
      Quaternion.FromEulerAnglesToRef(this.transform.rotation.x, this.transform.rotation.y, this.transform.rotation.z, this.view.rotationQuaternion);
      this.view.rotation.set(0, 0, 0);
    } else {
      this.view.rotation.set(this.transform.rotation.x, this.transform.rotation.y, this.transform.rotation.z);
    }

    this.view.name = this.name;
    
    this.view.metadata = {
      ...this.view.metadata,
      uid: this.uid,
      type: this.type,
      rol: this.rol,
      parentId: this.parentId,
      orderIndex: this.orderIndex,
      
      color: this.visual.color,
      colorBW: this.visual.colorBW,
      isSolid: this.visual.isSolid,
      isSelectable: this.visual.isSelectable,
      ignoraNiebla: this.visual.ignoraNiebla,
      esEmisivo: this.visual.esEmisivo,
      brilloIntensidad: this.visual.brilloIntensidad,
      assetId: this.visual.assetId,
      path: this.visual.path,
      
      collider: this.collider,
      camOffset: this.camOffset,
      playerConfig: this.playerConfig,
      selectionRange: this.selectionRange,
      
      mensaje: this.interaction.mensaje,
      interactDistanceFPS: this.interaction.interactDistanceFPS,
      interactDistanceTPS: this.interaction.interactDistanceTPS,
      interactSequenceIdFPS: this.interaction.interactSequenceIdFPS,
      interactSequenceIdTPS: this.interaction.interactSequenceIdTPS,
      interactSequenceId: this.interaction.interactSequenceId,
      respawnTime: this.interaction.respawnTime,
      
      animationNames: this.animationNames,
      autoAnim: this.autoAnim,
      initialHeadLocal: this.initialHeadLocal ? this.initialHeadLocal.clone() : undefined
    };

    if (this.light) Object.assign(this.view.metadata, this.light);
    if (this.media) Object.assign(this.view.metadata, this.media);
    if (this.trigger) Object.assign(this.view.metadata, this.trigger);
  }

  public syncTransformFromView(): void {
    if (!this.view) return;
    this.transform.position = { x: this.view.position.x, y: this.view.position.y, z: this.view.position.z };
    this.transform.scale = { x: this.view.scaling.x, y: this.view.scaling.y, z: this.view.scaling.z };
    
    if (this.view.rotationQuaternion) {
      const euler = this.view.rotationQuaternion.toEulerAngles();
      this.transform.rotation = { x: euler.x, y: euler.y, z: euler.z };
    } else {
      this.transform.rotation = { x: this.view.rotation.x, y: this.view.rotation.y, z: this.view.rotation.z };
    }
  }

  public getAbsolutePosition(): Vector3 {
    if (!this.view) return new Vector3(this.transform.position.x, this.transform.position.y, this.transform.position.z);
    return this.view.getAbsolutePosition();
  }

  public destroyView(): void {
    if (this.view && !this.view.isDisposed()) {
      this.view.dispose();
    }
    this.view = null;
  }
}