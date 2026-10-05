
// file: src/app/core/engine/runtime/systems/lighting/light-pool.service.ts
import { Injectable, inject } from '@angular/core';
import { PointLight, SpotLight, DirectionalLight, ShadowGenerator, Vector3, Color3, Tags, Scene } from '@babylonjs/core';
import { PoolSlot, LIGHT_SPATIAL_CONSTANTS, ShadowTier } from './lighting-types';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { LightContainmentService } from './light-containment.service';
import { LightRegistryService } from './light-registry.service';

@Injectable({ providedIn: 'root' })
export class LightPoolService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private containmentSvc = inject(LightContainmentService);
  private lightRegistry = inject(LightRegistryService);

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

    const MAX_LOCAL_SHADER_LIGHTS = LIGHT_SPATIAL_CONSTANTS.MAX_LOCAL_LIGHTS; // 3 slots

    // CALIBRACIÓN DE RESOLUCIÓN DE SOMBRAS:
    // Los PointLights utilizan mapas de cubos (6 caras por frame). Una resolución de 512x512
    // combinada con Poisson Sampling entrega un sombreado suave y continuo, reduciendo
    // a 1/4 el ancho de banda y fill rate de memoria de video respecto a un mapa de 1024x1024.
    const pointResolutions = [512, 512, 256];
    const spotResolutions = [1024, 1024, 512];
    const tiers: ShadowTier[] = ['HIGH', 'MEDIUM', 'LOW'];

    for (let i = 0; i < MAX_LOCAL_SHADER_LIGHTS; i++) {
      // 1. POINT LIGHTS (Omnidireccionales / Cubemaps)
      const pLight = new PointLight(`pool_point_${i}`, new Vector3(0, -99999, 0), scene);
      pLight.intensity = 0; 
      pLight.diffuse = Color3.Black();
      pLight.specular = Color3.Black();
      pLight.shadowEnabled = true; 
      pLight.shadowMinZ = 0.1;
      pLight.shadowMaxZ = 50.0;
      Tags.AddTagsTo(pLight, "system_element");

      const pSg = new ShadowGenerator(pointResolutions[i], pLight);
      pSg.usePoissonSampling = true;
      pSg.setDarkness(0.0); 
      pSg.bias = 0.002; 
      pSg.normalBias = 0.005; 
      pSg.forceBackFacesOnly = false;
      pSg.useContactHardeningShadow = false;

      this.pointPool.push({ 
        index: i, 
        type: 'point', 
        light: pLight, 
        sg: pSg, 
        assignedEntityUid: null, 
        currentIntensity: 0,
        isStaticLight: true,
        hasDynamicCasters: false,
        shadowTier: tiers[i]
      });

      // 2. SPOT LIGHTS (Focales / Proyecciones 2D)
      const sLight = new SpotLight(`pool_spot_${i}`, new Vector3(0, -99999, 0), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
      sLight.intensity = 0; 
      sLight.diffuse = Color3.Black(); 
      sLight.specular = Color3.Black();
      sLight.shadowEnabled = true; 
      sLight.shadowMinZ = 0.1;
      sLight.shadowMaxZ = 50.0;
      Tags.AddTagsTo(sLight, "system_element");

      const sSg = new ShadowGenerator(spotResolutions[i], sLight);
      sSg.usePercentageCloserFiltering = true; 
      sSg.filteringQuality = i === 0 ? ShadowGenerator.QUALITY_HIGH : (i === 1 ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW);
      sSg.setDarkness(0.0); 
      sSg.bias = 0.0005; 
      sSg.normalBias = 0.002; 
      sSg.forceBackFacesOnly = false;

      this.spotPool.push({ 
        index: i, 
        type: 'spot', 
        light: sLight, 
        sg: sSg, 
        assignedEntityUid: null, 
        currentIntensity: 0,
        isStaticLight: true,
        hasDynamicCasters: false,
        shadowTier: tiers[i]
      });
    }

    // 3. DIRECTIONAL LIGHT (Sol Global)
    const dLight = new DirectionalLight(`pool_dir_0`, new Vector3(0, -1, 0), scene);
    dLight.intensity = 0; 
    dLight.diffuse = Color3.Black(); 
    dLight.specular = Color3.Black();
    dLight.shadowEnabled = true; 
    Tags.AddTagsTo(dLight, "system_element");

    const dSg = new ShadowGenerator(1024, dLight);
    dSg.usePercentageCloserFiltering = true; 
    dSg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    dSg.setDarkness(0.0); 
    dSg.bias = 0.0008; 
    dSg.normalBias = 0.005; 
    dSg.forceBackFacesOnly = false;
    
    this.dirPool.push({ 
      index: 0, 
      type: 'directional', 
      light: dLight, 
      sg: dSg, 
      assignedEntityUid: null, 
      currentIntensity: 0,
      isStaticLight: true,
      hasDynamicCasters: false,
      shadowTier: 'HIGH'
    });

    this.isInitialized = true;
  }

  public resetPools(): void {
    this.getAllSlots().forEach(slot => {
      this.forceHardRelease(slot);
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
    if (!slot.assignedEntityUid || topUids.has(slot.assignedEntityUid)) return;

    const vl = this.lightRegistry.getVirtualLightByUid(slot.assignedEntityUid);
    if (vl && vl.currentMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
      return; 
    }

    this.forceHardRelease(slot);
  }

  public forceHardRelease(slot: PoolSlot): void {
    slot.assignedEntityUid = null;
    if (slot.sg && slot.sg.getShadowMap()?.renderList) {
      slot.sg.getShadowMap()!.renderList!.length = 0; 
    }
    slot.currentIntensity = 0; 
    slot.light.intensity = 0; 
    slot.light.diffuse.set(0, 0, 0);
    slot.light.specular.set(0, 0, 0);
    slot._lightOnTimestamp = undefined;
    slot._shadowReadyTimestamp = undefined;
    slot._isNewAssignment = false;
    slot.isWarmedUp = false;

    if (slot.type !== 'directional') {
      (slot.light as any).position.set(0, -99999, 0);
    }

    const lightAny = slot.light as any;
    if (lightAny.includedOnlyMeshes && lightAny.includedOnlyMeshes.length > 0) {
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
    
    this.pointPool = [];
    this.spotPool = [];
    this.dirPool = [];
    this.isInitialized = false;
    this.currentScene = null;
  }
}