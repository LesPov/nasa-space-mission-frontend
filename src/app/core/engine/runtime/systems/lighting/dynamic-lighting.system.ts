
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../../behaviors/services/loop-manager.service';
import { PointLight, SpotLight, Vector3, Color3, Tags, ShadowGenerator, AbstractMesh, Matrix, StandardMaterial } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../../world/world-settings.service';
import { GameContextService } from '../../../session/game-context.service';
import { GameEntity } from '../../../entities/game.entity';

export type LightVisualState = 'PRELOADED' | 'ACTIVE';

interface VirtualLight {
    entity: GameEntity;
    materials: StandardMaterial[];
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

  // LÍMITES ARQUITECTÓNICOS DINÁMICOS
  private MAX_LOCAL_SHADER_LIGHTS = 3;
  private MAX_SHADOW_LIGHTS = 3;

  private lastAssignedSet = '';
  private shouldLogSummary = false;

  // Optimización radical para no generar Garbage Collector durante evaluaciones espaciales
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

  // CORE TRANSFORM MATH: Separa el Transform del Modelo 3D del Local Offset de la Luz
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

      // De Espacio Local a Espacio de Mundo
      DynamicLightingSystem._localOffset.set(entity.light.lightPosX || 0, entity.light.lightPosY || 0, entity.light.lightPosZ || 0);
      Vector3.TransformCoordinatesToRef(DynamicLightingSystem._localOffset, worldMatrix, outPos);

      // Dirección de la Luz con Rotación Propia
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

      // ===================================================================
      // CÁLCULO SEGURO DEL PRESUPUESTO (UBO SAFE BUDGET) PARA EVITAR GL_CRASH
      // ===================================================================
      const gl = this.motor3d.getEngine()._gl;
      let maxUbo = 12; // Mínimo garantizado por el estándar WebGL2
      if (gl && gl.getParameter) {
          maxUbo = gl.getParameter(0x8A2B) || 12; // GL_MAX_VERTEX_UNIFORM_BLOCKS
      }
      
      // Base requerida por Babylon: Scene(1) + Mesh(1) + Material(1) + Hemi(1) + SunShadow(1) + Bones(1) = 6
      const BASE_UBOS = 6;
      const availableUBOsForShadows = Math.max(0, maxUbo - BASE_UBOS);
      
      // Limitamos Shadow Generators a los UBOs sobrantes, pero máximo 3.
      this.MAX_SHADOW_LIGHTS = Math.min(3, availableUBOsForShadows);
      
      // Las luces locales comparten 1 UBO en el StandardMaterial gracias al array interno de Babylon, 
      // así que el límite lo dicta el maxSimultaneousLights del Material (que configuramos a 6 globalmente).
      // (1 Sun + 1 Hemi = 2). Nos quedan 4 slots puros en el Shader. Limitamos a 3 para margen seguro.
      this.MAX_LOCAL_SHADER_LIGHTS = 3;

      // ===================================================================

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

      // 1. REGISTRAR TODAS LAS LUCES COMO "VIRTUALES" (Emissive Bulbs / Resident Lights)
      const lightEntities = this.entityManager.getAllEntities().filter(e => e.type.startsWith('light_'));
      for (const e of lightEntities) {
          const mats: StandardMaterial[] = [];
          if (e.view) {
              if (e.view.material instanceof StandardMaterial) mats.push(e.view.material);
              e.view.getChildMeshes(false).forEach((m: AbstractMesh) => {
                  if (m.material instanceof StandardMaterial) {
                     const nL = m.name.toLowerCase();
                     const mL = m.material.name.toLowerCase();
                     if (nL.includes('bulb') || nL.includes('light') || nL.includes('emit') || mL.includes('bulb') || mL.includes('light') || mL.includes('emit')) {
                         mats.push(m.material);
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

      // 2. CREAR EL POOL GPU FÍSICO ESTABLE (No se destruyen en el loop)
      for(let i = 0; i < this.MAX_LOCAL_SHADER_LIGHTS; i++) {
          const pLight = new PointLight(`pool_point_${i}`, Vector3.Zero(), scene);
          pLight.intensity = 0; pLight.diffuse = Color3.Black(); pLight.shadowEnabled = false;
          pLight.setEnabled(false); // Inicia deshabilitado para ahorrar shader slots de entrada
          Tags.AddTagsTo(pLight, "system_element");

          let pSg = null;
          if (i < this.MAX_SHADOW_LIGHTS) {
              pSg = new ShadowGenerator(512, pLight);
              pSg.usePercentageCloserFiltering = true;
              pSg.filteringQuality = ShadowGenerator.QUALITY_LOW; // Low quality para rendimiento masivo
              pSg.setDarkness(0.5);
              pSg.bias = 0.002;
              pSg.normalBias = 0.01;
          }
          this.pointPool.push({ index: i, type: 'point', light: pLight, sg: pSg, assignedEntityUid: null, currentIntensity: 0 });

          const sLight = new SpotLight(`pool_spot_${i}`, Vector3.Zero(), new Vector3(0, -1, 0), Math.PI/3, 2, scene);
          sLight.intensity = 0; sLight.diffuse = Color3.Black(); sLight.shadowEnabled = false;
          sLight.setEnabled(false); // Inicia deshabilitado
          Tags.AddTagsTo(sLight, "system_element");

          let sSg = null;
          if (i < this.MAX_SHADOW_LIGHTS) { 
              sSg = new ShadowGenerator(512, sLight);
              sSg.usePercentageCloserFiltering = true;
              sSg.filteringQuality = ShadowGenerator.QUALITY_LOW;
              sSg.setDarkness(0.5);
              sSg.bias = 0.002;
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
      this.pointPool.forEach(p => { p.light.dispose(); p.sg?.dispose(); });
      this.spotPool.forEach(p => { p.light.dispose(); p.sg?.dispose(); });
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

      // Priorizar siempre las más cercanas
      activeVirtuals.sort((a, b) => a.distSq - b.distSq);

      const topVirtuals = activeVirtuals.slice(0, this.MAX_LOCAL_SHADER_LIGHTS);
      const topUids = new Set(topVirtuals.map(x => x.entity.uid));

      let activeShadows = 0;

      const releaseSlot = (slot: PoolSlot) => {
          if (slot.assignedEntityUid && !topUids.has(slot.assignedEntityUid)) {
              slot.assignedEntityUid = null;
              // El light.setEnabled(false) lo hace el update cuando la intensidad llega a 0 naturalmente
          }
      };

      this.pointPool.forEach(releaseSlot);
      this.spotPool.forEach(releaseSlot);

      topVirtuals.forEach(vl => {
          const isPoint = vl.entity.type === 'light_point';
          const pool = isPoint ? this.pointPool : this.spotPool;

          let existingSlot = pool.find(s => s.assignedEntityUid === vl.entity.uid);

          if (!existingSlot) {
              const emptySlot = pool.find(s => s.assignedEntityUid === null);
              if (emptySlot) {
                  emptySlot.assignedEntityUid = vl.entity.uid;
                  emptySlot.currentIntensity = 0; 
                  emptySlot.light.intensity = 0;
                  emptySlot.light.setEnabled(true); // Engancha al shader inmediatamente

                  this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
                  emptySlot.light.position.copyFrom(this._tempPos);
                  
                  if (emptySlot.type === 'spot') {
                      const spot = emptySlot.light as SpotLight;
                      spot.direction.copyFrom(this._tempDir);
                  }

                  if (emptySlot.sg) {
                      this.rebuildShadowRenderList(emptySlot, vl.entity.uid);
                  }
                  
                  existingSlot = emptySlot;
              }
          }

          // Inyección del subconjunto de sombras si el Presupuesto y el Material lo autorizan
          if (existingSlot) {
              const wantsShadow = vl.entity.light?.castShadows !== false;
              if (wantsShadow && existingSlot.sg && activeShadows < this.MAX_SHADOW_LIGHTS) {
                  existingSlot.light.shadowEnabled = true;
                  activeShadows++;
              } else {
                  existingSlot.light.shadowEnabled = false;
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
      const refPos = this.getReferencePosition();
      const lerpSpeed = Math.min(1.0, dtMs * 0.015);
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';

      // 1. ACTUALIZAR DISTANCIAS Y EMISIVOS (Para todas las luces residentes/virtuales)
      for(let i = 0; i < this.virtualLights.length; i++) {
          const vl = this.virtualLights[i];
          const lightComp = vl.entity.light;
          
          if (!lightComp || !vl.entity.view || !lightComp.enabled) {
              vl.targetMultiplier = 0;
          } else {
              this.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);
              vl.distSq = Vector3.DistanceSquared(refPos, this._tempPos);
              
              const dist = Math.sqrt(vl.distSq);
              // Curva de caída de intensidad real: 4m -> 100%, 30m -> 5%
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
          
          // COMPOSICIÓN VISUAL DEL BOMBILLO: Animación (RenderIntensity) * Distancia (Multiplier)
          const animatedIntensity = lightComp?.renderIntensity ?? lightComp?.intensity ?? 1.0;
          const emissiveScale = (animatedIntensity / 5) * vl.currentMultiplier; // Dividido por 5 para normalizar bloom
          
          const r = vl.baseColor.r * emissiveScale;
          const g = vl.baseColor.g * emissiveScale;
          const b = vl.baseColor.b * emissiveScale;

          for(let j = 0; j < vl.materials.length; j++) {
              vl.materials[j].emissiveColor.set(r, g, b);
          }
      }

      // 2. LÓGICA ESPACIAL: Seleccionar el TOP Máximo permitido
      if (this.frameCounter % 30 === 0) {
          this.allocatePoolSlots();
      }

      // 3. SINCRONIZAR GPU POOL LIGHTS (Shader local Lights)
      let activeCount = 0;
      let shadowCount = 0;

      const syncSlot = (slot: PoolSlot) => {
          if (!slot.assignedEntityUid) {
              // Fade out natural antes de apagar del shader para no ver un "Pop" negro repentino
              slot.currentIntensity += (0 - slot.currentIntensity) * lerpSpeed;
              slot.light.intensity = slot.currentIntensity;
              if (slot.light.intensity < 0.01) {
                  slot.light.diffuse.set(0,0,0);
                  if (slot.light.isEnabled()) slot.light.setEnabled(false); // Liberar del shader UBO
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

          // COMPOSICIÓN DEL SHADER LOCAL = Animación * Distancia
          const animatedIntensity = vl.entity.light.renderIntensity ?? vl.entity.light.intensity ?? 1.0;
          let finalIntensity = animatedIntensity * vl.currentMultiplier;
          if (vl.currentMultiplier <= 0.06) finalIntensity = 0; 

          // Suavizado físico de la luz que proyecta en el suelo
          slot.currentIntensity += (finalIntensity - slot.currentIntensity) * lerpSpeed;
          slot.light.intensity = slot.currentIntensity;

          if (slot.light.intensity > 0.01) activeCount++;
          if (slot.sg && slot.light.shadowEnabled) shadowCount++;
      };

      this.pointPool.forEach(syncSlot);
      this.spotPool.forEach(syncSlot);

      // LOGGER CONTROLADO (1 VEZ CADA VEZ QUE CAMBIA EL TOP) PARA NO HACER SPAM EN CONSOLA
      if (this.shouldLogSummary && this.frameCounter % 60 === 0) {
          this.shouldLogSummary = false;
          const gl = this.motor3d.getEngine()._gl;
          let maxUbo = 0;
          
          if (gl && gl.getParameter) {
              // 0x8A2B corresponde a gl.MAX_VERTEX_UNIFORM_BLOCKS en WebGL2
              maxUbo = gl.getParameter(0x8A2B) || 0;
          }
          
          const activeVirtuals = this.virtualLights.filter(vl => vl.targetMultiplier > 0.01);

          console.log(`
╔════════ LIGHTING SUMMARY ════════╗
SCENE VIRTUAL LIGHTS: ${this.virtualLights.length}

GLOBAL LIGHTS: 1
LOCAL CANDIDATES: ${activeVirtuals.length}
LOCAL SHADER LIGHTS: ${activeCount} (Max: ${this.MAX_LOCAL_SHADER_LIGHTS})

SHADOW LIGHTS: ${shadowCount} (Max: ${this.MAX_SHADOW_LIGHTS})

UBO SAFE BUDGET: 6 (Scene, Mesh, Mat, Hemi, SunShadow, Bones)
UBO LIMIT (GL): ${maxUbo || 'Desconocido'}
╚══════════════════════════════════╝`);
      }
  }
}