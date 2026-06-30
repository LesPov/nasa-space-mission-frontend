
import { Injectable, inject } from '@angular/core';
import { PointLight, SpotLight, DirectionalLight, Vector3 } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { LightPoolConfig, DEFAULT_LIGHT_POOL_CONFIG, LightAssignment, LightType } from './models/light-config';

@Injectable({ providedIn: 'root' })
export class LightPoolManagerService {
    private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
    
    private pointPool: LightAssignment[] = [];
    private spotPool: LightAssignment[] = [];
    private dirPool: LightAssignment[] = [];
    private allPools: LightAssignment[] = [];
    
    private initialized = false;

    public initialize(config: LightPoolConfig = DEFAULT_LIGHT_POOL_CONFIG): void {
        if (this.initialized) return;
        const scene = this.motor3d.getScene();
        if (!scene) return;

        // Crear Point Lights Físicas
        for (let i = 0; i < config.maxPointLights; i++) {
            const light = new PointLight(`pool_point_${i}`, Vector3.Zero(), scene);
            light.setEnabled(false);
            light.intensity = 0;
            const assign = new LightAssignment(`point_${i}`, LightType.POINT, light);
            this.pointPool.push(assign);
            this.allPools.push(assign);
        }

        // Crear Spot Lights Físicas
        for (let i = 0; i < config.maxSpotLights; i++) {
            const light = new SpotLight(`pool_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
            light.setEnabled(false);
            light.intensity = 0;
            const assign = new LightAssignment(`spot_${i}`, LightType.SPOT, light);
            this.spotPool.push(assign);
            this.allPools.push(assign);
        }

        // Crear Directional Lights Físicas
        for (let i = 0; i < config.maxDirLights; i++) {
            const light = new DirectionalLight(`pool_dir_${i}`, new Vector3(0, -1, 0), scene);
            light.setEnabled(false);
            light.intensity = 0;
            const assign = new LightAssignment(`dir_${i}`, LightType.DIRECTIONAL, light);
            this.dirPool.push(assign);
            this.allPools.push(assign);
        }

        this.initialized = true;
    }

    public getPointPool(): LightAssignment[] { return this.pointPool; }
    public getSpotPool(): LightAssignment[] { return this.spotPool; }
    public getDirPool(): LightAssignment[] { return this.dirPool; }
    public getAllPools(): LightAssignment[] { return this.allPools; }

    public assignLight(assignment: LightAssignment, ownerUid: string, priority: number): void {
        assignment.isOccupied = true;
        assignment.ownerUid = ownerUid;
        assignment.priority = priority;
    }

    public recycleLight(ownerUid: string): void {
        for (let i = 0; i < this.allPools.length; i++) {
            const p = this.allPools[i];
            if (p.isOccupied && p.ownerUid === ownerUid) {
                p.isOccupied = false;
                p.ownerUid = null;
                p.priority = 0;
                p.light.setEnabled(false);
                p.light.intensity = 0;
                
                const sg = p.light.getShadowGenerator();
                if (sg) {
                    sg.getShadowMap()?.renderList?.splice(0, sg.getShadowMap()!.renderList!.length);
                }
                break;
            }
        }
    }

    public freeAll(): void {
        for (let i = 0; i < this.allPools.length; i++) {
            const p = this.allPools[i];
            p.isOccupied = false;
            p.ownerUid = null;
            p.priority = 0;
            p.light.setEnabled(false);
            p.light.intensity = 0;
            
            const sg = p.light.getShadowGenerator();
            if (sg) {
                sg.getShadowMap()?.renderList?.splice(0, sg.getShadowMap()!.renderList!.length);
            }
        }
    }
}