
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, SpotLight, Vector3, Color3, Tags, ShadowGenerator, AbstractMesh } from '@babylonjs/core';
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
  private pointPool: PointLight[] = [];
  private spotPool: SpotLight[] = [];
  private pointShadows: ShadowGenerator[] = [];
  private spotShadows: ShadowGenerator[] = [];
  private isInitialized = false;

  // 🔥 CACHÉ PARA EVITAR BAJONES DE FPS
  private shadowCastersCache: AbstractMesh[] = [];
  private frameCounter = 0;

  private initPool(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    
    scene.lights.forEach(l => {
      if (l.name.startsWith('pooled_point_') || l.name.startsWith('pooled_spot_')) l.dispose();
    });
    this.pointPool = [];
    this.spotPool = [];
    this.pointShadows = [];
    this.spotShadows = [];

    for (let i = 0; i < this.MAX_POOLED_LIGHTS; i++) {
      // 1. Point Light (Para bombillas omnidireccionales)
      const pl = new PointLight(`pooled_point_${i}`, Vector3.Zero(), scene);
      pl.intensity = 0;
      pl.diffuse = Color3.Black();
      pl.specular = Color3.Black();
      Tags.AddTagsTo(pl, "system_element");
      this.pointPool.push(pl);

      const psg = new ShadowGenerator(512, pl);
      psg.usePercentageCloserFiltering = true;
      psg.filteringQuality = ShadowGenerator.QUALITY_LOW;
      this.pointShadows.push(psg);

      // 2. Spot Light (Para los faros/reflectores dirigidos)
      const sl = new SpotLight(`pooled_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 2, 2, scene);
      sl.intensity = 0;
      sl.diffuse = Color3.Black();
      sl.specular = Color3.Black();
      Tags.AddTagsTo(sl, "system_element");
      this.spotPool.push(sl);

      const ssg = new ShadowGenerator(1024, sl);
      ssg.usePercentageCloserFiltering = true;
      ssg.filteringQuality = ShadowGenerator.QUALITY_LOW;
      this.spotShadows.push(ssg);
    }
    this.isInitialized = true;
    this.updateShadowCasters();
  }

  public start(): void {
      this.frameCounter = 0;
  }

  public stop(): void {
    this.pointPool.forEach(l => l.dispose());
    this.spotPool.forEach(l => l.dispose());
    this.pointShadows.forEach(sg => sg.dispose());
    this.spotShadows.forEach(sg => sg.dispose());
    
    this.pointPool = [];
    this.spotPool = [];
    this.pointShadows = [];
    this.spotShadows = [];
    this.shadowCastersCache = [];
    this.isInitialized = false;
  }

  // 🔥 ACTUALIZACIÓN EN CACHÉ (Evita procesar 5000 meshes por frame)
  private updateShadowCasters() {
      this.shadowCastersCache = [];
      this.entityManager.getAllEntities().forEach(e => {
          if (e.view && e.view.isVisible) {
              if (e.characterConfig || (e.visual?.isSolid && e.type !== 'plane' && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                  this.shadowCastersCache.push(e.view as AbstractMesh);
                  e.view.getChildMeshes().forEach(m => {
                      if (m.isVisible) this.shadowCastersCache.push(m as AbstractMesh);
                  });
              }
          }
      });
  }

  public update(dtMs: number): void {
    const scene = this.motor3d.getScene();
    const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
    
    if (!scene || !camera) return;

    if (!this.isInitialized || this.pointPool.length === 0) {
        this.initPool();
    }

    // Refrescar caché de sombras 1 vez por segundo (60 frames) para mantener rendimiento perfecto
    this.frameCounter++;
    if (this.frameCounter % 60 === 0) {
        this.updateShadowCasters();
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
       const pLight = this.pointPool[i];
       const sLight = this.spotPool[i];
       const pSg = this.pointShadows[i];
       const sSg = this.spotShadows[i];
       
       if (i < lightsWithDist.length) {
          const data = lightsWithDist[i];
          const lComp = data.entity.light!;
          
          const colorHex = isBW ? lComp.lightColorBW : lComp.lightColor;
          const c3 = Color3.FromHexString(colorHex || '#ffffff');
          
          // 🔥 LÓGICA DE FADE POR DISTANCIA (Apagado suave progresivo)
          let targetIntensity = lComp.renderIntensity ?? lComp.intensity ?? 1.0;
          const dist = Math.sqrt(data.distSq);
          
          // Limitamos el renderizado máximo a 60 unidades para optimización extrema.
          const maxDrawDist = Math.min((lComp.range || 50) * 1.5, 60);
          const fadeStart = maxDrawDist * 0.7; // Inicia atenuación al 70% de la distancia máxima
          const fadeEnd = maxDrawDist;         // Se apaga totalmente en el 100%
          
          if (dist > fadeEnd) {
             targetIntensity = 0;
          } else if (dist > fadeStart) {
             const factor = 1.0 - ((dist - fadeStart) / (fadeEnd - fadeStart));
             targetIntensity *= factor;
          }

          if (data.entity.type === 'light_spot') {
              // 💡 USAR FOCO / FARO (Bajo impacto)
              pLight.intensity += (0 - pLight.intensity) * 0.1; // Apagado suave
              
              sLight.position.copyFrom(data.pos);
              sLight.diffuse.copyFrom(c3);
              sLight.intensity += (targetIntensity - sLight.intensity) * 0.1; // Encendido suave
              sLight.range = lComp.range || 50;
              sLight.angle = (lComp.angle || 60) * (Math.PI / 180);

              // Orientación del faro basándose en la rotación del modelo 3D de la escena
              if (data.entity.view) {
                  const worldMatrix = data.entity.view.getWorldMatrix();
                  const localDown = Vector3.TransformNormal(new Vector3(0, -1, 0), worldMatrix);
                  sLight.direction.copyFrom(localDown.normalize());
              } else {
                  sLight.direction.copyFromFloats(0, -1, 0);
              }

              // 🔥 PROYECCIÓN DE SOMBRAS (Caché implementado)
              if (lComp.castShadows && sLight.intensity > 0.05) {
                  const renderList = sSg.getShadowMap()?.renderList;
                  if (renderList && renderList.length !== this.shadowCastersCache.length) {
                      renderList.length = 0;
                      renderList.push(...this.shadowCastersCache);
                  }
              } else {
                  const renderList = sSg.getShadowMap()?.renderList;
                  if (renderList && renderList.length > 0) renderList.length = 0;
              }

          } else {
              // 💡 USAR LUZ OMNIDIRECCIONAL (BOMBILLA)
              sLight.intensity += (0 - sLight.intensity) * 0.1;

              pLight.position.copyFrom(data.pos);
              pLight.diffuse.copyFrom(c3);
              pLight.intensity += (targetIntensity - pLight.intensity) * 0.1;
              pLight.range = lComp.range || 50;

              // 🔥 PROYECCIÓN DE SOMBRAS (Solo la LUZ MÁS CERCANA proyecta para evitar caída masiva de FPS)
              if (lComp.castShadows && pLight.intensity > 0.05 && i === 0) {
                  const renderList = pSg.getShadowMap()?.renderList;
                  if (renderList && renderList.length !== this.shadowCastersCache.length) {
                      renderList.length = 0;
                      renderList.push(...this.shadowCastersCache);
                  }
              } else {
                  const renderList = pSg.getShadowMap()?.renderList;
                  if (renderList && renderList.length > 0) renderList.length = 0;
              }
          }
       } else {
          // Apagar luces sobrantes suavemente
          pLight.intensity += (0 - pLight.intensity) * 0.1; 
          if (pSg.getShadowMap()?.renderList && pSg.getShadowMap()!.renderList!.length > 0) {
              pSg.getShadowMap()!.renderList!.length = 0;
          }
          
          sLight.intensity += (0 - sLight.intensity) * 0.1; 
          if (sSg.getShadowMap()?.renderList && sSg.getShadowMap()!.renderList!.length > 0) {
              sSg.getShadowMap()!.renderList!.length = 0;
          }
       }
    }
  }
}