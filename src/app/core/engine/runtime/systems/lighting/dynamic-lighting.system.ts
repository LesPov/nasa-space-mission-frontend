
// file: src/app/core/engine/runtime/systems/lighting/dynamic-lighting.system.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, SpotLight, Vector3, Color3, Tags, ShadowGenerator, AbstractMesh, Mesh, StandardMaterial } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';
import { GameEntity } from '../../../entities/game.entity';
import { LightContainmentService } from './light-containment.service';
import { GameMode } from '../../../session/game-mode.model';

export type LightVisualState = 'PRELOADED' | 'ACTIVE';

export interface VirtualLight {
    entity: GameEntity;
    materials: any[];
    baseColor: Color3;
    currentMultiplier: number;
    targetMultiplier: number;
    distSq: number;
    // --- ESTADO DE DISTANCIA E HISTÉRESIS ---
    isLightInRange: boolean;
    isShadowInRange: boolean;
    lastEvaluatedDistance: number;
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
  private containmentSvc = inject(LightContainmentService);

  private virtualLights: VirtualLight[] = [];
  private pointPool: PoolSlot[] = [];
  private spotPool: PoolSlot[] = [];
  
  private isInitialized = false;
  private shadowCastersCache: AbstractMesh[] = [];
  private frameCounter = 0;

  // 🔥 LÍMITES ESTRICTOS DE RENDIMIENTO (MÁXIMO 3 LUCES)
  private MAX_LOCAL_SHADER_LIGHTS = 3;
  private MAX_SHADOW_LIGHTS = 3;

  // 🔥 CONSTANTES PARA FADE Y RENDIMIENTO (Previenen el parpadeo y los saltos visuales)
  private readonly LIGHT_VISUAL_MIN_INTENSITY = 0.0001;
  private readonly LIGHT_DISABLE_THRESHOLD = 0.00001;

  private lastAssignedSet = '';
  private shouldLogSummary = false;

  private static _Z_AXIS = new Vector3(0, 0, 1);
  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public getVirtualLightByUid(uid: string): VirtualLight | undefined {
    return this.virtualLights.find(v => v.entity.uid === uid);
  }

  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      const refMode = customMode || 'AUTO';

      if (refMode === 'CAMERA') {
        const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
        return camera ? camera.globalPosition : Vector3.Zero();
      }

      if (refMode === 'PLAYER') {
        const playerEntity = this.context.activePlayerEntity();
        if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
        }
      }

      // Modo AUTO: En Editor Libre usa la cámara de editor; en Test Live / Juego usa el Player
      if (!isEditor) {
        const playerEntity = this.context.activePlayerEntity();
        if (playerEntity && playerEntity.view) {
            return playerEntity.view.getAbsolutePosition();
        }
      }

      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      return camera ? camera.globalPosition : Vector3.Zero();
  }

  private getLightWorldTransform(entity: GameEntity, outPos: Vector3, outDir: Vector3): void {
      if (!entity.view) {
          outPos.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
          outDir.copyFrom(DynamicLightingSystem._Z_AXIS);
          return;
      }

      entity.view.computeWorldMatrix(true);
      outPos.copyFrom(entity.view.getAbsolutePosition());
      
      if (entity.view.getDirectionToRef) {
          entity.view.getDirectionToRef(DynamicLightingSystem._Z_AXIS, outDir);
      } else {
          outDir.copyFrom(entity.view.getDirection(DynamicLightingSystem._Z_AXIS));
      }
      outDir.normalize();
  }

  private isEligibleShadowCaster(e: GameEntity): boolean {
      if (!e.view || !e.view.isVisible || !e.view.isEnabled()) return false;
      
      if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') {
          return false;
      }

      if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) {
          return false;
      }

      if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') {
          return true;
      }

      const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
      if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
          return true;
      }

      return false;
  }

  public prepareAllLights(): void {
      const scene = this.motor3d.getScene();
      if (!scene) return;

      this.pointPool.forEach(p => { 
        this.containmentSvc.clearContainment(p.light);
        p.light.dispose(); 
        p.sg?.dispose(); 
      });
      this.spotPool.forEach(p => { 
        this.containmentSvc.clearContainment(p.light);
        p.light.dispose(); 
        p.sg?.dispose(); 
      });
      this.pointPool = [];
      this.spotPool = [];
      this.virtualLights = [];
      this.shadowCastersCache = [];
      this.containmentSvc.clearAllCache();

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
          if (this.isEligibleShadowCaster(e) && e.view) {
              const addMesh = (m: AbstractMesh) => {
                  if (m.isVisible && m.isEnabled() && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) {
                      if (m instanceof Mesh && m.getTotalVertices() > 0) {
                          this.shadowCastersCache.push(m);
                      }
                      m.receiveShadows = true;
                  }
              };
              addMesh(e.view);
              e.view.getChildMeshes(false).forEach(addMesh);
          } else if (e.view) {
              if (!Tags.MatchesQuery(e.view, "light_visual || debug_element || proxy_collider")) {
                  e.view.receiveShadows = true;
                  e.view.getChildMeshes(false).forEach(cm => {
                      if (!Tags.MatchesQuery(cm, "light_visual || debug_element || proxy_collider")) {
                          cm.receiveShadows = true;
                      }
                  });
              }
          }
      });

      const lightEntities = this.entityManager.getAllEntities().filter(e => e.type.startsWith('light_'));
      for (const e of lightEntities) {
          this.registerOrUpdateVirtualLight(e);
      }

      for(let i = 0; i < this.MAX_LOCAL_SHADER_LIGHTS; i++) {
          const hasShadows = i < this.MAX_SHADOW_LIGHTS;

          const pLight = new PointLight(`pool_point_${i}`, Vector3.Zero(), scene);
          pLight.intensity = 0; 
          pLight.diffuse = Color3.Black(); 
          pLight.shadowEnabled = hasShadows;
          pLight.setEnabled(false); 
          pLight.shadowMinZ = 0.05;
          Tags.AddTagsTo(pLight, "system_element");

          let pSg: ShadowGenerator | null = null;
          if (hasShadows) {
              pSg = new ShadowGenerator(1024, pLight);
              pSg.usePoissonSampling = true;
              pSg.setDarkness(0.0);
              pSg.bias = 0.002;
              pSg.normalBias = 0.005;
              pSg.forceBackFacesOnly = false;
          }
          this.pointPool.push({ index: i, type: 'point', light: pLight, sg: pSg, assignedEntityUid: null, currentIntensity: 0 });

          const sLight = new SpotLight(`pool_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
          sLight.intensity = 0; 
          sLight.diffuse = Color3.Black(); 
          sLight.shadowEnabled = hasShadows;
          sLight.setEnabled(false); 
          sLight.shadowMinZ = 0.1;
          Tags.AddTagsTo(sLight, "system_element");

          let sSg: ShadowGenerator | null = null;
          if (hasShadows) { 
              sSg = new ShadowGenerator(1024, sLight);
              sSg.usePercentageCloserFiltering = true;
              sSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
              sSg.setDarkness(0.0);
              sSg.bias = 0.001;
              sSg.normalBias = 0.015;
              sSg.forceBackFacesOnly = false;
          }
          this.spotPool.push({ index: i, type: 'spot', light: sLight, sg: sSg, assignedEntityUid: null, currentIntensity: 0 });
      }

      this.isInitialized = true;
      this.frameCounter = 0;
      this.shouldLogSummary = true;

      this.evaluateDistanceAndHysteresis();
      this.allocatePoolSlots();
  }

  public registerOrUpdateVirtualLight(e: GameEntity): VirtualLight {
      let vl = this.virtualLights.find(v => v.entity.uid === e.uid);
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const hexColor = e.light ? (isBW ? e.light.lightColorBW : e.light.lightColor) : '#ffffff';
      const baseColor = Color3.FromHexString(hexColor || '#ffffff');

      if (!vl) {
          const mats: any[] = [];
          if (e.view) {
              const isVisualMesh = Tags.MatchesQuery(e.view, "light_visual") || (e.view as any).metadata?.isLightVisual;
              if (e.view.material && !isVisualMesh) mats.push(e.view.material);
              
              e.view.getChildMeshes(false).forEach((m: AbstractMesh) => {
                  if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) return;
                  if (m.material) {
                     const nL = m.name.toLowerCase();
                     const mL = m.material.name.toLowerCase();
                     if (nL.includes('bulb') || nL.includes('light') || nL.includes('emit') || mL.includes('bulb') || mL.includes('light') || mL.includes('emit')) {
                         const override = e.partOverrides?.overrides[m.name];
                         if (!override || (override.color === undefined && override.esEmisivo === undefined)) {
                             mats.push(m.material);
                         }
                     }
                  }
              });
          }
          vl = {
              entity: e,
              materials: mats,
              baseColor,
              currentMultiplier: 0.0,
              targetMultiplier: 0.0,
              distSq: 0,
              isLightInRange: false,
              isShadowInRange: false,
              lastEvaluatedDistance: 0
          };
          this.virtualLights.push(vl);
      } else {
          vl.entity = e;
          vl.baseColor = baseColor;
      }

      return vl;
  }

  public start(): void {
      this.frameCounter = 0;
  }

  public stop(): void {
      this.pointPool.forEach(p => { 
        this.containmentSvc.clearContainment(p.light);
        if (p.light && !p.light.isDisposed()) p.light.dispose(); 
        if (p.sg) p.sg.dispose(); 
      });
      this.spotPool.forEach(p => { 
        this.containmentSvc.clearContainment(p.light);
        if (p.light && !p.light.isDisposed()) p.light.dispose(); 
        if (p.sg) p.sg.dispose(); 
      });
      this.pointPool = [];
      this.spotPool = [];
      this.virtualLights = [];
      this.shadowCastersCache = [];
      this.containmentSvc.clearAllCache();
      this.isInitialized = false;
      this.lastAssignedSet = '';
  }

  private rebuildShadowRenderList(slot: PoolSlot, entityToExcludeUid: string): void {
      if (!slot.sg) return;
      const rList = slot.sg.getShadowMap()?.renderList;
      if (!rList) return;
      rList.length = 0;
      
      const lightEntity = this.entityManager.getEntityByUid(entityToExcludeUid);
      const lightMesh = lightEntity?.view;

      for (let i = 0; i < this.shadowCastersCache.length; i++) {
          const m = this.shadowCastersCache[i];
          if (!m || m.isDisposed()) continue;

          if (Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual) {
              continue;
          }
          if (lightMesh && m === lightMesh) {
              continue;
          }

          rList.push(m);
      }
  }

  /**
   * 🔥 CÁLCULO DE TRANSICIÓN SUAVE BASADO EN DISTANCIA.
   * Interpola el multiplicador de la luz utilizando una curva `smoothstep`.
   */
  private evaluateDistanceAndHysteresis(): void {
      for (let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.isLightInRange = false;
              vl.isShadowInRange = false;
              vl.targetMultiplier = 0;
              continue;
          }

          const refPos = this.getReferencePosition(lightComp.distanceReferenceMode);
          this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          
          vl.distSq = Vector3.DistanceSquared(refPos, this._tempPos);
          const dist = Math.sqrt(vl.distSq);
          vl.lastEvaluatedDistance = dist;

          // 1. Evaluación de Rango de Luz y Multiplicador (Fade Suave)
          if (lightComp.distanceControlEnabled) {
              const actDist = Math.max(0.1, lightComp.activationDistance ?? 65);
              const deactDist = Math.max(actDist, lightComp.deactivationDistance ?? (actDist + 10));

              // La luz alcanza su brillo original (100%) en el 60% inicial de su radio de activación.
              const fadeStartDist = actDist * 0.6;
              const fadeEndDist = actDist; 

              if (vl.isLightInRange) {
                  // Apagado físico real superada la histéresis
                  if (dist > deactDist) {
                      vl.isLightInRange = false;
                      vl.targetMultiplier = 0;
                  } else {
                      // Curva de atenuación suave
                      if (dist <= fadeStartDist) {
                          vl.targetMultiplier = 1.0;
                      } else if (dist >= fadeEndDist) {
                          // Retenemos el mínimo técnico en vez de 0 absoluto para que el shader
                          // quede compilado y el culling sea invisible, previniendo lag spikes
                          vl.targetMultiplier = this.LIGHT_DISABLE_THRESHOLD;
                      } else {
                          // Interpolación Smoothstep (orgánica)
                          let t = 1.0 - ((dist - fadeStartDist) / (fadeEndDist - fadeStartDist));
                          t = Math.max(0, Math.min(1, t));
                          vl.targetMultiplier = (t * t * (3.0 - 2.0 * t));
                      }
                  }
              } else {
                  // Activación
                  if (dist <= actDist) {
                      vl.isLightInRange = true;
                      if (dist <= fadeStartDist) {
                          vl.targetMultiplier = 1.0;
                      } else {
                          let t = 1.0 - ((dist - fadeStartDist) / (fadeEndDist - fadeStartDist));
                          t = Math.max(0, Math.min(1, t));
                          vl.targetMultiplier = (t * t * (3.0 - 2.0 * t));
                      }
                  } else {
                      vl.targetMultiplier = 0;
                  }
              }
          } else {
              vl.isLightInRange = true;
              vl.targetMultiplier = 1.0;
          }

          // 2. Evaluación de Sombras por Distancia (Manteniendo su lógica original exacta)
          if (vl.isLightInRange && lightComp.castShadows) {
              if (lightComp.distanceShadowsEnabled) {
                  const sActDist = Math.max(0.1, lightComp.shadowActivationDistance ?? 30);
                  const sDeactDist = Math.max(sActDist, lightComp.shadowDeactivationDistance ?? (sActDist + 6));

                  if (vl.isShadowInRange) {
                      if (dist > sDeactDist) {
                          vl.isShadowInRange = false;
                      }
                  } else {
                      if (dist <= sActDist) {
                          vl.isShadowInRange = true;
                      }
                  }
              } else {
                  vl.isShadowInRange = true;
              }
          } else {
              vl.isShadowInRange = false;
          }
      }
  }

  private allocatePoolSlots(): void {
      // Filtrar estrictamente solo aquellas luces virtuales evaluadas como activas en rango
      const activeVirtuals = this.virtualLights.filter(vl => 
          vl.entity.light?.enabled !== false && vl.isLightInRange
      );

      const selectedMesh = this.context.selectedNode() as AbstractMesh;
      let selectedUid: string | null = null;
      if (selectedMesh) {
        if ((selectedMesh as any).metadata?.entityUid) {
          selectedUid = (selectedMesh as any).metadata.entityUid;
        } else {
          const ent = this.entityManager.getEntityByMesh(selectedMesh);
          if (ent) selectedUid = ent.uid;
        }
      }

      // Slot Hysteresis: Prioriza slots ya asignados para evitar flickering
      activeVirtuals.sort((a, b) => {
          if (selectedUid) {
              if (a.entity.uid === selectedUid) return -1;
              if (b.entity.uid === selectedUid) return 1;
          }
          
          const isA_Assigned = this.pointPool.some(s => s.assignedEntityUid === a.entity.uid) || this.spotPool.some(s => s.assignedEntityUid === a.entity.uid);
          const isB_Assigned = this.pointPool.some(s => s.assignedEntityUid === b.entity.uid) || this.spotPool.some(s => s.assignedEntityUid === b.entity.uid);
          
          let distA = a.distSq;
          let distB = b.distSq;
          
          // Mantiene las luces ya procesadas con un peso favorable
          if (isA_Assigned) distA *= 0.8; 
          if (isB_Assigned) distB *= 0.8; 
          
          return distA - distB;
      });

      // 🔥 LÍMITE ESTRUCTURAL: MÁXIMO 3 LUCES SIEMPRE
      const topVirtuals = activeVirtuals.slice(0, this.MAX_LOCAL_SHADER_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      // Soltamos únicamente los slots de luces que se cayeron del Top 3
      const releaseSlot = (slot: PoolSlot) => {
          if (slot.assignedEntityUid && !topUids.has(slot.assignedEntityUid)) {
              slot.assignedEntityUid = null;
              if (slot.sg && slot.sg.getShadowMap()?.renderList) {
                  slot.sg.getShadowMap()!.renderList!.length = 0; 
              }
              slot.currentIntensity = 0;
              slot.light.intensity = 0;
              slot.light.setEnabled(false);
              this.containmentSvc.clearContainment(slot.light);
          }
      };

      this.pointPool.forEach(releaseSlot);
      this.spotPool.forEach(releaseSlot);

      const scene = this.motor3d.getScene();

      topVirtuals.forEach(vl => {
          const isPoint = vl.entity.type === 'light_point';
          const pool = isPoint ? this.pointPool : this.spotPool;
          const wantsShadow = vl.isShadowInRange;

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
                  // 🔥 El Shader compilará aquí, pero como su target es mínimo (fade in), será invisible.
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
                  spot.angle = (vl.entity.light?.angle || 60) * (Math.PI / 180);
              }

              const range = vl.entity.light?.range || 50;
              existingSlot.light.range = range;
              existingSlot.light.shadowMaxZ = range;

              if (existingSlot.sg) {
                  if (wantsShadow) {
                      this.rebuildShadowRenderList(existingSlot, vl.entity.uid);
                      if (vl.entity.light?.containmentMode === 'INTERIOR') {
                          existingSlot.sg.setDarkness(vl.entity.light.shadowDarkness ?? 0.0);
                          existingSlot.sg.bias = vl.entity.light.shadowBias ?? (existingSlot.type === 'point' ? 0.002 : 0.001);
                          existingSlot.sg.normalBias = vl.entity.light.shadowNormalBias ?? (existingSlot.type === 'point' ? 0.005 : 0.015);
                      } else {
                          existingSlot.sg.setDarkness(0.0);
                          existingSlot.sg.bias = existingSlot.type === 'point' ? 0.002 : 0.001;
                          existingSlot.sg.normalBias = existingSlot.type === 'point' ? 0.005 : 0.015;
                      }
                  } else {
                      if (existingSlot.sg.getShadowMap()?.renderList) {
                          existingSlot.sg.getShadowMap()!.renderList!.length = 0;
                      }
                  }
              }

              if (scene) {
                this.containmentSvc.applyContainment(existingSlot.light, vl.entity, scene);
              }
          }
      });

      const newSet = this.spotPool.map(s => s.assignedEntityUid).join() + '|' + this.pointPool.map(p => p.assignedEntityUid).join();
      if (this.lastAssignedSet !== newSet) {
          this.lastAssignedSet = newSet;
          this.shouldLogSummary = true;
      }
  }

  public syncLightImmediate(entity: GameEntity): void {
      if (!this.isInitialized) {
          this.prepareAllLights();
      }

      const scene = this.motor3d.getScene();
      const lightComp = entity.light;
      if (!lightComp || !scene) return;

      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const hexColor = isBW ? lightComp.lightColorBW : lightComp.lightColor;
      const baseColor = Color3.FromHexString(hexColor || '#ffffff');

      const vl = this.registerOrUpdateVirtualLight(entity);
      vl.baseColor = baseColor;

      this.evaluateDistanceAndHysteresis();

      const isPoint = entity.type === 'light_point';
      const pool = isPoint ? this.pointPool : this.spotPool;

      let slot = pool.find(s => s.assignedEntityUid === entity.uid);
      if (!slot && vl.isLightInRange) {
          this.allocatePoolSlots();
          slot = pool.find(s => s.assignedEntityUid === entity.uid);
      }

      this.getLightWorldTransform(entity, this._tempPos, this._tempDir);

      if (slot) {
          slot.light.position.copyFrom(this._tempPos);

          if (slot.type === 'spot') {
              const spot = slot.light as SpotLight;
              spot.direction.copyFrom(this._tempDir);
              spot.angle = (lightComp.angle || 60) * (Math.PI / 180);
          }

          const lightRange = lightComp.range ?? 50;
          slot.light.range = lightRange;
          slot.light.shadowMaxZ = lightRange;
          slot.light.diffuse.copyFrom(baseColor);

          // Si estamos en Editor el cambio es instantáneo, en runtime es suave.
          const finalIntensity = (lightComp.enabled && vl.isLightInRange) ? (lightComp.intensity ?? 1.0) * vl.targetMultiplier : 0;
          
          slot.currentIntensity = finalIntensity;
          slot.light.intensity = finalIntensity;

          const isLightActive = lightComp.enabled && vl.isLightInRange && finalIntensity > this.LIGHT_DISABLE_THRESHOLD;
          slot.light.setEnabled(isLightActive);

          const wantsShadow = vl.isShadowInRange;
          slot.light.shadowEnabled = wantsShadow;

          if (slot.sg) {
              if (wantsShadow) {
                  this.rebuildShadowRenderList(slot, entity.uid);
                  if (lightComp.containmentMode === 'INTERIOR') {
                      slot.sg.setDarkness(lightComp.shadowDarkness ?? 0.0);
                      slot.sg.bias = lightComp.shadowBias ?? (slot.type === 'point' ? 0.002 : 0.001);
                      slot.sg.normalBias = lightComp.shadowNormalBias ?? (slot.type === 'point' ? 0.005 : 0.015);
                  } else {
                      slot.sg.setDarkness(0.0);
                      slot.sg.bias = slot.type === 'point' ? 0.002 : 0.001;
                      slot.sg.normalBias = slot.type === 'point' ? 0.005 : 0.015;
                  }
              } else {
                  if (slot.sg.getShadowMap()?.renderList) {
                      slot.sg.getShadowMap()!.renderList!.length = 0;
                  }
              }
          }

          this.containmentSvc.markDirty(entity.uid);
          this.containmentSvc.applyContainment(slot.light, entity, scene);
      }

      if (entity.view) {
          const visual = entity.view.getChildMeshes(false).find(m => 
              Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual
          );
          if (visual && visual.material && visual.material instanceof StandardMaterial) {
              visual.material.emissiveColor.copyFrom(baseColor);
              visual.material.diffuseColor.copyFrom(baseColor);
          }

          const emissiveScale = (lightComp.intensity / 5) * (vl.isLightInRange ? vl.targetMultiplier : 0.1);
          const r = baseColor.r * emissiveScale;
          const g = baseColor.g * emissiveScale;
          const b = baseColor.b * emissiveScale;

          for (let j = 0; j < vl.materials.length; j++) {
              if (vl.materials[j].emissiveColor) {
                  vl.materials[j].emissiveColor.set(r, g, b);
              }
          }
      }
  }

  public update(dtMs: number): void {
      const scene = this.motor3d.getScene();
      if (!scene || !this.isInitialized) return;

      this.frameCounter++;
      
      const isFirstFrame = this.frameCounter === 1;
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

      // 🔥 LERP BASADO EN TIEMPO REAL: dtMs previene tirones en FPS inestables.
      const lerpSpeed = (isFirstFrame || isEditor) ? 1.0 : Math.min(1.0, dtMs * 0.005);

      this.evaluateDistanceAndHysteresis();

      for(let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          
          if (!lightComp || !vl.entity.view || !lightComp.enabled || !vl.isLightInRange) {
              vl.targetMultiplier = 0;
          }

          // Interpolación suave y orgánica (Fade)
          if (isEditor) {
              vl.currentMultiplier = vl.targetMultiplier;
          } else {
              vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * lerpSpeed;
              if (vl.currentMultiplier < this.LIGHT_DISABLE_THRESHOLD) {
                  vl.currentMultiplier = 0;
              }
          }

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

      if (isFirstFrame || this.frameCounter % 15 === 0) {
          this.allocatePoolSlots();
      }

      const syncSlot = (slot: PoolSlot) => {
          if (!slot.assignedEntityUid) {
              slot.currentIntensity = 0;
              slot.light.intensity = 0;
              slot.light.diffuse.set(0, 0, 0);
              if (slot.light.isEnabled()) slot.light.setEnabled(false);
              return;
          }

          const vl = this.virtualLights.find(v => v.entity.uid === slot.assignedEntityUid);
          if (!vl || !vl.entity.light || !vl.isLightInRange) {
              slot.assignedEntityUid = null;
              slot.currentIntensity = 0;
              slot.light.intensity = 0;
              slot.light.setEnabled(false);
              this.containmentSvc.clearContainment(slot.light);
              return;
          }

          this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
          slot.light.position.copyFrom(this._tempPos);
          if (slot.type === 'spot') {
              const spot = slot.light as SpotLight;
              spot.direction.copyFrom(this._tempDir);
              spot.angle = (vl.entity.light.angle || 60) * (Math.PI / 180);
          }

          const lightRange = vl.entity.light.range || 50;
          slot.light.range = lightRange;
          slot.light.shadowMaxZ = lightRange;
          slot.light.diffuse.copyFrom(vl.baseColor);

          // 🔥 APLICAR LA INTENSIDAD BASADA EN EL MULTIPLICADOR SUAVIZADO
          const animatedIntensity = vl.entity.light.renderIntensity ?? vl.entity.light.intensity ?? 1.0;
          let finalIntensity = animatedIntensity * vl.currentMultiplier;
          if (!vl.entity.light.enabled) finalIntensity = 0;

          slot.currentIntensity = finalIntensity;
          slot.light.intensity = finalIntensity;

          // Habilitar la luz físicamente solo si supera el umbral microscópico para no causar popping visual.
          const isEnabled = vl.entity.light.enabled && slot.light.intensity > this.LIGHT_DISABLE_THRESHOLD;
          if (slot.light.isEnabled() !== isEnabled) {
              slot.light.setEnabled(isEnabled);
          }

          const wantsShadow = vl.isShadowInRange;
          if (slot.sg) {
              const hasCasters = (slot.sg.getShadowMap()?.renderList?.length ?? 0) > 0;
              if (wantsShadow && !hasCasters) {
                  this.rebuildShadowRenderList(slot, vl.entity.uid);
              } else if (!wantsShadow && hasCasters) {
                  slot.sg.getShadowMap()!.renderList!.length = 0;
              }
          }
      };

      this.pointPool.forEach(syncSlot);
      this.spotPool.forEach(syncSlot);
  }
}