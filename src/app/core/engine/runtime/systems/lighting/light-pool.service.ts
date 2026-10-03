// RUTA: src/app/core/engine/runtime/systems/lighting/light-pool.service.ts
// ACCIÓN: MODIFICAR

import { Injectable, inject } from '@angular/core';
import { PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3, Color3, Tags, Scene } from '@babylonjs/core';
import { PoolSlot } from './lighting-types';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { LightContainmentService } from './light-containment.service';

@Injectable({ providedIn: 'root' })
export class LightPoolService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private containmentSvc = inject(LightContainmentService);

  private pointPool: PoolSlot[] = [];
  private spotPool: PoolSlot[] = [];
  private dirPool: PoolSlot[] = []; 
  
  public isInitialized = false;
  private currentScene: Scene | null = null;

  public initializePool(scene: Scene): void {
      if (this.isInitialized && this.currentScene === scene) {
          return; 
      }

      this.disposePools(); 
      this.currentScene = scene;

      // El pool físico contiene hasta 3 de cada tipo para admitir cualquier combinación del Top 3
      // (ej. 3 points, o 3 spots, o 2 points + 1 spot), pero la autoridad de asignación limita el total activo a <= 3.
      const MAX_LOCAL_SHADER_LIGHTS = 3;

      for (let i = 0; i < MAX_LOCAL_SHADER_LIGHTS; i++) {
          // --- POINT LIGHTS (1024x1024 Cubemap, PCF HIGH) ---
          const pLight = new PointLight(`pool_point_${i}`, new Vector3(0, -99999, 0), scene);
          pLight.intensity = 0; 
          pLight.diffuse = Color3.Black(); 
          pLight.shadowEnabled = true; 
          pLight.shadowMinZ = 0.1;
          pLight.shadowMaxZ = 28.0; // Frustum compacto para máxima densidad de texels en aberturas
          Tags.AddTagsTo(pLight, "system_element");

          const pSg = new ShadowGenerator(1024, pLight);
          pSg.usePercentageCloserFiltering = true; 
          pSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
          pSg.setDarkness(0.0); 
          pSg.bias = 0.0008; 
          pSg.normalBias = 0.004; 
          pSg.forceBackFacesOnly = false;
          this.pointPool.push({ index: i, type: 'point', light: pLight, sg: pSg, assignedEntityUid: null, currentIntensity: 0 });

          // --- SPOT LIGHTS (2048x2048 2D Map, PCF HIGH) ---
          const sLight = new SpotLight(`pool_spot_${i}`, new Vector3(0, -99999, 0), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
          sLight.intensity = 0; 
          sLight.diffuse = Color3.Black(); 
          sLight.shadowEnabled = true; 
          sLight.shadowMinZ = 0.1;
          sLight.shadowMaxZ = 30.0;
          Tags.AddTagsTo(sLight, "system_element");

          const sSg = new ShadowGenerator(2048, sLight);
          sSg.usePercentageCloserFiltering = true; 
          sSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
          sSg.setDarkness(0.0); 
          sSg.bias = 0.0008; 
          sSg.normalBias = 0.004; 
          sSg.forceBackFacesOnly = false;
          this.spotPool.push({ index: i, type: 'spot', light: sLight, sg: sSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      // --- DIRECTIONAL POOL (Sol Local) ---
      for (let i = 0; i < 2; i++) { 
          const dLight = new DirectionalLight(`pool_dir_${i}`, new Vector3(0, -1, 0), scene);
          dLight.intensity = 0; 
          dLight.diffuse = Color3.Black(); 
          dLight.shadowEnabled = i < 1; 
          Tags.AddTagsTo(dLight, "system_element");

          let dSg: ShadowGenerator | null = null;
          if (i < 1) { 
              dSg = new ShadowGenerator(2048, dLight);
              dSg.usePercentageCloserFiltering = true; 
              dSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
              dSg.setDarkness(0.0); 
              dSg.bias = 0.001; 
              dSg.normalBias = 0.01; 
              dSg.forceBackFacesOnly = false;
          }
          this.dirPool.push({ index: i, type: 'directional', light: dLight, sg: dSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      this.isInitialized = true;
  }

  public resetPools(): void {
      const topUids = new Set<string>();
      this.getAllSlots().forEach(slot => {
          this.releaseSlot(slot, topUids);
      });
  }

  public getPointPool(): PoolSlot[] { return this.pointPool; }
  public getSpotPool(): PoolSlot[] { return this.spotPool; }
  public getDirPool(): PoolSlot[] { return this.dirPool; }
  
  public getAllSlots(): PoolSlot[] {
      return [...this.pointPool, ...this.spotPool, ...this.dirPool];
  }

  public getPoolByType(type: string): PoolSlot[] {
      if (type === 'light_point') return this.pointPool;
      if (type === 'light_spot') return this.spotPool;
      if (type === 'light_directional') return this.dirPool;
      return [];
  }

  public findSlotByUid(uid: string): PoolSlot | undefined {
      return this.getAllSlots().find(s => s.assignedEntityUid === uid);
  }

  public releaseSlot(slot: PoolSlot, topUids: Set<string>): void {
      if (slot.assignedEntityUid && !topUids.has(slot.assignedEntityUid)) {
          slot.assignedEntityUid = null;
          if (slot.sg && slot.sg.getShadowMap()?.renderList) {
              slot.sg.getShadowMap()!.renderList!.length = 0; 
          }
          slot.currentIntensity = 0; 
          slot.light.intensity = 0; 
          if (slot.type !== 'directional') (slot.light as any).position.set(0, -99999, 0);
          this.containmentSvc.clearContainment(slot.light as any);
      }
  }

  public disposePools(): void {
      const cleanPool = (pool: PoolSlot[]) => {
          pool.forEach(p => { 
            this.containmentSvc.clearContainment(p.light as any);
            if (p.light && !p.light.isDisposed()) p.light.dispose(); 
            if (p.sg) p.sg.dispose(); 
          });
      };
      cleanPool(this.pointPool);
      cleanPool(this.spotPool);
      cleanPool(this.dirPool);
      
      this.pointPool = []; this.spotPool = []; this.dirPool = [];
      this.isInitialized = false;
      this.currentScene = null;
  }
}