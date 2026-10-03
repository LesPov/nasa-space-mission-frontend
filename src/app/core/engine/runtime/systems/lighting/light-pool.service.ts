
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
      // 🔥 FIX FASE 1: Idempotencia. Si el pool ya existe para esta escena, lo reutilizamos intacto.
      // Evita la recompilación masiva de Shaders de profundidad.
      if (this.isInitialized && this.currentScene === scene) {
          return; 
      }

      this.disposePools(); 
      this.currentScene = scene;

      const engine = this.motor3d.getEngine();
      const maxUbo = (engine.getCaps() as { maxUniformBufferBindings?: number }).maxUniformBufferBindings || 12; 
      
      const BASE_UBOS = 6;
      const availableUBOsForShadows = Math.max(0, maxUbo - BASE_UBOS);
      const MAX_SHADOW_LIGHTS = Math.min(3, availableUBOsForShadows);
      const MAX_LOCAL_SHADER_LIGHTS = 3;

      for(let i = 0; i < MAX_LOCAL_SHADER_LIGHTS; i++) {
          const hasShadows = i < MAX_SHADOW_LIGHTS;

          const pLight = new PointLight(`pool_point_${i}`, new Vector3(0, -99999, 0), scene);
          pLight.intensity = 0; pLight.diffuse = Color3.Black(); 
          pLight.shadowEnabled = hasShadows; 
          pLight.shadowMinZ = 0.05;
          Tags.AddTagsTo(pLight, "system_element");

          let pSg: ShadowGenerator | null = null;
          if (hasShadows) {
              pSg = new ShadowGenerator(512, pLight);
              pSg.usePercentageCloserFiltering = true; 
              pSg.filteringQuality = ShadowGenerator.QUALITY_LOW;
              pSg.setDarkness(0.0); pSg.bias = 0.005; pSg.normalBias = 0.02; pSg.forceBackFacesOnly = false;
          }
          this.pointPool.push({ index: i, type: 'point', light: pLight, sg: pSg, assignedEntityUid: null, currentIntensity: 0 });

          const sLight = new SpotLight(`pool_spot_${i}`, new Vector3(0, -99999, 0), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
          sLight.intensity = 0; sLight.diffuse = Color3.Black(); 
          sLight.shadowEnabled = hasShadows; 
          sLight.shadowMinZ = 0.1;
          Tags.AddTagsTo(sLight, "system_element");

          let sSg: ShadowGenerator | null = null;
          if (hasShadows) { 
              sSg = new ShadowGenerator(1024, sLight);
              sSg.usePercentageCloserFiltering = true; sSg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
              sSg.setDarkness(0.0); sSg.bias = 0.001; sSg.normalBias = 0.015; sSg.forceBackFacesOnly = false;
          }
          this.spotPool.push({ index: i, type: 'spot', light: sLight, sg: sSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      for(let i = 0; i < 2; i++) { 
          const hasShadows = i < 1; 
          const dLight = new DirectionalLight(`pool_dir_${i}`, new Vector3(0, -1, 0), scene);
          dLight.intensity = 0; dLight.diffuse = Color3.Black(); 
          dLight.shadowEnabled = hasShadows; 
          Tags.AddTagsTo(dLight, "system_element");

          let dSg: ShadowGenerator | null = null;
          if (hasShadows) { 
              dSg = new ShadowGenerator(1024, dLight);
              dSg.usePercentageCloserFiltering = true; dSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
              dSg.setDarkness(0.0); dSg.bias = 0.001; dSg.normalBias = 0.015; dSg.forceBackFacesOnly = false;
          }
          this.dirPool.push({ index: i, type: 'directional', light: dLight, sg: dSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      this.isInitialized = true;
  }

  // 🔥 FIX FASE 1: Reseteo Suave para Runtime (Libera lógica, no WebGL)
  public resetPools(): void {
      const topUids = new Set<string>(); // Set vacío fuerza la liberación total
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

  // 🔥 FIX FASE 1: Reseteo Duro (Destruye WebGL). Renombrado de clearPools a disposePools.
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