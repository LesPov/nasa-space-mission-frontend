
import { Light } from '@babylonjs/core';

export enum LightType {
    POINT = 'POINT',
    SPOT = 'SPOT',
    DIRECTIONAL = 'DIRECTIONAL'
}

export interface LightPoolConfig {
    maxPointLights: number;
    maxSpotLights: number;
    maxDirLights: number;
    updateIntervalMs: number;
    cullingDistance: number;
}

export const DEFAULT_LIGHT_POOL_CONFIG: LightPoolConfig = {
    maxPointLights: 8,
    maxSpotLights: 4,
    maxDirLights: 1, 
    updateIntervalMs: 100, 
    cullingDistance: 60 
};

export class LightAssignment {
    public id: string;
    public type: LightType;
    public light: Light;
    public isOccupied: boolean = false;
    public ownerUid: string | null = null;
    public priority: number = 0;

    constructor(id: string, type: LightType, light: Light) {
        this.id = id;
        this.type = type;
        this.light = light;
    }
}