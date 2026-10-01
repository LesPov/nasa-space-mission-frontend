
import { VisualMode } from '../world/world-settings.model';
import { PlayerRuntimeConfig } from './player-config.model';
import { CinematicCameraDefinition } from './cinematic-camera.model';

export * from './space-mission.model';

export interface Vector3Dto { x: number; y: number; z: number; }
export interface AssetDto { id?: number; path?: string; type?: string; name?: string; }

export interface ColliderDto {
  type: string; sizeX?: number; sizeY?: number; sizeZ?: number;
  offsetX?: number; offsetY?: number; offsetZ?: number;
  radiusX?: number; heightY?: number; radiusZ?: number;
}

export interface CharacterConfigDto { characterType: string; isPlayable: boolean; faction: string; }
export interface SelectionRangeDto { fpsAdminMax: number; fpsUserMax: number; }
export interface AutoAnimDto { enabled: boolean; type: string; axis: string; amount: number; duration: number; stopBaked: boolean; }
export interface GameConditionDto { type: string; key: string; value?: string | number | boolean; scope?: string; }
export interface GameStateMutationDto { type: string; key: string; value?: string | number | boolean; scope?: string; }

export interface NarrativeRoleDto {
  id?: number;
  episodeId?: number;
  uid: string;
  name: string;
  description: string;
  isEnabled: boolean;
  isPlayable: boolean;
  sortOrder: number;
  characterPrefabId?: number | null; 
  characterPrefab?: any;
  spawnSceneObjectUid: string | null;
  metadata?: any;
}

export interface SceneObjectPropertiesDto {
  rol?: string; 
  transformSpace?: 'LOCAL' | 'WORLD' | 'ATTACHED';
  characterConfig?: CharacterConfigDto; color?: string; colorBW?: string; ambientColor?: string; ambientColorBW?: string;
  isSolid?: boolean; isSelectable?: boolean; ignoraNiebla?: boolean; esEmisivo?: boolean; mostrarBorde?: boolean; brilloIntensidad?: number;
  internalScale?: number; mensaje?: string; interactDistanceFPS?: number; interactDistanceTPS?: number; interactSequenceIdFPS?: string;
  interactSequenceIdTPS?: string; interactSequenceId?: string; respawnTime?: number; collider?: ColliderDto; capsule?: ColliderDto;
  camOffset?: Vector3Dto; playerConfig?: PlayerRuntimeConfig; selectionRange?: SelectionRangeDto; animationNames?: string[]; autoAnim?: AutoAnimDto;
  path?: string; videoUrl?: string; imageUrl?: string; profundidadProyeccion?: number; anguloProyeccion?: number; proyeccionAncho?: number;
  proyeccionAlto?: number; proyeccionRepeticiones?: number; proyeccionEspaciado?: number; proyeccionEje?: string; fadeDistance?: number;
  lightColor?: string; lightColorBW?: string; intensity?: number; renderIntensity?: number; range?: number; angle?: number;
  attachedNodePath?: string; attachedNodeName?: string;
  
  // --- LIGHT CONTAINMENT PROPERTIES ---
  containmentMode?: 'GLOBAL' | 'INTERIOR' | 'EXTERIOR';
  containerEntityUid?: string;
  interiorVolumeId?: string;
  affectDescendantsOnly?: boolean;
  shadowDarkness?: number;
  shadowBias?: number;
  shadowNormalBias?: number;
  excludeExteriorMeshes?: boolean;

  triggerShape?: string; isComposite?: boolean; seqEntrada?: string;
  timeEntrada?: number; videoEntrada?: string; mensajeSalida?: string; soundUrlSalida?: string; seqSalida?: string; timeSalida?: number;
  videoSalida?: string; condition?: string; actionType?: string; targetSceneId?: number | null; gameConditions?: GameConditionDto[];
  targetObjectName?: string; isRepeatable?: boolean; mensajeEntrada?: string; soundUrlEntrada?: string; soundUrl?: string;
  videoNorm?: string; timeNorm?: number; isEnabled?: boolean; stateMutations?: GameStateMutationDto[];
  audioLoopEntrada?: boolean; audioVolumeEntrada?: number; audioMaxDistEntrada?: number; audioFadeInEntrada?: number;
  audioProximityEntrada?: boolean; audioSpatialEntrada?: boolean;
  audioLoopSalida?: boolean; audioVolumeSalida?: number; audioMaxDistSalida?: number; audioFadeInSalida?: number;
  audioProximitySalida?: boolean; audioSpatialSalida?: boolean;
  audioLoopNorm?: boolean; audioVolumeNorm?: number; audioMaxDistNorm?: number; audioFadeInNorm?: number;
  audioProximityNorm?: boolean; audioSpatialNorm?: boolean;
  prefabHierarchy?: SceneObjectDto[]; 
  partOverrides?: Record<string, any>; 
}

export interface SceneObjectDto {
  uid: string; name: string; type: string; rol?: string; position: Vector3Dto; rotation?: Vector3Dto; scale?: Vector3Dto;
  size?: Vector3Dto; parentId?: string | null; assetId?: number | null; asset?: AssetDto; properties?: SceneObjectPropertiesDto;
}

export interface TriggerDto extends SceneObjectDto {
  isRepeatable?: boolean; condition?: string; actionType?: string; actionProperties?: SceneObjectPropertiesDto; isEnabled?: boolean;
}

export interface CinematicDto { id: string; uid?: string; name: string; durationMs: number; tracks: any[]; }

export interface LogicSettingsDto {
  initialVariables?: { key: string, value: string | number | boolean }[];
}

export interface WorldSettingsDto {
  visualMode: VisualMode; clearColor: string; clearColorBW: string; gravityY: number; ambientIntensity: number;
  ambientDiffuse: string; ambientGround: string; ambientDirX: number; ambientDirY: number; ambientDirZ: number; logicSettings?: LogicSettingsDto;
}

export interface SceneSavePayload {
  sceneObjectsDelta: SceneObjectDto[]; triggersDelta: TriggerDto[]; cinematicsDelta: CinematicDto[]; cinematicCamerasDelta: CinematicCameraDefinition[];
  deletedObjects: string[]; deletedTriggers: string[]; deletedCinematics: string[]; deletedCinematicCameras: string[];
  environmentSettings: WorldSettingsDto; uiSettings?: any; spawnPoint: Vector3Dto;
}

export interface SceneLoadPayload {
  scene?: {
    id?: number; episodeId?: number; episodeVersionId?: number; name?: string; environmentSettings?: any; uiSettings?: any;
    narrativeRoles?: NarrativeRoleDto[]; 
  };
  environmentSettings?: any; uiSettings?: any; cinematics?: CinematicDto[]; cinematicsDelta?: CinematicDto[];
  cinematicCameras?: CinematicCameraDefinition[]; cinematicCamerasDelta?: CinematicCameraDefinition[];
  sceneObjects?: SceneObjectDto[]; sceneObjectsDelta?: SceneObjectDto[]; triggers?: TriggerDto[]; triggersDelta?: TriggerDto[];
}