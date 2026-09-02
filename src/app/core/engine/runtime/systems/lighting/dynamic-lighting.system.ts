
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, SpotLight, Vector3, Color3, Tags, ShadowGenerator, AbstractMesh } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';

interface PoolItem {
    light: PointLight | SpotLight;
    sg: ShadowGenerator;
    assignedUid: string | null;
    targetIntensity: number;
    distSq: number;
}

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private context = inject(GameContextService); 

  // 🔥 LÍMITE ESTRICTO DE 3 LUCES PARA EVITAR LAG
  private readonly MAX_POOLED_POINTS = 3;
  private readonly MAX_POOLED_SPOTS = 3;

  private pointPool: PoolItem[] = [];
  private spotPool: PoolItem[] = [];
  
  private isInitialized = false;
  private shadowCastersCache: AbstractMesh[] = [];
  private frameCounter = 0;

  // 🔥 OBTIENE LA POSICIÓN DEL JUGADOR (NO DE LA CÁMARA) PARA MEDIR DISTANCIAS
  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      return camera ? camera.globalPosition : Vector3.Zero();
  }

  private initPool(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    
    scene.lights.forEach(l => {
      if (l.name.startsWith('pooled_point_') || l.name.startsWith('pooled_spot_')) l.dispose();
    });
    this.pointPool = [];
    this.spotPool = [];

    // 🔥 OPTIMIZACIÓN DE SOMBRAS: Reducido a 512 de forma estricta para evitar lag crítico de compilación en Admin/Player Preview
    const shadowResolution = 512; 

    for (let i = 0; i < this.MAX_POOLED_POINTS; i++) {
      const pl = new PointLight(`pooled_point_${i}`, Vector3.Zero(), scene);
      pl.intensity = 0.01; // Arranca en 0.01 para mantener shader compilado
      pl.diffuse = Color3.Black();
      pl.specular = Color3.Black();
      Tags.AddTagsTo(pl, "system_element");

      const psg = new ShadowGenerator(shadowResolution, pl);
      // 🔥 FIX MAGISTRAL: POINT LIGHT NO SOPORTA PCF (Percentage Closer Filtering) en BabylonJS.
      // Si se activa, las sombras no se ven en el piso o se glitchean. Usamos Poisson.
      psg.usePercentageCloserFiltering = false;
      psg.usePoissonSampling = true; 
      // Bias súper estricto para objetos en el suelo
      psg.bias = 0.001;
      psg.normalBias = 0.005;
      
      this.pointPool.push({ light: pl, sg: psg, assignedUid: null, targetIntensity: 0.01, distSq: 0 });
    }

    for (let i = 0; i < this.MAX_POOLED_SPOTS; i++) {
      const sl = new SpotLight(`pooled_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 2, 2, scene);
      sl.intensity = 0.01; 
      sl.diffuse = Color3.Black();
      sl.specular = Color3.Black();
      Tags.AddTagsTo(sl, "system_element");

      const ssg = new ShadowGenerator(shadowResolution, sl);
      // SpotLights SI soportan PCF
      ssg.usePercentageCloserFiltering = true;
      ssg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
      ssg.bias = 0.001;
      ssg.normalBias = 0.005;
      
      this.spotPool.push({ light: sl, sg: ssg, assignedUid: null, targetIntensity: 0.01, distSq: 0 });
    }
    
    this.isInitialized = true;
    this.updateShadowCasters();
  }

  public start(): void {
      this.frameCounter = 0;
  }

  public stop(): void {
    this.pointPool.forEach(p => { p.light.dispose(); p.sg.dispose(); });
    this.spotPool.forEach(p => { p.light.dispose(); p.sg.dispose(); });
    this.pointPool = [];
    this.spotPool = [];
    this.shadowCastersCache = [];
    this.isInitialized = false;
  }

  private updateShadowCasters() {
      this.shadowCastersCache = [];
      const refPos = this.getReferencePosition();
      
      this.entityManager.getAllEntities().forEach(e => {
          if (e.view && e.view.isVisible && e.view.isEnabled()) {
              // 🔥 AUMENTADO A 150 METROS (150 * 150 = 22500)
              if (Vector3.DistanceSquared(refPos, e.view.getAbsolutePosition()) < 22500) {
                  if (e.characterConfig || (e.visual?.isSolid && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                      
                      // 🔥 FIX: Todo lo que esté cerca entra al generador de sombras dinámico
                      const addMeshToShadows = (m: AbstractMesh) => {
                          if (m.isVisible && m.isEnabled()) {
                              this.shadowCastersCache.push(m);
                              m.receiveShadows = true; // Fundamental para que la calle/piso reciba sombras
                          }
                      };

                      addMeshToShadows(e.view);
                      e.view.getChildMeshes(false).forEach(addMeshToShadows);
                  }
              }
          }
      });

      // 🔥 ASIGNACIÓN MASIVA: Todos los focos comparten la misma lista de mallas.
      [...this.pointPool, ...this.spotPool].forEach(item => {
          const renderList = item.sg.getShadowMap()?.renderList;
          if (renderList) {
              renderList.length = 0;
              renderList.push(...this.shadowCastersCache);
          }
      });
  }

  public update(dtMs: number): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (!this.isInitialized || this.pointPool.length === 0) {
        this.initPool();
    }

    this.frameCounter++;
    // Refresca la caché global de sombras cada medio segundo en lugar de cada frame
    if (this.frameCounter % 30 === 0) {
        this.updateShadowCasters();
    }

    const lightEntities = this.entityManager.getAllEntities().filter(e => {
       return e.type.startsWith('light_') && e.light && e.light.enabled !== false && e.view;
    });

    const refPos = this.getReferencePosition();
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    
    const lightsData = lightEntities.map(e => {
       let pos = e.getAbsolutePosition();
       if (e.light!.lightPosX || e.light!.lightPosY || e.light!.lightPosZ) {
           const offset = new Vector3(e.light!.lightPosX || 0, e.light!.lightPosY || 0, e.light!.lightPosZ || 0);
           e.view!.computeWorldMatrix(true);
           pos = Vector3.TransformCoordinates(offset, e.view!.getWorldMatrix());
       }
       return { entity: e, distSq: Vector3.DistanceSquared(refPos, pos), pos: pos };
    });

    const pointsData = lightsData.filter(d => d.entity.type !== 'light_spot').sort((a, b) => a.distSq - b.distSq);
    const spotsData = lightsData.filter(d => d.entity.type === 'light_spot').sort((a, b) => a.distSq - b.distSq);

    const activePoints = pointsData.slice(0, this.MAX_POOLED_POINTS);
    const activeSpots = spotsData.slice(0, this.MAX_POOLED_SPOTS);

    // 🔥 PRECARGA SUPER LEJANA (400 metros)
    this.processPool(this.pointPool, activePoints, isBW, dtMs, 400);
    this.processPool(this.spotPool, activeSpots, isBW, dtMs, 400);
  }

  private processPool(pool: PoolItem[], allLightsData: any[], isBW: boolean, dtMs: number, maxDist: number) {
      // Interpolación extremadamente suave (Lerp) independiente de FPS
      const lerpSpeed = Math.min(1.0, dtMs * 0.003); 
      
      for (const item of pool) {
          if (item.assignedUid) {
              const data = allLightsData.find(d => d.entity.uid === item.assignedUid);
              if (data) item.distSq = data.distSq;
              else item.targetIntensity = 0.01; // Nunca llegar a 0
          }
      }

      allLightsData.sort((a, b) => a.distSq - b.distSq);
      const closestData = allLightsData.slice(0, pool.length);
      const closestUids = new Set(closestData.map(d => d.entity.uid));

      for (const item of pool) {
          if (item.assignedUid && !closestUids.has(item.assignedUid)) {
              item.targetIntensity = 0.01;
              if (item.light.intensity <= 0.015) {
                  item.assignedUid = null;
                  item.light.intensity = 0.01;
              }
          }
      }

      for (const data of closestData) {
          let poolItem = pool.find(p => p.assignedUid === data.entity.uid);
          
          if (!poolItem) {
              poolItem = pool.find(p => p.assignedUid === null);
              if (poolItem) {
                  poolItem.assignedUid = data.entity.uid;
                  poolItem.light.intensity = 0.01; 
                  poolItem.light.position.copyFrom(data.pos); 
              }
          }

          if (poolItem) {
              const lComp = data.entity.light!;
              
              // 🔥 Si la luz no debe castear sombras, limpiamos la lista
              if (lComp.castShadows === false) {
                  const rList = poolItem.sg.getShadowMap()?.renderList;
                  if (rList && rList.length > 0) rList.length = 0;
              } else {
                  const rList = poolItem.sg.getShadowMap()?.renderList;
                  if (rList && rList.length === 0) {
                      rList.push(...this.shadowCastersCache);
                  }
              }

              const colorHex = isBW ? lComp.lightColorBW : lComp.lightColor;
              poolItem.light.diffuse = Color3.FromHexString(colorHex || '#ffffff');
              poolItem.light.position.copyFrom(data.pos);
              
              if (poolItem.light instanceof SpotLight) {
                  poolItem.light.range = lComp.range || 50;
                  poolItem.light.angle = (lComp.angle || 60) * (Math.PI / 180);
                  if (data.entity.view) {
                      const worldMatrix = data.entity.view.getWorldMatrix();
                      const localDown = Vector3.TransformNormal(new Vector3(0, -1, 0), worldMatrix);
                      poolItem.light.direction.copyFrom(localDown.normalize());
                  } else {
                      poolItem.light.direction.copyFromFloats(0, -1, 0);
                  }
              } else {
                  (poolItem.light as PointLight).range = lComp.range || 50;
              }

              const dist = Math.sqrt(data.distSq);
              const maxDrawDist = Math.max((lComp.range || 50) * 3.0, maxDist); 
              const fadeStart = maxDrawDist * 0.4; 

              let desiredIntensity = lComp.renderIntensity ?? lComp.intensity ?? 1.0;

              // Rampa de atenuación muy natural
              if (dist > maxDrawDist) {
                 desiredIntensity = 0.01; 
              } else if (dist > fadeStart) {
                 const factor = 1.0 - ((dist - fadeStart) / (maxDrawDist - fadeStart));
                 desiredIntensity = Math.max(0.01, desiredIntensity * (factor * factor)); 
              }
              
              poolItem.targetIntensity = desiredIntensity;
          }
      }

      // Animación progresiva suave de las luces
      for (const item of pool) {
          item.light.intensity += (item.targetIntensity - item.light.intensity) * lerpSpeed;
      }
  }
}