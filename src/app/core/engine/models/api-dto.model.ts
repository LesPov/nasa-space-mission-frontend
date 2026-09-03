
// src/app/core/engine/models/api-dto.model.ts

import { VisualMode } from '../world/world-settings.model';
import { PlayerRuntimeConfig } from './player-config.model';

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

export interface CharacterConfigDto {
  characterType: string;
  isPlayable: boolean;
  faction: string;
}

export interface SelectionRangeDto {
  fpsAdminMax: number;
  fpsUserMax: number;
}

export interface AutoAnimDto {
  enabled: boolean;
  type: string;
  axis: string;
  amount: number;
  duration: number;
  stopBaked: boolean;
}

export interface GameConditionDto {
  type: string;
  key: string;
  value?: string | number | boolean;
}

export interface GameStateMutationDto {
  type: string;
  key: string;
  value?: string | number | boolean;
}

export interface SceneObjectPropertiesDto {
  rol?: string;
  characterConfig?: CharacterConfigDto;
  color?: string;
  colorBW?: string;
  ambientColor?: string;
  ambientColorBW?: string;
  isSolid?: boolean;
  isSelectable?: boolean;
  ignoraNiebla?: boolean;
  esEmisivo?: boolean;
  mostrarBorde?: boolean;
  brilloIntensidad?: number;
  internalScale?: number;
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
  playerConfig?: PlayerRuntimeConfig; 
  selectionRange?: SelectionRangeDto;
  animationNames?: string[];
  autoAnim?: AutoAnimDto;
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
  renderIntensity?: number;
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
  gameConditions?: GameConditionDto[];
  targetObjectName?: string;
  isRepeatable?: boolean;
  mensajeEntrada?: string;
  soundUrlEntrada?: string;
  soundUrl?: string;
  videoNorm?: string;
  timeNorm?: number;
  isEnabled?: boolean;
  stateMutations?: GameStateMutationDto[];
  
  audioLoopEntrada?: boolean;
  audioVolumeEntrada?: number;
  audioMaxDistEntrada?: number;
  audioFadeInEntrada?: number;
  audioProximityEntrada?: boolean;
  audioSpatialEntrada?: boolean;
  
  audioLoopSalida?: boolean;
  audioVolumeSalida?: number;
  audioMaxDistSalida?: number;
  audioFadeInSalida?: number;
  audioProximitySalida?: boolean;
  audioSpatialSalida?: boolean;
  
  audioLoopNorm?: boolean;
  audioVolumeNorm?: number;
  audioMaxDistNorm?: number;
  audioFadeInNorm?: number;
  audioProximityNorm?: boolean;
  audioSpatialNorm?: boolean;

  prefabHierarchy?: SceneObjectDto[]; 
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

export interface LogicSettingsDto {
  initialVariables?: { key: string, value: string | number | boolean }[];
  objetivosLocales?: string | string[];
  recompensasLocales?: string | string[];
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
  logicSettings?: LogicSettingsDto;
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