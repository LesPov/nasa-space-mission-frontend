// file: src/app/core/engine/runtime/systems/lighting/lighting-types.ts
import { Color3, PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { GameEntity, LightInteriorActivationMode } from '../../../entities/game.entity';

export type LightLifecycleStage = 'IDLE' | 'PRELOAD' | 'PREACTIVE' | 'ACTIVE';

export interface VirtualLight {
    entity: GameEntity;
    materials: any[];
    baseColor: Color3;
    currentMultiplier: number;
    targetMultiplier: number;
    distSq: number;
    isLightInRange: boolean;
    isShadowInRange: boolean;
    lastEvaluatedDistance: number;
    _lastRenderedMultiplier?: number;
    _isInPrepareRange?: boolean;
    _sortScore?: number;
    closestActorName?: string;
    poolRank?: number;
    
    // Estados del ciclo de vida para warmup progresivo sin hitches
    lifecycleStage: LightLifecycleStage;
    isWarmedUp: boolean;

    // Metadatos de contexto espacial interior
    isInterior: boolean;
    interiorActivationMode?: LightInteriorActivationMode;
    insideVolume: boolean;
    inPreEntryZone: boolean;
    containerName?: string;
}

export interface PoolSlot {
    index: number;
    type: 'point' | 'spot' | 'directional';
    light: PointLight | SpotLight | DirectionalLight;
    sg: ShadowGenerator | null; 
    assignedEntityUid: string | null;
    currentIntensity: number;
    lastShadowRebuildPos?: Vector3; 
    _isNewAssignment?: boolean; 
    hasDynamicCasters?: boolean;
    isStaticLight?: boolean;
    isWarmedUp?: boolean;
}