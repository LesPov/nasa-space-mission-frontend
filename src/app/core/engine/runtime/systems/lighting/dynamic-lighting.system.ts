
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, Vector3, Color3, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../../world/world-settings.service';

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private worldSettingsSvc = inject(WorldSettingsService);

  private readonly MAX_POOLED_LIGHTS = 3;
  private lightPool: PointLight[] = [];
  private isInitialized = false;

  private initPool(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    
    scene.lights.forEach(l => {
      if (l.name.startsWith('pooled_light_')) l.dispose();
    });
    this.lightPool = [];

    for (let i = 0; i < this.MAX_POOLED_LIGHTS; i++) {
      const pl = new PointLight(`pooled_light_${i}`, Vector3.Zero(), scene);
      pl.intensity = 0;
      pl.diffuse = Color3.Black();
      pl.specular = Color3.Black();
      Tags.AddTagsTo(pl, "system_element");
      this.lightPool.push(pl);
    }
    this.isInitialized = true;
  }

  public start(): void {
      // Las luces se inician automáticamente en el update
  }

  public stop(): void {
    this.lightPool.forEach(l => l.dispose());
    this.lightPool = [];
    this.isInitialized = false;
  }

  public update(dtMs: number): void {
    const scene = this.motor3d.getScene();
    // 🔥 FIX: Permite que las luces funcionen tanto con la cámara del jugador como con la del Editor
    const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
    
    if (!scene || !camera) return;

    if (!this.isInitialized || this.lightPool.length === 0) {
        this.initPool();
    }

    const lightEntities = this.entityManager.getAllEntities().filter(e => {
       return e.type.startsWith('light_') && e.light && e.light.enabled !== false && e.view;
    });

    const camPos = camera.globalPosition;
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    
    const lightsWithDist = lightEntities.map(e => {
       let pos = e.getAbsolutePosition();
       
       if (e.light!.lightPosX || e.light!.lightPosY || e.light!.lightPosZ) {
           const offset = new Vector3(e.light!.lightPosX || 0, e.light!.lightPosY || 0, e.light!.lightPosZ || 0);
           e.view!.computeWorldMatrix(true);
           pos = Vector3.TransformCoordinates(offset, e.view!.getWorldMatrix());
       }

       return {
         entity: e,
         distSq: Vector3.DistanceSquared(camPos, pos),
         pos: pos
       };
    });

    lightsWithDist.sort((a, b) => a.distSq - b.distSq);

    for (let i = 0; i < this.MAX_POOLED_LIGHTS; i++) {
       const pooledLight = this.lightPool[i];
       
       if (i < lightsWithDist.length) {
          const data = lightsWithDist[i];
          const lComp = data.entity.light!;
          
          const colorHex = isBW ? lComp.lightColorBW : lComp.lightColor;
          const c3 = Color3.FromHexString(colorHex || '#ffffff');
          
          pooledLight.position.copyFrom(data.pos);
          pooledLight.diffuse.copyFrom(c3);
          
          // 🔥 FIX: Ahora el targetIntensity considera tanto Editor como Playmode
          const targetIntensity = lComp.renderIntensity ?? lComp.intensity ?? 1.0;
          pooledLight.intensity += (targetIntensity - pooledLight.intensity) * 0.2; 
          pooledLight.range = lComp.range || 50;
       } else {
          pooledLight.intensity += (0 - pooledLight.intensity) * 0.2; 
       }
    }
  }
}