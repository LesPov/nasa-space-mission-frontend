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

interface VirtualLight {
    entity: GameEntity;
    materials: any[];
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
  private containmentSvc = inject(LightContainmentService);

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

  private static _Z_AXIS = new Vector3(0, 0, 1);
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

  /**
   * Obtiene la posición y dirección mundial de la entidad lumínica.
   */
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

  /**
   * Evalúa si una entidad califica ópticamente para ser un bloqueador de luz (Shadow Caster).
   * La oclusión es visual: NO depende de 'isSolid'.
   */
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

      // 1. Recolección de mallas casters y marcación de receivers
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

      // 2. Registro de entidades de luz y recolección de materiales emisivos
      const lightEntities = this.entityManager.getAllEntities().filter(e => e.type.startsWith('light_'));
      for (const e of lightEntities) {
          this.registerOrUpdateVirtualLight(e);
      }

      // 3. Inicialización del Pool de Luces y ShadowGenerators calibrados físicamente
      for(let i = 0; i < this.MAX_LOCAL_SHADER_LIGHTS; i++) {
          const hasShadows = i < this.MAX_SHADOW_LIGHTS;

          // --- POINT LIGHT (CUBEMAP 360°) ---
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

          // --- SPOT LIGHT (2D CONE) ---
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

      // Asignar slots inmediatamente en el primer frame
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
              currentMultiplier: 1.0,
              targetMultiplier: 1.0,
              distSq: 0
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

  /**
   * Reconstruye la lista de renderizado de sombras excluyendo únicamente la bombilla visual de la luz.
   * El poste, mástil o paredes padre PERMANECEN en la renderList para proyectar sombras.
   */
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

  private allocatePoolSlots(): void {
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

      const activeVirtuals = this.virtualLights.filter(vl => 
        isEditor ? (vl.entity.light?.enabled !== false) : (vl.targetMultiplier > 0.01 || vl.currentMultiplier > 0.01)
      );

      // Si hay una entidad seleccionada en el editor, garantizar que tenga prioridad #1 absoluta
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

      if (selectedUid) {
        const selIdx = activeVirtuals.findIndex(v => v.entity.uid === selectedUid);
        if (selIdx > 0) {
          const [selectedItem] = activeVirtuals.splice(selIdx, 1);
          activeVirtuals.unshift(selectedItem);
        }
      } else {
        activeVirtuals.sort((a, b) => a.distSq - b.distSq);
      }

      const topVirtuals = activeVirtuals.slice(0, this.MAX_LOCAL_SHADER_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      const releaseSlot = (slot: PoolSlot) => {
          if (slot.assignedEntityUid && !topUids.has(slot.assignedEntityUid)) {
              slot.assignedEntityUid = null;
              if (slot.sg && slot.sg.getShadowMap()?.renderList) {
                  slot.sg.getShadowMap()!.renderList!.length = 0; 
              }
              this.containmentSvc.clearContainment(slot.light);
          }
      };

      this.pointPool.forEach(releaseSlot);
      this.spotPool.forEach(releaseSlot);

      const scene = this.motor3d.getScene();

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
                      existingSlot.sg.getShadowMap()!.renderList!.length = 0;
                  }
              }

              // Aplicar contención espacial a la luz activa
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

  /**
   * 🔥 SINCRONIZACIÓN INMEDIATA (TIEMPO REAL)
   * Llamada al instante desde PropLight cuando cualquier propiedad del Inspector cambia.
   * Cero delays, cero reconstrucciones de escena, cero recargas.
   */
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

      // 1. Registrar o actualizar en la lista de luces virtuales
      const vl = this.registerOrUpdateVirtualLight(entity);
      vl.baseColor = baseColor;
      vl.currentMultiplier = 1.0;
      vl.targetMultiplier = 1.0;

      // 2. Localizar o asignar slot en el pool
      const isPoint = entity.type === 'light_point';
      const pool = isPoint ? this.pointPool : this.spotPool;

      let slot = pool.find(s => s.assignedEntityUid === entity.uid);
      if (!slot) {
          this.allocatePoolSlots();
          slot = pool.find(s => s.assignedEntityUid === entity.uid);
      }

      // 3. Aplicar propiedades directas sobre la instancia Babylon Light real
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

          const finalIntensity = lightComp.enabled ? (lightComp.intensity ?? 1.0) : 0;
          slot.currentIntensity = finalIntensity;
          slot.light.intensity = finalIntensity;

          const isLightActive = lightComp.enabled && finalIntensity > 0;
          slot.light.setEnabled(isLightActive);

          // Sombras inmediatas
          slot.light.shadowEnabled = lightComp.castShadows;
          if (slot.sg) {
              if (lightComp.castShadows) {
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

          // Contención espacial inmediata
          this.containmentSvc.markDirty(entity.uid);
          this.containmentSvc.applyContainment(slot.light, entity, scene);
      }

      // 4. Actualizar visual de la bombilla en el editor
      if (entity.view) {
          const visual = entity.view.getChildMeshes(false).find(m => 
              Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual
          );
          if (visual && visual.material && visual.material instanceof StandardMaterial) {
              visual.material.emissiveColor.copyFrom(baseColor);
              visual.material.diffuseColor.copyFrom(baseColor);
          }

          // Actualizar materiales de modelos 3D asociados si los hay
          const emissiveScale = (lightComp.intensity / 5);
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
      const refPos = this.getReferencePosition();
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

      // En el editor, los cambios deben ser directos y exactos
      const lerpSpeed = (isFirstFrame || isEditor) ? 1.0 : Math.min(1.0, dtMs * 0.015);

      for(let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.targetMultiplier = 0;
          } else {
              this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
              vl.distSq = Vector3.DistanceSquared(refPos, this._tempPos);
              
              if (isEditor) {
                  // En el editor, NO se atenúa la luz según la distancia de la cámara
                  vl.targetMultiplier = 1.0;
              } else {
                  const dist = Math.sqrt(vl.distSq);
                  if (dist <= 4) vl.targetMultiplier = 1.0;
                  else if (dist >= 30) vl.targetMultiplier = 0.05; 
                  else {
                      const t = (dist - 4) / (30 - 4);
                      vl.targetMultiplier = Math.max(0.05, 1.0 - t);
                  }
              }
          }

          if (isEditor) {
              vl.currentMultiplier = vl.targetMultiplier;
          } else {
              vl.currentMultiplier += (vl.targetMultiplier - vl.currentMultiplier) * lerpSpeed;
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

      if (isFirstFrame || this.frameCounter % 30 === 0) {
          this.allocatePoolSlots();
      }

      const syncSlot = (slot: PoolSlot) => {
          if (!slot.assignedEntityUid) {
              if (isEditor) {
                  slot.currentIntensity = 0;
                  slot.light.intensity = 0;
                  slot.light.diffuse.set(0, 0, 0);
                  if (slot.light.isEnabled()) slot.light.setEnabled(false);
              } else {
                  slot.currentIntensity += (0 - slot.currentIntensity) * lerpSpeed;
                  slot.light.intensity = slot.currentIntensity;
                  if (slot.light.intensity < 0.01) {
                      slot.light.diffuse.set(0, 0, 0);
                      if (slot.light.isEnabled()) slot.light.setEnabled(false); 
                  }
              }
              return;
          }

          const vl = this.virtualLights.find(v => v.entity.uid === slot.assignedEntityUid);
          if (!vl || !vl.entity.light) {
              slot.assignedEntityUid = null;
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

          const animatedIntensity = vl.entity.light.renderIntensity ?? vl.entity.light.intensity ?? 1.0;
          let finalIntensity = animatedIntensity * vl.currentMultiplier;
          if (!vl.entity.light.enabled) finalIntensity = 0;
          else if (!isEditor && vl.currentMultiplier <= 0.06) finalIntensity = 0; 

          if (isEditor) {
              slot.currentIntensity = finalIntensity;
              slot.light.intensity = finalIntensity;
          } else {
              slot.currentIntensity += (finalIntensity - slot.currentIntensity) * lerpSpeed;
              slot.light.intensity = slot.currentIntensity;
          }

          const isEnabled = vl.entity.light.enabled && slot.light.intensity > 0;
          if (slot.light.isEnabled() !== isEnabled) {
              slot.light.setEnabled(isEnabled);
          }

          // Aplicar contención espacial en cada frame
          this.containmentSvc.applyContainment(slot.light, vl.entity, scene);
      };

      this.pointPool.forEach(syncSlot);
      this.spotPool.forEach(syncSlot);

      if (this.shouldLogSummary && this.frameCounter % 60 === 0) {
          this.shouldLogSummary = false;
      }
  }
}