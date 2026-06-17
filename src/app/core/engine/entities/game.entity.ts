
import { AbstractMesh, Vector3, Quaternion } from '@babylonjs/core';
import { PlayerRuntimeConfig } from '../../../services/editor/player-config.model';

export interface ColliderComponent { type: string; sizeX: number; sizeY: number; sizeZ: number; offsetX: number; offsetY: number; offsetZ: number; }
export interface VisualComponent { color: string; colorBW: string; isSolid: boolean; isSelectable: boolean; ignoraNiebla: boolean; esEmisivo: boolean; brilloIntensidad: number; assetId?: number | null; path?: string; }
export interface InteractionComponent { mensaje: string; interactDistanceFPS: number; interactDistanceTPS: number; interactSequenceIdFPS: string; interactSequenceIdTPS: string; interactSequenceId: string; }

export class GameEntity {
  public uid: string;
  public name: string;
  public type: string;
  public rol: string;
  public parentId: string | null = null;
  public orderIndex: number = 0;

  public view: AbstractMesh | null = null;

  public visual: VisualComponent;
  public collider: ColliderComponent;
  public interaction: InteractionComponent;
  
  public playerConfig?: PlayerRuntimeConfig;
  public trigger?: any;
  public light?: any;
  public projection?: any;
  
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
      interactSequenceIdFPS: '', interactSequenceIdTPS: '', interactSequenceId: ''
    };
  }

  public bindView(mesh: AbstractMesh): void {
    this.view = mesh;
    if (!mesh.metadata) mesh.metadata = {};
    mesh.metadata.entityUid = this.uid;
  }

  public syncFromMetadata(): void {
    if (!this.view || !this.view.metadata) return;
    const meta = this.view.metadata;

    this.name = this.view.name;
    this.type = meta.type || this.type;
    this.rol = meta.rol || this.rol;
    this.parentId = meta.parentId || null;
    this.orderIndex = meta.orderIndex || 0;

    this.visual.color = meta.color || '#ffffff';
    this.visual.colorBW = meta.colorBW || '#ffffff';
    this.visual.isSolid = meta.isSolid ?? true;
    this.visual.isSelectable = meta.isSelectable ?? true;
    this.visual.ignoraNiebla = meta.ignoraNiebla ?? false;
    this.visual.esEmisivo = meta.esEmisivo ?? false;
    this.visual.brilloIntensidad = meta.brilloIntensidad ?? 1.0;
    this.visual.assetId = meta.assetId;
    this.visual.path = meta.path;

    if (meta.collider) this.collider = JSON.parse(JSON.stringify(meta.collider));
    if (meta.camOffset) this.camOffset = JSON.parse(JSON.stringify(meta.camOffset));
    if (meta.playerConfig) this.playerConfig = JSON.parse(JSON.stringify(meta.playerConfig));
    
    this.interaction.mensaje = meta.mensaje || '';
    this.interaction.interactDistanceFPS = meta.interactDistanceFPS ?? 3.0;
    this.interaction.interactDistanceTPS = meta.interactDistanceTPS ?? 5.0;
    this.interaction.interactSequenceIdFPS = meta.interactSequenceIdFPS || '';
    this.interaction.interactSequenceIdTPS = meta.interactSequenceIdTPS || '';
    this.interaction.interactSequenceId = meta.interactSequenceId || '';

    this.animationNames = meta.animationNames || [];
    this.autoAnim = meta.autoAnim ? JSON.parse(JSON.stringify(meta.autoAnim)) : null;

    if (meta.initialHeadLocal) {
        this.initialHeadLocal = new Vector3(meta.initialHeadLocal.x, meta.initialHeadLocal.y, meta.initialHeadLocal.z);
    }
  }

  public getAbsolutePosition(): Vector3 {
    if (!this.view) return Vector3.Zero();
    return this.view.getAbsolutePosition();
  }

  public destroyView(): void {
    if (this.view && !this.view.isDisposed()) {
      this.view.dispose();
    }
    this.view = null;
  }
}