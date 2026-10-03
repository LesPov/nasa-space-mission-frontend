
import { Color3, PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../entities/game.entity';
 
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
}