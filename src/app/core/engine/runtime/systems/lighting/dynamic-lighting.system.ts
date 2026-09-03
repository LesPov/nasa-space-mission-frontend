
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
    sg: ShadowGenerator | null; // Nullable para PointLights (Optimización)
    assignedUid: string | null;
    targetIntensity: number;
    distSq: number;
    needsShadowUpdate: boolean;
}

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private context = inject(GameContextService); 

  private readonly MAX_POOLED_POINTS = 3;
  private readonly MAX_POOLED_SPOTS = 3;
  
  // 🔥 CONFIGURACIÓN DE RENDIMIENTO OPTIMIZADO (Streaming de Luces)
  private readonly HIGH_QUALITY_RADIUS = 10;
  private readonly PRELOAD_RADIUS = 25;
  private readonly RESIDENT_INTENSITY = 0.01; // Intensidad mínima para mantener shaders activos sin coste visual

  private pointPool: PoolItem[] = [];
  private spotPool: PoolItem[] = [];
  
  private isInitialized = false;
  private shadowCastersCache: AbstractMesh[] = [];
  private frameCounter = 0;

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

    // 🔥 Reducimos resolución a 512. Suficiente para calle y ultra rápido en Hardware Medio.
    const shadowResolution = 512; 

    for (let i = 0; i < this.MAX_POOLED_POINTS; i++) {
      const pl = new PointLight(`pooled_point_${i}`, Vector3.Zero(), scene);
      pl.intensity = this.RESIDENT_INTENSITY; 
      pl.diffuse = Color3.Black();
      pl.specular = Color3.Black();
      Tags.AddTagsTo(pl, "system_element");

      this.pointPool.push({ light: pl, sg: null, assignedUid: null, targetIntensity: this.RESIDENT_INTENSITY, distSq: 0, needsShadowUpdate: false });
    }

    for (let i = 0; i < this.MAX_POOLED_SPOTS; i++) {
      const sl = new SpotLight(`pooled_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 2, 2, scene);
      sl.intensity = this.RESIDENT_INTENSITY; 
      sl.diffuse = Color3.Black();
      sl.specular = Color3.Black();
      Tags.AddTagsTo(sl, "system_element");

      const ssg = new ShadowGenerator(shadowResolution, sl);
      
      ssg.usePercentageCloserFiltering = true;
      ssg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM; 
      ssg.setDarkness(0.5); 
      ssg.bias = 0.002;
      ssg.normalBias = 0.01;
      
      this.spotPool.push({ light: sl, sg: ssg, assignedUid: null, targetIntensity: this.RESIDENT_INTENSITY, distSq: 0, needsShadowUpdate: false });
    }
    
    this.isInitialized = true;

    // 🔥 WARM-UP DE SHADERS: Fuerza TODAS las mallas al renderList durante la pantalla de carga.
    // Esto obliga a compilar los Shadow Shaders antes de iniciar el gameplay, eliminando el Lag Spike.
    this.updateShadowCasters(true);
    
    this.spotPool.forEach(p => {
        if (p.sg) {
            const rList = p.sg.getShadowMap()?.renderList;
            if (rList) {
                rList.length = 0;
                this.shadowCastersCache.forEach(m => rList.push(m));
            }
        }
    });
  }

  public start(): void {
      this.frameCounter = 0;
      if (this.isInitialized) {
          // Una vez el juego inicia de verdad, cortamos el exceso de casters masivos
          // y marcamos las sombras para que se repueblen solo con lo cercano.
          this.updateShadowCasters(false);
          this.spotPool.forEach(p => p.needsShadowUpdate = true);
      }
  }

  public stop(): void {
    this.pointPool.forEach(p => { p.light.dispose(); p.sg?.dispose(); });
    this.spotPool.forEach(p => { p.light.dispose(); p.sg?.dispose(); });
    this.pointPool = [];
    this.spotPool = [];
    this.shadowCastersCache = [];
    this.isInitialized = false;
  }

  private updateShadowCasters(forceAll: boolean = false) {
      this.shadowCastersCache = [];
      const refPos = this.getReferencePosition();
      const maxCasterDistSq = 900; // ~30 metros alrededor del jugador

      this.entityManager.getAllEntities().forEach(e => {
          if (e.view && e.view.isVisible && e.view.isEnabled()) {
              if (forceAll || Vector3.DistanceSquared(refPos, e.view.getAbsolutePosition()) < maxCasterDistSq) {
                  if (e.characterConfig || (e.visual?.isSolid && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                      const addMeshToShadows = (m: AbstractMesh) => {
                          if (m.isVisible && m.isEnabled()) {
                              this.shadowCastersCache.push(m);
                              m.receiveShadows = true; 
                          }
                      };
                      addMeshToShadows(e.view);
                      e.view.getChildMeshes(false).forEach(addMeshToShadows);
                  }
              }
          }
      });

      // Si no es el forceAll inicial, obligar a los spots asignados a repoblarse con esta nueva caché
      if (!forceAll) {
          this.spotPool.forEach(p => {
              if (p.assignedUid) p.needsShadowUpdate = true;
          });
      }
  }

  public update(dtMs: number): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (!this.isInitialized || this.pointPool.length === 0) {
        this.initPool();
    }

    this.frameCounter++;
    if (this.frameCounter % 60 === 0) {
        this.updateShadowCasters(false);
    }

    const lightEntities = this.entityManager.getAllEntities().filter(e => {
       return e.type.startsWith('light_') && e.light && e.light.enabled !== false && e.view;
    });

    const refPos = this.getReferencePosition();
    const activeCam = this.ownership.getCamera() || this.motor3d.getEditorCamera();
    const forwardDir = activeCam ? activeCam.getDirection(Vector3.Forward()) : Vector3.Forward();
    
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    
    const lightsData = lightEntities.map(e => {
       let pos = e.getAbsolutePosition();
       if (e.light!.lightPosX || e.light!.lightPosY || e.light!.lightPosZ) {
           const offset = new Vector3(e.light!.lightPosX || 0, e.light!.lightPosY || 0, e.light!.lightPosZ || 0);
           e.view!.computeWorldMatrix(true);
           pos = Vector3.TransformCoordinates(offset, e.view!.getWorldMatrix());
       }
       
       const baseDistSq = Vector3.DistanceSquared(refPos, pos);
       const dirToLight = pos.subtract(refPos).normalize();
       const dot = Vector3.Dot(dirToLight, forwardDir);
       
       const dirMultiplier = dot > 0.3 ? 0.4 : (dot < -0.3 ? 2.5 : 1.0);
       const intensity = Math.max(0.1, e.light!.renderIntensity ?? e.light!.intensity ?? 1.0);
       const score = (baseDistSq * dirMultiplier) / intensity;

       return { entity: e, distSq: baseDistSq, score, pos: pos };
    });

    const MAX_PRELOAD_SQ = this.PRELOAD_RADIUS * this.PRELOAD_RADIUS;
    
    const pointsData = lightsData.filter(d => d.entity.type !== 'light_spot' && d.distSq < MAX_PRELOAD_SQ).sort((a, b) => a.score - b.score);
    const spotsData = lightsData.filter(d => d.entity.type === 'light_spot' && d.distSq < MAX_PRELOAD_SQ).sort((a, b) => a.score - b.score);

    const activePoints = pointsData.slice(0, this.MAX_POOLED_POINTS);
    const activeSpots = spotsData.slice(0, this.MAX_POOLED_SPOTS);

    this.processPool(this.pointPool, activePoints, isBW, dtMs);
    this.processPool(this.spotPool, activeSpots, isBW, dtMs);
  }

  private processPool(pool: PoolItem[], activeLightsData: any[], isBW: boolean, dtMs: number) {
      const lerpSpeed = Math.min(1.0, dtMs * 0.005); 
      
      // Sincronizar distancias actuales para saber si se nos escapan
      for (const item of pool) {
          if (item.assignedUid) {
              const data = activeLightsData.find(d => d.entity.uid === item.assignedUid);
              if (data) {
                  item.distSq = data.distSq;
              } else {
                  // La luz sale de la zona de preload. Se inicia el Fade Out hacia el estado Residente.
                  item.targetIntensity = this.RESIDENT_INTENSITY; 
              }
          }
      }

      const activeUids = new Set(activeLightsData.map(d => d.entity.uid));

      // Liberar residentes que ya terminaron su Fade Out
      for (const item of pool) {
          if (item.assignedUid && !activeUids.has(item.assignedUid)) {
              if (item.light.intensity <= this.RESIDENT_INTENSITY + 0.01) {
                  item.assignedUid = null;
                  item.light.intensity = this.RESIDENT_INTENSITY;
                  
                  // 🔥 FIX DE GPU MASIVO: Vaciar sombras para luces liberadas (Ahorra Draw Calls instantáneamente)
                  if (item.sg && item.sg.getShadowMap()?.renderList) {
                      item.sg.getShadowMap()!.renderList!.length = 0; 
                  }
              }
          }
      }

      // Reasignación y actualización de parámetros
      for (const data of activeLightsData) {
          let poolItem = pool.find(p => p.assignedUid === data.entity.uid);
          
          if (!poolItem) {
              poolItem = pool.find(p => p.assignedUid === null);
              
              if (!poolItem) {
                  // Si no hay libres, robamos al menos prioritario que no esté ya en la lista
                  const stealable = pool.filter(p => p.assignedUid !== data.entity.uid && !activeUids.has(p.assignedUid!));
                  if (stealable.length > 0) {
                      stealable.sort((a, b) => a.light.intensity - b.light.intensity);
                      poolItem = stealable[0];
                  }
              }
              
              if (poolItem) {
                  poolItem.assignedUid = data.entity.uid;
                  // 🔥 FORZAR ESTADO RESIDENTE PARA EVITAR POPPING. Aparece sutil y hará Lerp hacia arriba.
                  poolItem.light.intensity = this.RESIDENT_INTENSITY; 
                  poolItem.light.position.copyFrom(data.pos); 
                  poolItem.needsShadowUpdate = true; 
              }
          }

          if (poolItem) {
              const lComp = data.entity.light!;
              const dist = Math.sqrt(data.distSq);
              
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

              // 🔥 LÓGICA DE FADING 10 METROS (SUAVE Y ESTABLE)
              let desiredIntensity = lComp.renderIntensity ?? lComp.intensity ?? 1.0;
              const hqRadius = Math.min(this.HIGH_QUALITY_RADIUS, (lComp.range || 50));
              const fadeRadius = hqRadius + 5; 

              if (dist > fadeRadius) {
                 desiredIntensity = this.RESIDENT_INTENSITY; 
              } else if (dist > hqRadius) {
                 const factor = 1.0 - ((dist - hqRadius) / (fadeRadius - hqRadius));
                 desiredIntensity = Math.max(this.RESIDENT_INTENSITY, desiredIntensity * (factor * factor)); 
              }
              
              poolItem.targetIntensity = desiredIntensity;

              // 🔥 CÁLCULO E INYECCIÓN DE SOMBRAS (Culling super agresivo)
              if (poolItem.sg) {
                  const shadowMap = poolItem.sg.getShadowMap();
                  const rList = shadowMap?.renderList;

                  // Desactivamos la lista si la luz es tenue o no emite sombra
                  if (lComp.castShadows === false || poolItem.targetIntensity <= this.RESIDENT_INTENSITY + 0.01) {
                      if (rList && rList.length > 0) {
                          rList.length = 0; 
                          poolItem.needsShadowUpdate = true; // Regenerar solo cuando se vuelva a encender
                      }
                  } else if (poolItem.needsShadowUpdate && rList) {
                      rList.length = 0;
                      const lightPos = poolItem.light.getAbsolutePosition();
                      const lRange = lComp.range || 50;
                      // Filtro matemático estricto: Solo lo que está en el cono cercano + margen de sombra
                      const maxShadowDistSq = (lRange + 2) * (lRange + 2);
                      
                      for (let i = 0; i < this.shadowCastersCache.length; i++) {
                          const m = this.shadowCastersCache[i];
                          if (Vector3.DistanceSquared(m.getAbsolutePosition(), lightPos) <= maxShadowDistSq) {
                              rList.push(m);
                          }
                      }
                      poolItem.needsShadowUpdate = false;
                  }
              }
          }
      }

      // Proceso final de interpolación de intensidades
      for (const item of pool) {
          if (Math.abs(item.light.intensity - item.targetIntensity) > 0.005) {
              item.light.intensity += (item.targetIntensity - item.light.intensity) * lerpSpeed;
          } else {
              item.light.intensity = item.targetIntensity;
          }
      }
  }
}