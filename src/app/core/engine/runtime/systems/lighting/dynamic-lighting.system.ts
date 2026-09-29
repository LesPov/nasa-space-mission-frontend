
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, SpotLight, Vector3, Color3, Tags, ShadowGenerator, AbstractMesh, Matrix } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';
import { GameEntity } from '../../../entities/game.entity';

export type LightVisualState = 'PRELOADED' | 'ACTIVE';

interface VirtualLight {
    entity: GameEntity;
    materials: any[]; // 🔥 FIX PBR: Cambiado a `any` para admitir PBRMaterial
    baseColor: Color3;
    currentMultiplier: number;
    targetMultiplier: number;
    distSq: number;
}

interface PoolSlot {
    index: number;
    type: 'point' | 'spot';
    light: PointLight | SpotLight;
    sg: ShadowGenerator | null; 
    assignedEntityUid: string | null;
    currentIntensity: number;
}

@Injectable({ providedIn: 'root' })
export class DynamicLightingSystem implements IUpdatable {
  public id = 'DynamicLightingSystem';
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private context = inject(GameContextService); 

  private virtualLights: VirtualLight[] = [];
  private pointPool: PoolSlot[] = [];
  private spotPool: PoolSlot[] = [];
  
  private isInitialized = false;
  private shadowCastersCache: AbstractMesh[] = [];
  private frameCounter = 0;

  private MAX_LOCAL_SHADER_LIGHTS = 3;
  private MAX_SHADOW_LIGHTS = 3;

  private lastAssignedSet = '';
  private shouldLogSummary = false;

  private static _localOffset = Vector3.Zero();
  private static _localDir = Vector3.Zero();
  private static _downDir = new Vector3(0, -1, 0);
  private static _localRotMatrix = Matrix.Identity();
  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      return camera ? camera.globalPosition : Vector3.Zero();
  }

  private getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
      if (!entity.view || !entity.light) {
          outPos.set(0, 0, 0);
          outDir.set(0, -1, 0);
          return;
      }

      let targetParent: AbstractMesh = entity.view;
      if (entity.light.attachedNodeName) {
          const found = entity.view.getDescendants(false).find(n => n.name === entity.light!.attachedNodeName);
          if (found) targetParent = found as AbstractMesh;
      }

      targetParent.computeWorldMatrix(true);
      const worldMatrix = targetParent.getWorldMatrix();

      DynamicLightingSystem._localOffset.set(entity.light.lightPosX || 0, entity.light.lightPosY || 0, entity.light.lightPosZ || 0);
      Vector3.TransformCoordinatesToRef(DynamicLightingSystem._localOffset, worldMatrix, outPos);

      const rx = (entity.light.lightRotX || 0) * Math.PI / 180;
      const ry = (entity.light.lightRotY || 0) * Math.PI / 180;
      const rz = (entity.light.lightRotZ || 0) * Math.PI / 180;

      Matrix.RotationYawPitchRollToRef(ry, rx, rz, DynamicLightingSystem._localRotMatrix);
      Vector3.TransformNormalToRef(DynamicLightingSystem._downDir, DynamicLightingSystem._localRotMatrix, DynamicLightingSystem._localDir);
      Vector3.TransformNormalToRef(DynamicLightingSystem._localDir, worldMatrix, outDir);
      outDir.normalize();
  }

  public prepareAllLights(): void {
      const scene = this.motor3d.getScene();
      if (!scene) return;

      this.pointPool.forEach(p => { p.light.dispose(); p.sg?.dispose(); });
      this.spotPool.forEach(p => { p.light.dispose(); p.sg?.dispose(); });
      this.pointPool = [];
      this.spotPool = [];
      this.virtualLights = [];
      this.shadowCastersCache = [];

      const gl = this.motor3d.getEngine()._gl;
      let maxUbo = 12; 
      if (gl && gl.getParameter) {
          maxUbo = gl.getParameter(0x8A2B) || 12; 
      }
      
      const BASE_UBOS = 6;
      const availableUBOsForShadows = Math.max(0, maxUbo - BASE_UBOS);
      this.MAX_SHADOW_LIGHTS = Math.min(3, availableUBOsForShadows);
      this.MAX_LOCAL_SHADER_LIGHTS = 3;

      this.entityManager.getAllEntities().forEach(e => {
          if (e.view && e.view.isVisible && e.view.isEnabled()) {
              if (e.characterConfig || (e.visual?.isSolid && e.type !== 'image_plane' && !e.type.startsWith('light_'))) {
                  const addMesh = (m: AbstractMesh) => {
                      if (m.isVisible && m.isEnabled() && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element")) {
                          this.shadowCastersCache.push(m);
                          m.receiveShadows = true;
                      }
                  };
                  addMesh(e.view);
                  e.view.getChildMeshes(false).forEach(addMesh);
              }
          }
      });

      const lightEntities = this.entityManager.getAllEntities().filter(e => e.type.startsWith('light_'));
      for (const e of lightEntities) {
          const mats: any[] = [];
          if (e.view) {
              if (e.view.material) mats.push(e.view.material);
              e.view.getChildMeshes(false).forEach((m: AbstractMesh) => {
                  if (m.material) { // 🔥 FIX PBR: Removed instanceof StandardMaterial
                     const nL = m.name.toLowerCase();
                     const mL = m.material.name.toLowerCase();
                     if (nL.includes('bulb') || nL.includes('light') || nL.includes('emit') || mL.includes('bulb') || mL.includes('light') || mL.includes('emit')) {
                         const override = e.partOverrides?.overrides[m.name];
                         // 🔥 FIX PARTOVERRIDE CONFLICT: Solo controlamos la luz si el usuario NO ha configurado un color/emisión custom en el PartEditor.
                         if (!override || (override.color === undefined && override.esEmisivo === undefined)) {
                             mats.push(m.material);
                         }
                     }
                  }
              });
          }
          
          this.virtualLights.push({
              entity: e,
              materials: mats,
              baseColor: Color3.FromHexString('#ffffff'), 
              currentMultiplier: 0,
              targetMultiplier: 0,
              distSq: 999999
          });
      }

      for(let i = 0; i < this.MAX_LOCAL_SHADER_LIGHTS; i++) {
          const hasShadows = i < this.MAX_SHADOW_LIGHTS;

          const pLight = new PointLight(`pool_point_${i}`, Vector3.Zero(), scene);
          pLight.intensity = 0; pLight.diffuse = Color3.Black(); 
          pLight.shadowEnabled = hasShadows;
          pLight.setEnabled(false); 
          Tags.AddTagsTo(pLight, "system_element");

          let pSg = null;
          if (hasShadows) {
              pSg = new ShadowGenerator(1024, pLight);
              pSg.usePercentageCloserFiltering = true;
              pSg.filteringQuality = ShadowGenerator.QUALITY_HIGH; 
              pSg.setDarkness(0.35); 
              pSg.bias = 0.0005; 
              pSg.normalBias = 0.01;
          }
          this.pointPool.push({ index: i, type: 'point', light: pLight, sg: pSg, assignedEntityUid: null, currentIntensity: 0 });

          const sLight = new SpotLight(`pool_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
          sLight.intensity = 0; sLight.diffuse = Color3.Black(); 
          sLight.shadowEnabled = hasShadows;
          sLight.setEnabled(false); 
          Tags.AddTagsTo(sLight, "system_element");

          let sSg = null;
          if (hasShadows) { 
              sSg = new ShadowGenerator(1024, sLight);
              sSg.usePercentageCloserFiltering = true;
              sSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
              sSg.setDarkness(0.35); 
              sSg.bias = 0.0005;
              sSg.normalBias = 0.01;
          }
          this.spotPool.push({ index: i, type: 'spot', light: sLight, sg: sSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      this.isInitialized = true;
      this.frameCounter = 0;
      this.shouldLogSummary = true;
  }

  public start(): void {
      this.frameCounter = 0;
  }

  public stop(): void {
      this.pointPool.forEach(p => { 
        if (p.light && !p.light.isDisposed()) p.light.dispose(); 
        if (p.sg) p.sg.dispose(); 
      });
      this.spotPool.forEach(p => { 
        if (p.light && !p.light.isDisposed()) p.light.dispose(); 
        if (p.sg) p.sg.dispose(); 
      });
      this.pointPool = [];
      this.spotPool = [];
      this.virtualLights = [];
      this.shadowCastersCache = [];
      this.isInitialized = false;
      this.lastAssignedSet = '';
  }

  private rebuildShadowRenderList(slot: PoolSlot, entityToExcludeUid: string) {
      if (!slot.sg) return;
      const rList = slot.sg.getShadowMap()?.renderList;
      if (!rList) return;
      rList.length = 0;
      
      const excludeEntity = this.entityManager.getEntityByUid(entityToExcludeUid);
      const parentMeshes = new Set<AbstractMesh>();
      if (excludeEntity?.view) {
          parentMeshes.add(excludeEntity.view);
          excludeEntity.view.getChildMeshes(false).forEach(m => parentMeshes.add(m));
      }
      for(let i=0; i<this.shadowCastersCache.length; i++) {
          const m = this.shadowCastersCache[i];
          if (!parentMeshes.has(m)) {
              rList.push(m);
          }
      }
  }

  private allocatePoolSlots(): void {
      const activeVirtuals = this.virtualLights.filter(vl => vl.targetMultiplier > 0.01 || vl.currentMultiplier > 0.01);
      activeVirtuals.sort((a, b) => a.distSq - b.distSq);

      const topVirtuals = activeVirtuals.slice(0, this.MAX_LOCAL_SHADER_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      const releaseSlot = (slot: PoolSlot) => {
          if (slot.assignedEntityUid && !topUids.has(slot.assignedEntityUid)) {
              slot.assignedEntityUid = null;
              if (slot.sg && slot.sg.getShadowMap()?.renderList) {
                  slot.sg.getShadowMap()!.renderList!.length = 0; 
              }
          }
      };

      this.pointPool.forEach(releaseSlot);
      this.spotPool.forEach(releaseSlot);

      topVirtuals.forEach(vl => {
          const isPoint = vl.entity.type === 'light_point';
          const pool = isPoint ? this.pointPool : this.spotPool;
          const wantsShadow = vl.entity.light?.castShadows !== false;

          let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

          if (!existingSlot) {
              let freeSlot = null;
              if (wantsShadow) freeSlot = pool.find(s => s.sg !== null && s.assignedEntityUid === null);
              if (!freeSlot) freeSlot = pool.find(s => s.sg === null && s.assignedEntityUid === null);
              if (!freeSlot) freeSlot = pool.find(s => s.assignedEntityUid === null);

              if (freeSlot) {
                  freeSlot.assignedEntityUid = vl.entity.uid;
                  freeSlot.currentIntensity = 0; 
                  freeSlot.light.intensity = 0;
                  freeSlot.light.setEnabled(true); 
                  existingSlot = freeSlot;
              }
          }

          if (existingSlot) {
              this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
              existingSlot.light.position.copyFrom(this._tempPos);
              
              if (existingSlot.type === 'spot') {
                  const spot = existingSlot.light as SpotLight;
                  spot.direction.copyFrom(this._tempDir);
              }

              if (existingSlot.sg) {
                  if (wantsShadow) {
                      this.rebuildShadowRenderList(existingSlot, vl.entity.uid);
                  } else {
                      existingSlot.sg.getShadowMap()!.renderList!.length = 0;
                  }
              }
          }
      });

      const newSet = this.spotPool.map(s => s.assignedEntityUid).join() + '|' + this.pointPool.map(p => p.assignedEntityUid).join();
      if (this.lastAssignedSet !== newSet) {
          this.lastAssignedSet = newSet;
          this.shouldLogSummary = true;
      }
  }

  public update(dtMs: number): void {
      const scene = this.motor3d.getScene();
      if (!scene || !this.isInitialized) return;

      this.frameCounter++;
      
      const isFirstFrame = this.frameCounter === 1;
      const refPos = this.getReferencePosition();
      const lerpSpeed = isFirstFrame ? 1.0 : Math.min(1.0, dtMs * 0.015);
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';

      for(let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.targetMultiplier = 0;
          } else {
              this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
              vl.distSq = Vector3.DistanceSquared(refPos, this._tempPos);
              
              const dist = Math.sqrt(vl.distSq);
              if (dist <= 4) vl.targetMultiplier = 1.0;
              else if (dist >= 30) vl.targetMultiplier = 0.05; 
              else {
                  const t = (dist - 4) / (30 - 4);
                  vl.targetMultiplier = Math.max(0.05, 1.0 - t);
              }
          }

          vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * lerpSpeed;

          const hexColor = lightComp ? (isBW ? lightComp.lightColorBW : lightComp.lightColor) : '#ffffff';
          vl.baseColor = Color3.FromHexString(hexColor || '#ffffff');
          
          const animatedIntensity = lightComp?.renderIntensity ?? lightComp?.intensity ?? 1.0;
          const emissiveScale = (animatedIntensity / 5) * vl.currentMultiplier; 
          
          const r = vl.baseColor.r * emissiveScale;
          const g = vl.baseColor.g * emissiveScale;
          const b = vl.baseColor.b * emissiveScale;

          for(let j = 0; j < vl.materials.length; j++) {
              if (vl.materials[j].emissiveColor) {
                  vl.materials[j].emissiveColor.set(r, g, b);
              }
          }
      }

      if (isFirstFrame || this.frameCounter % 30 === 0) {
          this.allocatePoolSlots();
      }

      let activeCount = 0;

      const syncSlot = (slot: PoolSlot) => {
          if (!slot.assignedEntityUid) {
              slot.currentIntensity += (0 - slot.currentIntensity) * lerpSpeed;
              slot.light.intensity = slot.currentIntensity;
              if (slot.light.intensity < 0.01) {
                  slot.light.diffuse.set(0,0,0);
                  if (slot.light.isEnabled()) slot.light.setEnabled(false); 
              } else {
                  activeCount++;
              }
              return;
          }

          if (!slot.light.isEnabled()) slot.light.setEnabled(true);

          const vl = this.virtualLights.find(v => v.entity.uid === slot.assignedEntityUid);
          if (!vl || !vl.entity.light) {
              slot.assignedEntityUid = null;
              return;
          }

          this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          slot.light.position.copyFrom(this._tempPos);
          if (slot.type === 'spot') {
              const spot = slot.light as SpotLight;
              spot.direction.copyFrom(this._tempDir);
              spot.angle = (vl.entity.light.angle || 60) * (Math.PI / 180);
          }

          slot.light.range = vl.entity.light.range || 50;
          slot.light.diffuse.copyFrom(vl.baseColor);

          const animatedIntensity = vl.entity.light.renderIntensity ?? vl.entity.light.intensity ?? 1.0;
          let finalIntensity = animatedIntensity * vl.currentMultiplier;
          if (vl.currentMultiplier <= 0.06) finalIntensity = 0; 

          slot.currentIntensity += (finalIntensity - slot.currentIntensity) * lerpSpeed;
          slot.light.intensity = slot.currentIntensity;

          if (slot.light.intensity > 0.01) activeCount++;
      };

      this.pointPool.forEach(syncSlot);
      this.spotPool.forEach(syncSlot);

      if (this.shouldLogSummary && this.frameCounter % 60 === 0) {
          this.shouldLogSummary = false;
      }
  }
}