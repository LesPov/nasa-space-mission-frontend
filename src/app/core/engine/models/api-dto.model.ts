
import { VisualMode } from '../world/world-settings.model';

export interface Vector3Dto {
  x: number;
  y: number;
  z: number;
}

export interface AssetDto {
  id?: number;
  path?: string;
  type?: string;
  name?: string;
}

export interface ColliderDto {
  type: string;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  radiusX?: number;
  heightY?: number;
  radiusZ?: number;
}

export interface SceneObjectPropertiesDto {
  rol?: string;
  characterConfig?: any;
  color?: string;
  colorBW?: string;
  isSolid?: boolean;
  isSelectable?: boolean;
  ignoraNiebla?: boolean;
  esEmisivo?: boolean;
  mostrarBorde?: boolean;
  brilloIntensidad?: number;
  mensaje?: string;
  interactDistanceFPS?: number;
  interactDistanceTPS?: number;
  interactSequenceIdFPS?: string;
  interactSequenceIdTPS?: string;
  interactSequenceId?: string;
  respawnTime?: number;
  collider?: ColliderDto;
  capsule?: ColliderDto;
  camOffset?: Vector3Dto;
  playerConfig?: any; 
  selectionRange?: any;
  animationNames?: string[];
  autoAnim?: any;
  path?: string;
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
  lightColor?: string;
  lightColorBW?: string;
  intensity?: number;
  range?: number;
  angle?: number;
  lightPosX?: number;
  lightPosY?: number;
  lightPosZ?: number;
  attachedNodePath?: string;
  attachedNodeName?: string;
  triggerShape?: string;
  isComposite?: boolean;
  seqEntrada?: string;
  timeEntrada?: number;
  videoEntrada?: string;
  mensajeSalida?: string;
  soundUrlSalida?: string;
  seqSalida?: string;
  timeSalida?: number;
  videoSalida?: string;
  condition?: string;
  actionType?: string;
  targetSceneId?: number | null;
  gameConditions?: any[];
  targetObjectName?: string;
  isRepeatable?: boolean;
  mensajeEntrada?: string;
  soundUrlEntrada?: string;
  soundUrl?: string;
  videoNorm?: string;
  timeNorm?: number;
  isEnabled?: boolean;
  stateMutations?: any[];
  
  // 🔥 NUEVOS CAMPOS DE AUDIO MEJORADO
  audioLoopEntrada?: boolean;
  audioVolumeEntrada?: number;
  audioMaxDistEntrada?: number;
  audioFadeInEntrada?: number;
  
  audioLoopSalida?: boolean;
  audioVolumeSalida?: number;
  audioMaxDistSalida?: number;
  audioFadeInSalida?: number;
  
  audioLoopNorm?: boolean;
  audioVolumeNorm?: number;
  audioMaxDistNorm?: number;
  audioFadeInNorm?: number;
}

export interface SceneObjectDto {
  uid: string;
  name: string;
  type: string;
  rol?: string;
  position: Vector3Dto;
  rotation?: Vector3Dto;
  scale?: Vector3Dto;
  size?: Vector3Dto;
  parentId?: string | null;
  assetId?: number | null;
  asset?: AssetDto;
  properties?: SceneObjectPropertiesDto;
}

export interface TriggerDto extends SceneObjectDto {
  isRepeatable?: boolean;
  condition?: string;
  actionType?: string;
  actionProperties?: SceneObjectPropertiesDto;
  isEnabled?: boolean;
}

export interface CinematicDto {
  id: string;
  uid?: string;
  name: string;
  durationMs: number;
  tracks: any[];
}

export interface WorldSettingsDto {
  visualMode: VisualMode;
  clearColor: string;
  clearColorBW: string;
  gravityY: number;
  ambientIntensity: number;
  ambientDiffuse: string;
  ambientGround: string;
  ambientDirX: number;
  ambientDirY: number;
  ambientDirZ: number;
  logicSettings?: any;
}

export interface SceneSavePayload {
  sceneObjectsDelta: SceneObjectDto[];
  triggersDelta: TriggerDto[];
  cinematicsDelta: CinematicDto[];
  deletedObjects: string[];
  deletedTriggers: string[];
  deletedCinematics: string[];
  environmentSettings: WorldSettingsDto;
  spawnPoint: Vector3Dto;
}

export interface SceneLoadPayload {
  scene?: {
    episodeId?: number;
    episodeVersionId?: number;
    name?: string;
    environmentSettings?: any;
  };
  environmentSettings?: any;
  uiSettings?: any;
  cinematics?: CinematicDto[];
  cinematicsDelta?: CinematicDto[];
  sceneObjects?: SceneObjectDto[];
  sceneObjectsDelta?: SceneObjectDto[];
  triggers?: TriggerDto[];
  triggersDelta?: TriggerDto[];
}