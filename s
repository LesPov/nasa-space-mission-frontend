// ARCHIVO COMPLETO
import { Injectable, inject } from '@angular/core';
import { 
    AbstractMesh, AssetContainer, Color3, Mesh, MeshBuilder, 
    StandardMaterial, TransformNode, Vector3, 
    Tags, Quaternion 
} from '@babylonjs/core';
import '@babylonjs/loaders';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { CoreSceneMaterialService } from '../utils/core-scene-material.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';
import { SceneAssetCacheService } from './scene-asset-cache.service';
import { EngineSessionService } from '../../session/engine-session.service';
import { TransformNormalizer } from './transform-normalizer';

@Injectable({ providedIn: 'root' })
export class CoreModelLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private materialSvc = inject(CoreSceneMaterialService);
  private entityManager = inject(EntityManagerService); 
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private gameContext = inject(GameContextService);
  private assetCache = inject(SceneAssetCacheService);
  private sessionSvc = inject(EngineSessionService);

  private masterMeshesCache = new Map<string, Mesh>();

  public clearMasterCache(): void {
    this.masterMeshesCache.forEach(m => {
      if (m && !m.isDisposed()) m.dispose();
    });
    this.masterMeshesCache.clear();
  }

  public async getCachedAssetContainer(fullPath: string, scene: any): Promise<AssetContainer> {
    const extension = fullPath.substring(fullPath.lastIndexOf('.'));
    const container = await this.assetCache.getFreshAssetContainer(fullPath, scene, extension);
    
    container.materials.forEach(mat => {
      if (!scene.materials.includes(mat)) scene.addMaterial(mat);
    });
    container.textures.forEach(tex => {
      if (!scene.textures.includes(tex)) scene.addTexture(tex);
    });

    return container;
  }

  public async cargarModeloAsync(obj: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const scene = this.motor3d.getScene();
    const sessionId = this.sessionSvc.getSessionId();
    const path = obj.properties?.path || obj.asset?.path || obj.path;

    if (!path) {
      await this.crearMallaError(obj, scene, mallasCreadas);
      return;
    }

    const fullPath = 'http://localhost:4000' + path;
    const isLight = obj.type?.startsWith('light_');
    const rolSaved = obj.properties?.rol || obj.rol || (isLight ? 'light' : 'prop');
    
    const entityType = obj.type; 
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, entityType, rolSaved);
    this.persistenceMapper.applyDbToEntity(obj, entity);
    entity.transform.scale = TransformNormalizer.sanitizeScaleVector(entity.transform.scale, entity.name);

    try {
      const container = await this.getCachedAssetContainer(fullPath, scene);
      if (!this.sessionSvc.isSessionActive(sessionId) || scene.isDisposed) { 
        container.dispose(); 
        return; 
      }

      const instances = container.instantiateModelsToScene(
        name => (name ? `${obj.uid}_${name}` : `${obj.uid}_mesh`), 
        false, 
        { doNotInstantiate: true }
      );
      
      const wrapperMesh = new Mesh(obj.name, scene);
      instances.rootNodes.forEach(node => {
        node.parent = wrapperMesh;
      });
      
      instances.animationGroups.forEach(ag => {
        ag.stop();
        ag.speedRatio = 1.0;
      });
      entity.animationNames = instances.animationGroups.map(a => a.name);

      wrapperMesh.computeWorldMatrix(true);

      if (obj.properties?.internalScale !== undefined && obj.properties?.internalScale !== null) {
        const compensacion = TransformNormalizer.sanitizeScale(obj.properties.internalScale, 'internalScale', entity.name);
        wrapperMesh.getChildren().forEach(node => {
          if (node instanceof TransformNode && node.scaling) {
            node.scaling.scaleInPlace(compensacion);
          }
        });
        wrapperMesh.computeWorldMatrix(true);
      }
      
      if (obj.isNewCreation) delete obj.isNewCreation;
      
      await this.aplicarTransformacionesYEntidad(wrapperMesh, entity, obj, mallasCreadas);
    } catch (e) {
      console.error(`[CoreModelLoader] Error cargando GLB ${path}:`, e);
      if (this.sessionSvc.isSessionActive(sessionId) && !scene.isDisposed) {
        await this.crearMallaError(obj, scene, mallasCreadas);
      }
    }
  }

  private async crearMallaError(obj: any, scene: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const fallbackMesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
    const fallbackMat = new StandardMaterial('error_mat', scene);
    fallbackMat.wireframe = true;
    fallbackMat.emissiveColor = new Color3(1, 0, 0); 
    fallbackMesh.material = fallbackMat;
    
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, 'model', 'prop');
    this.persistenceMapper.applyDbToEntity(obj, entity);
    entity.transform.scale = TransformNormalizer.sanitizeScaleVector(entity.transform.scale, entity.name);
    
    await this.aplicarTransformacionesYEntidad(fallbackMesh, entity, obj, mallasCreadas);
  }

  private async aplicarTransformacionesYEntidad(
    rootNode: Mesh, 
    entity: GameEntity, 
    objRaw: any, 
    mallasCreadas: Map<string, Mesh>
  ): Promise<void> {
    const scene = this.motor3d.getScene();
    const isLight = entity.type.startsWith('light_');
    const isCharacter = entity.type === 'character' || entity.rol === 'player';

    const scaleX = TransformNormalizer.sanitizeScale(entity.transform.scale.x, 'scale.x', entity.name);
    const scaleY = TransformNormalizer.sanitizeScale(entity.transform.scale.y, 'scale.y', entity.name);
    const scaleZ = TransformNormalizer.sanitizeScale(entity.transform.scale.z, 'scale.z', entity.name);
    entity.transform.scale = { x: scaleX, y: scaleY, z: scaleZ };

    rootNode.checkCollisions = false; 
    rootNode.isPickable = true;
    rootNode.alwaysSelectAsActiveMesh = false;
    rootNode.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD;

    rootNode.computeWorldMatrix(true);
    const updatedBounds = rootNode.getHierarchyBoundingVectors(true);
    const finalRealSize = updatedBounds.max.subtract(updatedBounds.min);
    
    const finalSizeX = (entity.collider.sizeX === 1) ? Math.max(0.1, (finalRealSize.x / 2) / scaleX) : entity.collider.sizeX!;
    const finalSizeY = (entity.collider.sizeY === 1) ? Math.max(0.1, (finalRealSize.y / 2) / scaleY) : entity.collider.sizeY!;
    const finalSizeZ = (entity.collider.sizeZ === 1) ? Math.max(0.1, (finalRealSize.z / 2) / scaleZ) : entity.collider.sizeZ!;

    if (entity.collider.sizeY === 1 && (entity.collider.offsetY === 0 || entity.collider.offsetY === undefined)) {
      entity.collider.offsetY = finalSizeY; 
    }

    entity.collider.sizeX = finalSizeX;
    entity.collider.sizeY = finalSizeY;
    entity.collider.sizeZ = finalSizeZ;

    rootNode.ellipsoid = new Vector3(finalSizeX * scaleX, finalSizeY * scaleY, finalSizeZ * scaleZ);
    rootNode.ellipsoidOffset = new Vector3(
      (entity.collider.offsetX ?? 0) * scaleX, 
      (entity.collider.offsetY ?? 0) * scaleY, 
      (entity.collider.offsetZ ?? 0) * scaleZ
    );

    const subMeshes = rootNode.getChildMeshes(false);
    
    const isEditor = this.gameContext.mode() === GameMode.EDITOR || 
                     this.gameContext.mode() === GameMode.EDITING_IN_GAME || 
                     this.gameContext.mode() === GameMode.TEST_LIVE;
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';

    const activeAmbient = isBW ? entity.visual.ambientColorBW : entity.visual.ambientColor;
    const activeColorHex = isBW ? entity.visual.colorBW : entity.visual.color;
    const partOverrides = entity.partOverrides?.overrides || {};

    for (const m of subMeshes) {
      const nameL = m.name.toLowerCase();
      if (nameL.includes('proxycol')) Tags.AddTagsTo(m, "proxy_collider ignore_raycast system_element");
      if (nameL.startsWith('decal_')) Tags.AddTagsTo(m, "decal system_element ignore_raycast");

      m.isPickable = entity.visual.isSelectable; 
      
      if (entity.collider.type === 'mesh' && entity.visual.isSolid && !isCharacter) {
        m.checkCollisions = m.getTotalVertices() > 0;
      } else {
        m.checkCollisions = false;
      }
      
      m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD;
      m.receiveShadows = true; 
      
      if (!m.metadata) m.metadata = {};
      if (!m.metadata.originalTransform) {
        m.metadata.originalTransform = {
          position: m.position.clone(),
          rotation: m.rotation.clone(),
          rotationQuaternion: m.rotationQuaternion ? m.rotationQuaternion.clone() : null,
          scaling: m.scaling.clone()
        };
      }

      const override = partOverrides[m.name] || null;
      if (override) {
        if (override.position) m.position.set(override.position.x, override.position.y, override.position.z);
        if (override.rotation) {
          if (m.rotationQuaternion) m.rotationQuaternion = Quaternion.FromEulerAngles(override.rotation.x, override.rotation.y, override.rotation.z);
          else m.rotation.set(override.rotation.x, override.rotation.y, override.rotation.z);
        }
        if (override.scale) {
          const sScale = TransformNormalizer.sanitizeScaleVector(override.scale, `${entity.name}.${m.name}`);
          m.scaling.set(sScale.x, sScale.y, sScale.z);
        }
      }
      
      const isInteractable = !!entity.interaction?.mensaje || !!entity.interaction?.interactSequenceIdFPS;
      if (!isCharacter && entity.rol === 'prop' && !isEditor && !entity.autoAnim?.enabled && !override && !isInteractable) {
        m.computeWorldMatrix(true);
        m.freezeWorldMatrix();
      }
      
      if (m.material) {
        // 🔥 FASE C FIX: Usar el valor global unificado para proteger contra tormenta de compilación
        if (m.material.getClassName() === "StandardMaterial" || m.material.getClassName() === "PBRMaterial") {
          (m.material as any).maxSimultaneousLights = CoreSceneMaterialService.MAX_SIMULTANEOUS_LIGHTS;
        }

        if (override) {
          this.materialSvc.asegurarMaterialUnicoParaParte(m, entity.uid, m.name);
          const activeColorOverride = isBW ? (override.colorBW || override.color) : override.color;
          await this.materialSvc.ajustarMaterialGLB(
            m.material, isBW, scene, 
            activeAmbient, 
            activeColorOverride || activeColorHex, 
            override.esEmisivo ?? entity.visual.esEmisivo, 
            override.brilloIntensidad ?? entity.visual.brilloIntensidad,
            override.texturePath,
            override.textureSource || (override.texturePath ? 'asset' : 'original') 
          );
        } else {
          this.materialSvc.asegurarMaterialUnico(m, entity.uid);
          await this.materialSvc.ajustarMaterialGLB(
            m.material, isBW, scene, activeAmbient, activeColorHex, entity.visual.esEmisivo, entity.visual.brilloIntensidad
          );
        }
      }
    }

    const isInteractableRoot = !!entity.interaction?.mensaje || !!entity.interaction?.interactSequenceIdFPS;
    if (!isCharacter && entity.rol === 'prop' && !isEditor && !entity.autoAnim?.enabled && Object.keys(partOverrides).length === 0 && !isInteractableRoot) {
      rootNode.computeWorldMatrix(true);
      rootNode.freezeWorldMatrix();
    }

    if (entity.visual.isSolid && !isCharacter && entity.collider.type !== 'mesh') {
      let colMesh: Mesh;
      if (entity.collider.type === 'sphere') {
        colMesh = MeshBuilder.CreateSphere(`col_${objRaw.uid}`, { diameterX: finalSizeX * 2, diameterY: finalSizeY * 2, diameterZ: finalSizeZ * 2 }, scene);
      } else if (entity.collider.type === 'capsule') {
        const r = Math.max(finalSizeX, finalSizeZ); 
        colMesh = MeshBuilder.CreateCapsule(`col_${objRaw.uid}`, { radius: r, height: finalSizeY * 2 }, scene);
      } else {
        colMesh = MeshBuilder.CreateBox(`col_${objRaw.uid}`, { width: finalSizeX * 2, height: finalSizeY * 2, depth: finalSizeZ * 2 }, scene);
      }

      colMesh.parent = rootNode;
      colMesh.position.set(entity.collider.offsetX ?? 0, entity.collider.offsetY ?? 0, entity.collider.offsetZ ?? 0);
      
      colMesh.isVisible = true; 
      colMesh.visibility = 0;
      colMesh.checkCollisions = true; 
      Tags.AddTagsTo(colMesh, "proxy_collider system_element");
    }

    const setFog = (mesh: AbstractMesh) => {
      if (mesh.material) mesh.material.fogEnabled = !entity.visual.ignoraNiebla;
      mesh.getChildMeshes().forEach(c => setFog(c));
    };
    setFog(rootNode);

    if (isLight) {
      const visualSphere = MeshBuilder.CreateSphere(`visual_${entity.name}`, { diameter: 0.4, segments: 16 }, scene);
      visualSphere.parent = rootNode;
      visualSphere.isPickable = false;
      visualSphere.checkCollisions = false;
      visualSphere.receiveShadows = false;
      visualSphere.renderingGroupId = 1;
      visualSphere.scaling.set(1.0, 1.0, 1.0);

      const lightColorHex = objRaw.properties?.lightColor || '#facc15';
      const lightVisualMat = new StandardMaterial(`mat_visual_${entity.name}`, scene);
      const c3 = Color3.FromHexString(lightColorHex);
      lightVisualMat.emissiveColor = c3.clone();
      lightVisualMat.diffuseColor = c3.clone();
      lightVisualMat.specularColor = Color3.Black();
      lightVisualMat.disableLighting = true;
      lightVisualMat.fogEnabled = false;
      visualSphere.material = lightVisualMat;

      Tags.AddTagsTo(visualSphere, "light_visual"); 
      visualSphere.metadata = { entityUid: entity.uid, isLightVisual: true };
      rootNode.metadata = { entityUid: entity.uid, isLightRoot: true };

      if (objRaw.type === 'light_spot' || objRaw.type === 'light_directional') {
        const cone = MeshBuilder.CreateCylinder(`dir_${entity.name}`, { diameterTop: 0, diameterBottom: 0.15, height: 0.4 }, scene);
        cone.parent = visualSphere;
        cone.rotation.x = Math.PI / 2;
        cone.position.z = 0.25;
        cone.material = lightVisualMat;
        cone.isPickable = false;
        cone.renderingGroupId = 1;
        cone.isVisible = false;
        Tags.AddTagsTo(cone, "light_visual ignore_raycast");
      }

      visualSphere.isVisible = false;
      visualSphere.setEnabled(true);
    }

    entity.bindView(rootNode);
    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, rootNode);
  }
}
]]>
</file>
<file name="src\app\core\engine\spatial\spatial-relevance-hub.service.ts">
<![CDATA[
// ARCHIVO COMPLETO
import { Injectable, inject, Injector } from '@angular/core';
import { Vector3, AbstractMesh, Tags } from '@babylonjs/core';
import { IUpdatable } from '../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameContextService } from '../session/game-context.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { GameEntity } from '../entities/game.entity';
import { LightReferenceService } from '../runtime/systems/lighting/light-reference.service';
import { LightTransformService } from '../runtime/systems/lighting/light-transform.service';

export interface SpatialEntityRecord {
  uid: string;
  entity: GameEntity;
  centerWorld: Vector3;
  minWorld: Vector3; // 🔥 FASE C FIX: Precisión AABB
  maxWorld: Vector3; // 🔥 FASE C FIX: Precisión AABB
  boundingRadius: number;
  distSqToPlayer: number;
  distToPlayer: number | null;
  distSqToCamera: number;
  distToCamera: number | null;
  directionToPlayer: Vector3;
  dotWithCameraForward: number;
  lastUpdatedFrame: number;
}

export interface HubMetrics {
  evaluations: number;
  exactDistanceCalculations: number;
  squaredDistanceCalculations: number;
  cacheHits: number;
  registeredEntities: number;
  updateTimeMs: number;
}

@Injectable({ providedIn: 'root' })
export class SpatialRelevanceHubService implements IUpdatable {
  public id = 'SpatialRelevanceHubSystem';

  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private referenceSvc = inject(LightReferenceService);
  private lightTransform = inject(LightTransformService);
  private injector = inject(Injector);

  private _motor3d: ISceneAccess | null = null;
  private get motor3d(): ISceneAccess {
    if (!this._motor3d) {
      this._motor3d = this.injector.get(SCENE_ACCESS_TOKEN);
    }
    return this._motor3d;
  }

  private registry = new Map<string, SpatialEntityRecord>();
  private frameCount = 0;

  private static readonly _fallbackPos = Vector3.Zero();
  private static readonly _tempCamFwd = Vector3.Zero();

  private lastRefPos = new Vector3(-99999, -99999, -99999);
  private currentRefPos = Vector3.Zero();
  private currentCamPos = Vector3.Zero();

  private _evaluations = 0;
  private _exactDistanceCalculations = 0;
  private _squaredDistanceCalculations = 0;
  private _cacheHits = 0;
  private _updateTimeMs = 0;

  public getMetrics(): HubMetrics {
    return {
      evaluations: this._evaluations,
      exactDistanceCalculations: this._exactDistanceCalculations,
      squaredDistanceCalculations: this._squaredDistanceCalculations,
      cacheHits: this._cacheHits,
      registeredEntities: this.registry.size,
      updateTimeMs: this._updateTimeMs
    };
  }

  public start(): void {
    this.clear();
    this.rebuildRegistry();
  }

  public stop(): void {
    this.clear();
  }

  public clear(): void {
    this.registry.clear();
    this.lastRefPos.set(-99999, -99999, -99999);
    this._evaluations = 0;
    this._exactDistanceCalculations = 0;
    this._squaredDistanceCalculations = 0;
    this._cacheHits = 0;
    this._updateTimeMs = 0;
  }

  public rebuildRegistry(): void {
    this.registry.clear();
    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
      this.registerEntity(entities[i]);
    }
  }

  public registerEntity(entity: GameEntity): SpatialEntityRecord | null {
    if (!entity || !entity.view || entity.view.isDisposed()) return null;

    let record = this.registry.get(entity.uid);
    if (!record) {
      record = {
        uid: entity.uid,
        entity,
        centerWorld: Vector3.Zero(),
        minWorld: Vector3.Zero(), // 🔥 FASE C FIX
        maxWorld: Vector3.Zero(), // 🔥 FASE C FIX
        boundingRadius: 1.0,
        distSqToPlayer: Number.MAX_VALUE,
        distToPlayer: null,
        distSqToCamera: Number.MAX_VALUE,
        distToCamera: null,
        directionToPlayer: Vector3.Zero(),
        dotWithCameraForward: 0,
        lastUpdatedFrame: -1
      };
      this.registry.set(entity.uid, record);
    } else {
      record.entity = entity;
    }

    this.computeEntityBounds(record);
    return record;
  }

  public unregisterEntity(uid: string): void {
    this.registry.delete(uid);
  }

  private computeEntityBounds(record: SpatialEntityRecord): void {
    if (record.entity.type.startsWith('light_')) {
      this.lightTransform.getEntityWorldPosition(record.entity, record.centerWorld);
      // FASE C FIX: Para puntos/luces, min y max son idénticos a su posición exacta
      record.minWorld.copyFrom(record.centerWorld);
      record.maxWorld.copyFrom(record.centerWorld);
      record.boundingRadius = record.entity.light?.range || 1.0;
      return;
    }

    const mesh = record.entity.view as AbstractMesh;
    if (!mesh || mesh.isDisposed()) {
      this.lightTransform.getEntityWorldPosition(record.entity, record.centerWorld);
      record.minWorld.copyFrom(record.centerWorld);
      record.maxWorld.copyFrom(record.centerWorld);
      record.boundingRadius = 1.0;
      return;
    }

    mesh.computeWorldMatrix(true);
    const bounds = mesh.getHierarchyBoundingVectors(true, (m: AbstractMesh) => {
      return !Tags.MatchesQuery(m, 'system_element || editor_only || proxy_collider || light_visual || debug_element');
    });

    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x) || bounds.min.x > bounds.max.x) {
      this.lightTransform.getEntityWorldPosition(record.entity, record.centerWorld);
      record.minWorld.copyFrom(record.centerWorld);
      record.maxWorld.copyFrom(record.centerWorld);
      record.boundingRadius = 1.0;
      return;
    }

    record.minWorld.copyFrom(bounds.min);
    record.maxWorld.copyFrom(bounds.max);
    record.centerWorld.copyFrom(bounds.min).addInPlace(bounds.max).scaleInPlace(0.5);
    
    // El radio es la distancia del centro a las esquinas
    const diagonal = bounds.max.subtract(record.centerWorld);
    record.boundingRadius = Math.max(0.5, diagonal.length());
  }

  public getReferencePosition(): Vector3 {
    return this.referenceSvc.getReferencePosition('PLAYER');
  }

  public preUpdate(dtMs: number): void {
    const tStart = performance.now();
    this.frameCount++;

    const ref = this.getReferencePosition();
    this.currentRefPos.copyFrom(ref);

    const scene = this.motor3d.getScene();
    const cam = this.ownership.getCamera() || scene?.activeCamera || this.motor3d.getEditorCamera();
    if (cam) {
      cam.computeWorldMatrix();
      this.currentCamPos.copyFrom(cam.globalPosition);

      if (cam.getDirectionToRef) {
        cam.getDirectionToRef(Vector3.Forward(), SpatialRelevanceHubService._tempCamFwd);
      } else {
        SpatialRelevanceHubService._tempCamFwd.copyFrom(cam.getDirection(Vector3.Forward()));
      }
      SpatialRelevanceHubService._tempCamFwd.y = 0;
      SpatialRelevanceHubService._tempCamFwd.normalize();
    } else {
      this.currentCamPos.copyFrom(ref);
      SpatialRelevanceHubService._tempCamFwd.set(0, 0, 1);
    }

    const refMovedSq = Vector3.DistanceSquared(this.lastRefPos, this.currentRefPos);
    const shouldRecomputeAll = refMovedSq > 0.0025 || this.frameCount % 8 === 0;

    if (shouldRecomputeAll) {
      this.lastRefPos.copyFrom(this.currentRefPos);

      let evals = 0;
      let sqCalls = 0;

      for (const [, record] of this.registry.entries()) {
        const entity = record.entity;
        if (!entity.view || entity.view.isDisposed()) {
          continue;
        }

        if (entity.isDirty) {
          this.computeEntityBounds(record);
        }

        // 🔥 FASE C FIX: AABB Distance real. Si el jugador está dentro de la caja, el resultado es 0.
        const cx = Math.max(record.minWorld.x, Math.min(this.currentRefPos.x, record.maxWorld.x));
        const cy = Math.max(record.minWorld.y, Math.min(this.currentRefPos.y, record.maxWorld.y));
        const cz = Math.max(record.minWorld.z, Math.min(this.currentRefPos.z, record.maxWorld.z));
        
        const dx = this.currentRefPos.x - cx;
        const dy = this.currentRefPos.y - cy;
        const dz = this.currentRefPos.z - cz;
        
        record.distSqToPlayer = dx * dx + dy * dy + dz * dz;
        record.distToPlayer = null;
        sqCalls++;

        const cdx = this.currentCamPos.x - record.centerWorld.x;
        const cdy = this.currentCamPos.y - record.centerWorld.y;
        const cdz = this.currentCamPos.z - record.centerWorld.z;
        record.distSqToCamera = cdx * cdx + cdy * cdy + cdz * cdz;
        record.distToCamera = null;
        sqCalls++;

        if (record.distSqToCamera > 0.01) {
          const invDist = 1.0 / Math.sqrt(record.distSqToCamera);
          const dirX = (record.centerWorld.x - this.currentCamPos.x) * invDist;
          const dirZ = (record.centerWorld.z - this.currentCamPos.z) * invDist;
          record.dotWithCameraForward = (dirX * SpatialRelevanceHubService._tempCamFwd.x) + (dirZ * SpatialRelevanceHubService._tempCamFwd.z);
        } else {
          record.dotWithCameraForward = 1.0;
        }

        record.lastUpdatedFrame = this.frameCount;
        evals++;
      }

      this._evaluations = evals;
      this._squaredDistanceCalculations = sqCalls;
    }

    this._updateTimeMs = performance.now() - tStart;
  }

  public getRecord(uid: string): SpatialEntityRecord | null {
    const record = this.registry.get(uid);
    if (record) {
      this._cacheHits++;
      return record;
    }

    const entity = this.entityManager.getEntityByUid(uid);
    if (entity) {
      return this.registerEntity(entity);
    }
    return null;
  }

  public getDistanceSquaredToPlayer(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distSqToPlayer : Number.MAX_VALUE;
  }

  public getDistanceToPlayer(uid: string): number {
    const record = this.getRecord(uid);
    if (!record) return Number.MAX_VALUE;

    if (record.distToPlayer === null) {
      record.distToPlayer = Math.sqrt(record.distSqToPlayer);
      this._exactDistanceCalculations++;
    }
    return record.distToPlayer;
  }

  public getDistanceSquaredToCamera(uid: string): number {
    const record = this.getRecord(uid);
    return record ? record.distSqToCamera : Number.MAX_VALUE;
  }

  public getDistanceToCamera(uid: string): number {
    const record = this.getRecord(uid);
    if (!record) return Number.MAX_VALUE;

    if (record.distToCamera === null) {
      record.distToCamera = Math.sqrt(record.distSqToCamera);
      this._exactDistanceCalculations++;
    }
    return record.distToCamera;
  }
}
]]>
</file>
<file name="src\app\core\engine\runtime\systems\local-rendering.system.ts">
<![CDATA[
// ARCHIVO COMPLETO
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { AbstractMesh, Vector3, Tags, Mesh, InstancedMesh } from '@babylonjs/core';
import { GameMode } from '../../session/game-mode.model';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../../scene/scene-access.token';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { LightShadowService } from './lighting/light-shadow.service';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';
import { SpatialRelevanceHubService } from '../../spatial/spatial-relevance-hub.service';

export type CullState = 'VISIBLE' | 'FADING_OUT' | 'HARD_CULLED' | 'RESTORING';

interface RenderState {
  state: CullState;
  visibility: number;
  targetVisibility: number;
  isShadowProtected: boolean;
  isStructural: boolean;
}

export interface CullingSystemMetrics {
  visibleObjects: number;
  fadingObjects: number;
  hardCulledObjects: number;
  restoringObjects: number;
  shadowProtectedObjects: number;
}

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';

  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private shadowService = inject(LightShadowService);
  private profiler = inject(EngineProfilerService);
  private spatialHub = inject(SpatialRelevanceHubService);

  private frameCounter = 0;
  private distanceCheckTimer = 0;
  private meshCache = new Map<string, AbstractMesh[]>();
  private renderStates = new Map<string, RenderState>();

  private _visibleCount = 0;
  private _fadingCount = 0;
  private _hardCulledCount = 0;
  private _restoringCount = 0;
  private _shadowProtectedCount = 0;

  private playerVelocity = Vector3.Zero();
  private lastPlayerPos = Vector3.Zero();

  public getMetrics(): CullingSystemMetrics {
    return {
      visibleObjects: this._visibleCount,
      fadingObjects: this._fadingCount,
      hardCulledObjects: this._hardCulledCount,
      restoringObjects: this._restoringCount,
      shadowProtectedObjects: this._shadowProtectedCount
    };
  }

  private getCachedMeshes(entity: GameEntity, rootMesh: AbstractMesh): AbstractMesh[] {
    let cached = this.meshCache.get(entity.uid);
    if (!cached || cached.length === 0 || cached[0] !== rootMesh) {
      const rebuilt: AbstractMesh[] = [];

      const collectRenderable = (mesh: AbstractMesh) => {
        if (!mesh || mesh.isDisposed()) return;
        if (Tags.MatchesQuery(mesh, 'proxy_collider || debug_element || editor_only || light_visual || system_element')) {
          return;
        }

        const className = mesh.getClassName();
        if (className === 'Mesh' || className === 'InstancedMesh') {
          if (className === 'InstancedMesh') {
            const source = (mesh as InstancedMesh).sourceMesh;
            if (source && source.getTotalVertices() > 0) rebuilt.push(mesh);
          } else if ((mesh as Mesh).getTotalVertices() > 0) {
            rebuilt.push(mesh);
          }
        }
      };

      collectRenderable(rootMesh);
      const descendants = rootMesh.getChildMeshes(false);
      for (let i = 0; i < descendants.length; i++) {
        collectRenderable(descendants[i]);
      }

      if (rebuilt.length === 0) {
        rebuilt.push(rootMesh);
      }

      cached = rebuilt;
      this.meshCache.set(entity.uid, cached);
    }
    return cached;
  }

  public isStructuralEntity(e: GameEntity): boolean {
    return !!e.visual?.disableCulling;
  }

  private isEligibleForHardCull(e: GameEntity): boolean {
    if (e.isPersistent || e.rol === 'player' || e.rol === 'npc' || e.characterConfig || e.rol === 'spawn_point') return false;
    if (e.autoAnim?.enabled) return false;
    if (e.movementAuthority !== 'GAMEPLAY') return false;
    if (e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_')) return false;
    if (e.type === 'image_plane' || e.type === 'video_plane' || e.type === 'bubble') return false;
    if (this.isStructuralEntity(e)) return false;
    return true;
  }

  public start(): void {
    this.meshCache.clear();
    this.renderStates.clear();
    this.frameCounter = 0;
    this.distanceCheckTimer = 9999;
    this.resetCounters();
  }

  private resetCounters(): void {
    this._visibleCount = 0;
    this._fadingCount = 0;
    this._hardCulledCount = 0;
    this._restoringCount = 0;
    this._shadowProtectedCount = 0;
  }

  public stop(): void {
    const entities = this.entityManager.getAllEntities();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      e.isCulled = false;

      if (e.isManuallyHidden) continue;

      const mesh = e.view as AbstractMesh;
      if (mesh && !mesh.isDisposed()) {
        if (!mesh.isEnabled()) mesh.setEnabled(true);
        if (!mesh.isVisible) mesh.isVisible = true;

        const cachedMeshes = this.getCachedMeshes(e, mesh);
        for (let m = 0; m < cachedMeshes.length; m++) {
          const c = cachedMeshes[m];
          if (!Tags.MatchesQuery(c, 'proxy_collider || debug_element || editor_only || light_visual')) {
            c.isVisible = true;
            c.visibility = 1.0;
          }
        }
      }
    }
    this.start();
    this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
  }

  public reconcileAllEntitiesImmediate(explicitOrigin?: Vector3): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    if (isEditor) {
      this.ensureAllEntitiesVisibleForEditor();
      return;
    }

    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 120, fadeMargin: 50 };
    if (!cullingConfig.enabled) {
      this.stop();
      return;
    }

    const cullDistance = Math.max(30, Number(cullingConfig.cullDistance) || 120);
    const fadeMargin = Math.min(cullDistance - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 50));
    const fadeStartDist = Math.max(0, cullDistance - fadeMargin);

    this.resetCounters();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const mesh = e.view as AbstractMesh;
      if (!mesh || mesh.isDisposed()) continue;

      if (e.isManuallyHidden) {
        mesh.isVisible = false;
        mesh.setEnabled(false);
        continue;
      }

      const isStructural = this.isStructuralEntity(e);

      if (!this.isEligibleForHardCull(e)) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural });
        this._visibleCount++;
        continue;
      }

      const distSqToCenter = this.spatialHub.getDistanceSquaredToPlayer(e.uid);
      // 🔥 FASE C FIX: distSqToPlayer ya es la distancia exacta AABB a los límites del objeto
      const effectiveDist = Math.max(0, Math.sqrt(distSqToCenter)); 
      
      const cachedMeshes = this.getCachedMeshes(e, mesh);

      if (effectiveDist > cullDistance) {
        const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
        e.isCulled = true;
        if (!isStructural && !isNeededForShadow) {
          mesh.setEnabled(false);
        } else {
          mesh.setEnabled(true);
        }
        mesh.isVisible = false;
        this.applyVisibilityToMeshes(cachedMeshes, 0.0);
        this.renderStates.set(e.uid, { state: 'HARD_CULLED', visibility: 0.0, targetVisibility: 0.0, isShadowProtected: isNeededForShadow, isStructural });
        this._hardCulledCount++;
      } else if (effectiveDist <= fadeStartDist) {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural });
        this._visibleCount++;
      } else {
        e.isCulled = false;
        mesh.setEnabled(true);
        mesh.isVisible = true;
        let t = (effectiveDist - fadeStartDist) / fadeMargin;
        t = Math.max(0, Math.min(1, t));
        const initialAlpha = Math.max(0.0001, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));
        this.applyVisibilityToMeshes(cachedMeshes, initialAlpha);
        this.renderStates.set(e.uid, { state: 'FADING_OUT', visibility: initialAlpha, targetVisibility: initialAlpha, isShadowProtected: false, isStructural });
        this._fadingCount++;
      }
    }

    this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
  }

  private ensureAllEntitiesVisibleForEditor(): void {
    const entities = this.entityManager.getAllEntities();
    this.resetCounters();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.isManuallyHidden) continue;

      e.isCulled = false;
      const mesh = e.view as AbstractMesh;
      if (mesh && !mesh.isDisposed()) {
        if (!mesh.isEnabled()) mesh.setEnabled(true);
        mesh.isVisible = true;
        const cachedMeshes = this.getCachedMeshes(e, mesh);
        this.applyVisibilityToMeshes(cachedMeshes, 1.0);
      }
      this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural: true });
      this._visibleCount++;
    }
  }

  public update(dtMs: number): void {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    if (isEditor) {
      if (this.frameCounter === 0) {
        this.ensureAllEntitiesVisibleForEditor();
      }
      this.frameCounter++;
      return;
    }

    this.frameCounter++;
    this.distanceCheckTimer += dtMs;

    const shouldCheckDistance = this.distanceCheckTimer >= 40;
    if (shouldCheckDistance) {
      this.distanceCheckTimer = 0;
    }

    const isTransitioning = this.context.isTransitioning();
    const entities = this.entityManager.getAllEntities();
    let playerEntity = this.context.activePlayerEntity();
    if (!playerEntity) {
      playerEntity = entities.find(e => e.rol === 'player' || e.characterConfig) || null;
    }

    const cullingConfig = playerEntity?.playerConfig?.culling || { enabled: true, cullDistance: 120, fadeMargin: 50 };
    if (!cullingConfig.enabled || isTransitioning) {
      return;
    }

    if (playerEntity && playerEntity.view && dtMs > 0) {
      const currPos = playerEntity.view.getAbsolutePosition();
      this.playerVelocity.copyFrom(currPos).subtractInPlace(this.lastPlayerPos).scaleInPlace(1000 / dtMs);
      this.lastPlayerPos.copyFrom(currPos);
    }

    const playerSpeed = this.playerVelocity.length();
    const dynamicLookAheadBonus = Math.min(25.0, playerSpeed * 1.2);

    const baseCullDist = Math.max(30, Number(cullingConfig.cullDistance) || 120);
    const fadeMargin = Math.min(baseCullDist - 1, Math.max(1, Number(cullingConfig.fadeMargin) || 50));
    const fadeStartDist = Math.max(0, baseCullDist - fadeMargin);

    const lerpSpeed = Math.min(1.0, (dtMs / 16.66) * 0.18);
    let visibilityChangedInBatch = false;

    let vCount = 0, fCount = 0, hCount = 0, rCount = 0, sCount = 0;
    let evaluatedCount = 0;
    let changedCount = 0;

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const mesh = e.view as AbstractMesh;
      if (!mesh || mesh.isDisposed()) continue;

      if (e.isManuallyHidden) {
        if (mesh.isVisible || mesh.isEnabled()) {
          mesh.isVisible = false;
          mesh.setEnabled(false);
        }
        continue;
      }

      const isStructural = this.isStructuralEntity(e);

      if (!this.renderStates.has(e.uid)) {
        this.renderStates.set(e.uid, { state: 'VISIBLE', visibility: 1.0, targetVisibility: 1.0, isShadowProtected: false, isStructural });
      }
      const renderState = this.renderStates.get(e.uid)!;

      if (!this.isEligibleForHardCull(e)) {
        if (e.isCulled) {
          e.isCulled = false;
          visibilityChangedInBatch = true;
          changedCount++;
        }
        renderState.targetVisibility = 1.0;
        if (renderState.state === 'HARD_CULLED' || renderState.state === 'FADING_OUT') {
          renderState.state = 'RESTORING';
        }
        vCount++;
      } else if (shouldCheckDistance) {
        evaluatedCount++;

        const distSqToCenter = this.spatialHub.getDistanceSquaredToPlayer(e.uid);
        const effectiveDist = Math.max(0, Math.sqrt(distSqToCenter)); 
        const wasCulled = e.isCulled;

        const effectiveCull = baseCullDist + dynamicLookAheadBonus;
        const effectiveFadeStart = fadeStartDist + dynamicLookAheadBonus;
        const reacquireThreshold = Math.max(0, effectiveCull - 15.0);

        if (renderState.state === 'HARD_CULLED') {
          if (effectiveDist < reacquireThreshold) {
            renderState.state = 'RESTORING';
            e.isCulled = false;
            mesh.setEnabled(true);
            mesh.isVisible = true;
            renderState.visibility = 0.0001;
            renderState.isShadowProtected = false;
            this.applyVisibilityToMeshes(this.getCachedMeshes(e, mesh), 0.0001);

            if (effectiveDist <= effectiveFadeStart) {
              renderState.targetVisibility = 1.0;
            } else {
              let t = (effectiveDist - effectiveFadeStart) / fadeMargin;
              t = Math.max(0, Math.min(1, t));
              renderState.targetVisibility = Math.max(0.0001, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));
            }

            this.shadowService.notifyCasterRestored(e.uid);
          }
        } else {
          if (effectiveDist > effectiveCull) {
            renderState.targetVisibility = 0.0001;
            if (renderState.state === 'VISIBLE') {
              renderState.state = 'FADING_OUT';
            }
          } else if (effectiveDist <= effectiveFadeStart) {
            renderState.targetVisibility = 1.0;
            if (renderState.state === 'FADING_OUT') {
              renderState.state = 'RESTORING';
            }
            e.isCulled = false;
            renderState.isShadowProtected = false;
          } else {
            let t = (effectiveDist - effectiveFadeStart) / fadeMargin;
            t = Math.max(0, Math.min(1, t));
            renderState.targetVisibility = Math.max(0.0001, Math.min(1.0, 1.0 - t * t * (3.0 - 2.0 * t)));

            if (renderState.state === 'VISIBLE') {
              renderState.state = 'FADING_OUT';
            }
            e.isCulled = false;
            renderState.isShadowProtected = false;
          }
        }

        if (wasCulled !== e.isCulled) {
          visibilityChangedInBatch = true;
          changedCount++;
        }
      }

      const cachedMeshes = this.getCachedMeshes(e, mesh);

      switch (renderState.state) {
        case 'VISIBLE':
          vCount++;
          if (Math.abs(renderState.visibility - renderState.targetVisibility) > 0.005) {
            renderState.state = renderState.targetVisibility < 1.0 ? 'FADING_OUT' : 'RESTORING';
          } else {
            if (!mesh.isEnabled()) mesh.setEnabled(true);
            if (!mesh.isVisible) mesh.isVisible = true;
            if (renderState.visibility !== 1.0) {
              renderState.visibility = 1.0;
              this.applyVisibilityToMeshes(cachedMeshes, 1.0);
            }
          }
          break;

        case 'FADING_OUT':
          fCount++;
          if (!mesh.isEnabled()) mesh.setEnabled(true);
          if (!mesh.isVisible) mesh.isVisible = true;

          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;
          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility <= 0.0005 && renderState.targetVisibility <= 0.0002) {
            renderState.visibility = 0.0001;
            renderState.state = 'HARD_CULLED';
            e.isCulled = true;

            const isNeededForShadow = this.shadowService.isEntityRequiredForActiveShadows(e.uid);
            renderState.isShadowProtected = isNeededForShadow;

            if (isNeededForShadow) {
              mesh.setEnabled(true);
              mesh.isVisible = false;
              this.applyVisibilityToMeshes(cachedMeshes, 0.0);
              sCount++;
            } else {
              if (!isStructural) {
                mesh.setEnabled(false);
              }
              mesh.isVisible = false;
              this.applyVisibilityToMeshes(cachedMeshes, 0.0001);
            }

            visibilityChangedInBatch = true;
            changedCount++;
          }
          break;

        case 'HARD_CULLED':
          hCount++;
          if (renderState.isShadowProtected) {
            sCount++;
            if (!mesh.isEnabled()) mesh.setEnabled(true);
            mesh.isVisible = false;
          } else {
            if (mesh.isEnabled() && !isStructural && this.isEligibleForHardCull(e)) {
              mesh.setEnabled(false);
            }
            mesh.isVisible = false;
          }
          break;

        case 'RESTORING':
          rCount++;
          if (!mesh.isEnabled()) mesh.setEnabled(true);
          if (!mesh.isVisible) mesh.isVisible = true;

          renderState.visibility += (renderState.targetVisibility - renderState.visibility) * lerpSpeed;
          this.applyVisibilityToMeshes(cachedMeshes, renderState.visibility);

          if (renderState.visibility >= 0.995 && renderState.targetVisibility >= 0.995) {
            renderState.visibility = 1.0;
            renderState.state = 'VISIBLE';
            this.applyVisibilityToMeshes(cachedMeshes, 1.0);
          }
          break;
      }
    }

    this._visibleCount = vCount;
    this._fadingCount = fCount;
    this._hardCulledCount = hCount;
    this._restoringCount = rCount;
    this._shadowProtectedCount = sCount;

    this.profiler.cullingEvaluatedCount = evaluatedCount;
    this.profiler.cullingChangedCount = changedCount;
    this.profiler.recordDistanceEvaluation('LocalRenderingSystem', evaluatedCount);

    if (visibilityChangedInBatch) {
      this.eventBus.emit({ type: 'RuntimeVisibilityBatchChanged' });
    }
  }

  private applyVisibilityToMeshes(meshes: AbstractMesh[], visibility: number) {
    const clamped = Math.max(0.0001, Math.min(1.0, visibility));
    for (let c = 0; c < meshes.length; c++) {
      const m = meshes[c];
      m.visibility = clamped;
      m.isVisible = clamped > 0.0005;
    }
  }
}
]]>
</file>
<file name="src\app\core\engine\runtime\systems\lighting\light-containment.service.ts">
<![CDATA[
// ARCHIVO COMPLETO
import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags, Mesh, InstancedMesh, Node, MultiMaterial, Matrix } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';
import { SpatialRelevanceHubService } from '../../../spatial/spatial-relevance-hub.service';

export interface LightContainmentAuditReport {
  lightUid: string;
  containerUid: string;
  containerFound: boolean;
  containerName: string;
  runtimeRootName: string;
  totalDescendants: number;
  totalRenderableMeshes: number;
  totalReceivers: number;
  rejectedCount: number;
  rejectedDetails: Array<{ meshName: string; reason: string }>;
  materialsSummary: Array<{ meshName: string; materialType: string; isMulti: boolean; subMaterialsCount: number; maxLights: number }>;
}

export interface ContainerVolumeEvaluationResult {
  inside: boolean;
  inPreEntry: boolean;
  distToBox: number;
}

@Injectable({ providedIn: 'root' })
export class LightContainmentService {
  private entityManager = inject(EntityManagerService);
  private injector = inject(Injector);

  private _spatialHub: SpatialRelevanceHubService | null = null;
  private get spatialHub(): SpatialRelevanceHubService {
    if (!this._spatialHub) {
      this._spatialHub = this.injector.get(SpatialRelevanceHubService);
    }
    return this._spatialHub;
  }

  private containerRenderablesCache = new Map<string, AbstractMesh[]>();
  private strictInteriorReceiversCache = new Map<string, AbstractMesh[]>();
  private lastAuditReport: LightContainmentAuditReport | null = null;

  public metrics = {
    containmentRebuilds: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  public markDirty(containerOrLightUid?: string): void {
    if (containerOrLightUid) {
      for (const key of this.strictInteriorReceiversCache.keys()) {
        if (key.includes(containerOrLightUid)) {
          this.strictInteriorReceiversCache.delete(key);
        }
      }
      this.containerRenderablesCache.delete(containerOrLightUid);
    } else {
      this.clearAllCache();
    }
  }

  public clearAllCache(): void {
    this.containerRenderablesCache.clear();
    this.strictInteriorReceiversCache.clear();
    this.lastAuditReport = null;
    this.metrics.containmentRebuilds = 0;
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
  }

  public getLastAuditReport(): LightContainmentAuditReport | null {
    return this.lastAuditReport;
  }

  public resolveContainerEntity(lightEntity: GameEntity, scene: Scene): GameEntity | null {
    const lightComp = lightEntity.light;
    if (!lightComp) return null;

    // 1. Vinculación explícita por UID configurada en el inspector
    if (lightComp.containerEntityUid) {
      const explicit = this.entityManager.getEntityByUid(lightComp.containerEntityUid);
      if (explicit && explicit.view && !explicit.view.isDisposed()) return explicit;
    }

    // 2. Vinculación por jerarquía lógica de entidad (parentId)
    if (lightEntity.parentId) {
      const parentEnt = this.entityManager.getEntityByUid(lightEntity.parentId);
      if (parentEnt && parentEnt.view && !parentEnt.view.isDisposed()) {
        return parentEnt;
      }
    }

    // 3. Vinculación por árbol de nodos de Babylon.js
    if (lightEntity.view && lightEntity.view.parent) {
      let currentParent: Node | null = lightEntity.view.parent;
      while (currentParent) {
        const ent = this.entityManager.getEntityByMesh(currentParent as AbstractMesh);
        if (ent && ent.uid !== lightEntity.uid && (ent.type === 'model' || ent.type === 'cube')) {
          return ent;
        }
        currentParent = currentParent.parent;
      }
    }

    // 4. Fallback por proximidad geométrica AABB (para luces colocadas dentro de modelos sin parent directo)
    const lightPos = lightEntity.view
      ? lightEntity.view.getAbsolutePosition()
      : new Vector3(
          lightEntity.transform.position.x,
          lightEntity.transform.position.y,
          lightEntity.transform.position.z
        );

    const candidates = this.entityManager
      .getAllEntities()
      .filter(
        e =>
          e.uid !== lightEntity.uid &&
          (e.type === 'model' || e.type === 'cube') &&
          e.view &&
          !e.view.isDisposed()
      );

    let closestContainer: GameEntity | null = null;
    let smallestDist = Number.MAX_VALUE;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand.view) continue;
      
      const rec = this.spatialHub.getRecord(cand.uid);
      if (!rec) continue;

      const dist = Vector3.Distance(rec.centerWorld, lightPos);

      // Si la luz está contenida dentro del volumen AABB del candidato
      if (
        lightPos.x >= rec.minWorld.x - 0.5 && lightPos.x <= rec.maxWorld.x + 0.5 &&
        lightPos.y >= rec.minWorld.y - 0.5 && lightPos.y <= rec.maxWorld.y + 0.5 &&
        lightPos.z >= rec.minWorld.z - 0.5 && lightPos.z <= rec.maxWorld.z + 0.5
      ) {
        return cand;
      }

      if (dist < smallestDist) {
        smallestDist = dist;
        closestContainer = cand;
      }
    }

    return closestContainer;
  }

  public evaluateActorInsideContainer(
    actorWorldPos: Vector3,
    container: GameEntity,
    preEntryDistance: number = 4.5,
    wasInRange: boolean = false
  ): ContainerVolumeEvaluationResult {
    const rec = this.spatialHub.getRecord(container.uid);
    if (!rec) {
      return { inside: false, inPreEntry: false, distToBox: Number.MAX_VALUE };
    }

    const min = rec.minWorld;
    const max = rec.maxWorld;

    // Margen de histéresis: si ya estaba adentro, ampliamos 0.8m los límites para evitar parpadeos
    const exitHysteresis = wasInRange ? 0.8 : 0.0;
    const adjustedMin = new Vector3(min.x - exitHysteresis, min.y - 0.5 - exitHysteresis, min.z - exitHysteresis);
    const adjustedMax = new Vector3(max.x + exitHysteresis, max.y + 0.5 + exitHysteresis, max.z + exitHysteresis);

    // Distancia perpendicular mínima desde el actor a la caja AABB del contenedor
    const dx = Math.max(0, adjustedMin.x - actorWorldPos.x, actorWorldPos.x - adjustedMax.x);
    const dy = Math.max(0, adjustedMin.y - actorWorldPos.y, actorWorldPos.y - adjustedMax.y);
    const dz = Math.max(0, adjustedMin.z - actorWorldPos.z, actorWorldPos.z - adjustedMax.z);
    const distToBox = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const isInside = (dx === 0 && dy === 0 && dz === 0);
    const inPreEntry = !isInside && (distToBox <= preEntryDistance);

    return {
      inside: isInside,
      inPreEntry: inPreEntry,
      distToBox: distToBox
    };
  }

  public getAllRenderableMeshesFromModel(rootNode: Node): {
    renderables: AbstractMesh[];
    totalDescendantsCount: number;
    rejected: Array<{ meshName: string; reason: string }>;
  } {
    const renderables: AbstractMesh[] = [];
    const rejected: Array<{ meshName: string; reason: string }> = [];
    let totalDescendantsCount = 0;
    const visitedNodes = new Set<Node>();

    const traverse = (node: Node) => {
      if (!node || visitedNodes.has(node)) return;
      visitedNodes.add(node);
      totalDescendantsCount++;

      if (node.isDisposed()) {
        rejected.push({ meshName: node.name, reason: 'Nodo descartado' });
        return;
      }

      if (
        Tags.MatchesQuery(
          node,
          'editor_only || fog_element || debug_element || proxy_collider || invisible_floor || light_visual || ignore_raycast'
        )
      ) {
        rejected.push({ meshName: node.name, reason: 'Etiqueta de sistema/colisionador' });
        return;
      }

      if (node instanceof AbstractMesh) {
        const className = node.getClassName();

        if (className === 'InstancedMesh') {
          const instanced = node as InstancedMesh;
          if (instanced.sourceMesh && !instanced.sourceMesh.isDisposed()) {
            renderables.push(instanced);
          } else {
            rejected.push({ meshName: node.name, reason: 'InstancedMesh sin sourceMesh válido' });
          }
        } else if (className === 'Mesh') {
          const mesh = node as Mesh;
          if (mesh.getTotalVertices() > 0) {
            renderables.push(mesh);
          } else {
            rejected.push({ meshName: node.name, reason: 'Mesh sin vértices' });
          }
        }
      }

      const children = node.getChildren(undefined, false);
      for (let i = 0; i < children.length; i++) {
        traverse(children[i]);
      }
    };

    traverse(rootNode);
    return { renderables, totalDescendantsCount, rejected };
  }

  public getInteriorMeshesStrict(lightEntity: GameEntity, scene: Scene): AbstractMesh[] {
    const cacheKey = `${lightEntity.uid}_${lightEntity.light?.containerEntityUid || 'auto'}`;

    if (this.strictInteriorReceiversCache.has(cacheKey)) {
      const cached = this.strictInteriorReceiversCache.get(cacheKey)!;
      const allValid = cached.every(m => m && !m.isDisposed() && m.getScene() === scene);

      if (allValid) {
        this.metrics.cacheHits++;
        return cached;
      } else {
        this.strictInteriorReceiversCache.delete(cacheKey);
      }
    }

    this.metrics.cacheMisses++;
    this.metrics.containmentRebuilds++;

    const container = this.resolveContainerEntity(lightEntity, scene);
    if (!container || !container.view) {
      this.strictInteriorReceiversCache.set(cacheKey, []);
      return [];
    }

    const { renderables, totalDescendantsCount, rejected } = this.getAllRenderableMeshesFromModel(container.view);
    const materialsSummary: LightContainmentAuditReport['materialsSummary'] = [];
    const finalReceiversSet = new Set<AbstractMesh>();

    for (let i = 0; i < renderables.length; i++) {
      const mesh = renderables[i];
      finalReceiversSet.add(mesh);

      const mat = mesh.material;
      if (mat) {
        if (mat.getClassName() === 'MultiMaterial') {
          const multi = mat as MultiMaterial;
          const subMats = multi.subMaterials || [];
          materialsSummary.push({
            meshName: mesh.name,
            materialType: 'MultiMaterial',
            isMulti: true,
            subMaterialsCount: subMats.length,
            maxLights: 10
          });
        } else {
          materialsSummary.push({
            meshName: mesh.name,
            materialType: mat.getClassName(),
            isMulti: false,
            subMaterialsCount: 1,
            maxLights: (mat as any).maxSimultaneousLights ?? 10
          });
        }
      }
    }

    const finalReceivers = Array.from(finalReceiversSet);
    this.strictInteriorReceiversCache.set(cacheKey, finalReceivers);

    this.lastAuditReport = {
      lightUid: lightEntity.uid,
      containerUid: container.uid,
      containerFound: true,
      containerName: container.name,
      runtimeRootName: container.view.name,
      totalDescendants: totalDescendantsCount,
      totalRenderableMeshes: renderables.length,
      totalReceivers: finalReceivers.length,
      rejectedCount: rejected.length,
      rejectedDetails: rejected,
      materialsSummary: materialsSummary
    };

    return finalReceivers;
  }

  public applyContainment(light: PointLight | SpotLight, entity: GameEntity, scene: Scene): void {
    const mode: LightContainmentMode = entity.light?.containmentMode || 'GLOBAL';
    const affectDescendantsOnly = entity.light?.affectDescendantsOnly ?? false;

    const cacheStamp = `${mode}_${entity.light?.containerEntityUid || ''}_${entity.uid}_${affectDescendantsOnly}`;
    if ((light as any)._containmentAppliedStamp === cacheStamp && !entity.isDirty) {
      return;
    }

    if (mode === 'INTERIOR' && affectDescendantsOnly) {
      const receivers = this.getInteriorMeshesStrict(entity, scene);
      if (receivers.length > 0) {
        light.includedOnlyMeshes = [...receivers];
        light.excludedMeshes = [];
      } else {
        light.includedOnlyMeshes = [];
        light.excludedMeshes = [];
      }
    } else {
      light.includedOnlyMeshes = [];
      light.excludedMeshes = [];
    }

    (light as any)._containmentAppliedStamp = cacheStamp;
  }

  public clearContainment(light: PointLight | SpotLight): void {
    (light as any)._containmentAppliedStamp = undefined;
  }
}
]]>
</file>
<file name="src\app\core\engine\runtime\systems\lighting\light-distance.service.ts">
<![CDATA[
// ARCHIVO COMPLETO
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Tags } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { VirtualLight, LightLifecycleStage, LIGHT_SPATIAL_CONSTANTS } from './lighting-types';
import { LightTransformService } from './light-transform.service';
import { LightReferenceService } from './light-reference.service';
import { LightAttenuationCurve } from './light-attenuation-curve';
import { LightContainmentService } from './light-containment.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { EngineProfilerService } from '../../../telemetry/engine-profiler.service';

@Injectable({ providedIn: 'root' })
export class LightDistanceService {
  private context = inject(GameContextService);
  private lightTransform = inject(LightTransformService);
  private referenceSvc = inject(LightReferenceService);
  private containmentSvc = inject(LightContainmentService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private profiler = inject(EngineProfilerService);

  private _tempPos = Vector3.Zero();
  private _tempDir = Vector3.Zero();

  public evaluateDistanceAndHysteresis(activeVirtuals: VirtualLight[], baseRefPos: Vector3, speed: number): void {
    const scene = this.motor3d.getScene();
    this.profiler.recordDistanceEvaluation('LightDistanceService', activeVirtuals.length);
    const validActors = this.referenceSvc.getValidActorEntities();
    const nowTimeStr = new Date().toLocaleTimeString();

    for (let i = 0; i < activeVirtuals.length; i++) {
      const vl = activeVirtuals[i];
      const lightComp = vl.entity.light;

      if (!lightComp || !vl.entity.view || !lightComp.enabled) {
        this.transitionState(vl, 'INACTIVE', nowTimeStr, 'DISABLED', 'Luz desactivada en configuración');
        vl.isLightInRange = false;
        vl.isShadowInRange = false;
        vl.targetMultiplier = 0;
        vl._isInPrepareRange = false;
        vl.closestActorName = 'Inactiva';
        vl.insideVolume = false;
        vl.inPreEntryZone = false;
        vl.lastEvaluatedDistance = 99999;
        vl.centerDistance = 99999;
        vl.boundsDistance = 99999;
        vl.effectiveDistance = 99999;
        continue;
      }

      const wasInRange = vl.isLightInRange;
      this.lightTransform.getLightWorldTransform(vl.entity, this._tempPos, this._tempDir);

      let actorWorldPos: Vector3;
      if (validActors.length > 0) {
        actorWorldPos = this.referenceSvc.getActorWorldPosition(validActors[0], new Vector3());
        vl.closestActorName = validActors[0].name;
      } else {
        actorWorldPos = baseRefPos;
        vl.closestActorName = 'Referencia Base';
      }

      // 🔥 FASE C FIX: Distancia efectiva exacta
      const centerDist = Vector3.Distance(actorWorldPos, this._tempPos);
      const effectiveDist = centerDist; 

      vl.centerDistance = parseFloat(centerDist.toFixed(2));
      vl.boundsDistance = parseFloat(centerDist.toFixed(2));
      vl.effectiveDistance = parseFloat(effectiveDist.toFixed(2));
      vl.lastEvaluatedDistance = vl.effectiveDistance;
      vl.distSq = effectiveDist * effectiveDist;
      vl.lastDistanceUpdateTimestamp = nowTimeStr;

      const configuredActivation = lightComp.activationDistance ?? LIGHT_SPATIAL_CONSTANTS.DEFAULT_ACTIVATION_RADIUS;
      const configuredDeactivation = lightComp.deactivationDistance ?? (configuredActivation + 5.0);
      
      const rActivation = Math.max(1.0, configuredActivation);
      const rDeactivation = Math.max(rActivation + 1.0, configuredDeactivation);
      const rPrepare = rDeactivation + 10.0;

      const isInterior = lightComp.containmentMode === 'INTERIOR';
      vl.isInterior = isInterior;
      vl.interiorActivationMode = lightComp.interiorActivationMode || 'VOLUME';

      const container = (isInterior && scene) ? this.containmentSvc.resolveContainerEntity(vl.entity, scene) : null;
      vl.containerName = container ? container.name : undefined;

      let evalVol = { inside: false, inPreEntry: false, distToBox: Number.MAX_VALUE };
      if (container && container.view && !container.view.isDisposed()) {
        const preEntryDist = lightComp.preEntryEnabled ? (lightComp.preEntryDistance ?? 4.5) : 0.0;
        evalVol = this.containmentSvc.evaluateActorInsideContainer(actorWorldPos, container, preEntryDist, wasInRange);
      }
      vl.insideVolume = evalVol.inside;
      vl.inPreEntryZone = evalVol.inPreEntry;

      // =========================================================================
      // LÓGICA DE CONTENCIÓN ESTRICTA: VOLUME Y BOTH
      // =========================================================================
      if (isInterior && (lightComp.interiorActivationMode === 'VOLUME' || lightComp.interiorActivationMode === 'BOTH')) {
        if (!container || !container.view || container.view.isDisposed()) {
          this.applyStandardProximity(vl, effectiveDist, rActivation, rDeactivation, rPrepare, wasInRange, nowTimeStr);
          vl.decisionText = 'FALLBACK_DISTANCE (Contenedor no resuelto)';
        } else if (vl.insideVolume) {
          const distFactor = lightComp.interiorActivationMode === 'BOTH'
            ? LightAttenuationCurve.calculate(effectiveDist, rActivation * 0.75, rDeactivation)
            : 1.0;

          vl.targetMultiplier = distFactor;
          vl.isLightInRange = vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD;
          vl._isInPrepareRange = true;
          this.evaluateStateAndDecision(vl, effectiveDist, rActivation, rDeactivation, nowTimeStr, 'INTERIOR DENTRO DE VOLUMEN');
        } else if (vl.inPreEntryZone) {
          const preDist = Math.max(0.1, lightComp.preEntryDistance ?? 4.5);
          const ratio = Math.max(0.0, Math.min(1.0, 1.0 - (evalVol.distToBox / preDist)));
          vl.targetMultiplier = ratio * 0.85;
          vl.isLightInRange = ratio > (wasInRange ? 0.01 : 0.05); // Histéresis de pre-entrada
          vl._isInPrepareRange = true;
          this.evaluateStateAndDecision(vl, effectiveDist, rActivation, rDeactivation, nowTimeStr, 'PRE-ENTRADA');
        } else {
          vl.targetMultiplier = 0.0;
          vl.isLightInRange = false;
          vl._isInPrepareRange = evalVol.distToBox <= ((lightComp.preEntryDistance ?? 4.5) + 8.0);
          this.transitionState(vl, 'OUTSIDE', nowTimeStr, 'OUTSIDE_INTERIOR_VOLUME', 'Fuera de volumen interior');
        }
      } else {
        this.applyStandardProximity(vl, effectiveDist, rActivation, rDeactivation, rPrepare, wasInRange, nowTimeStr);
      }

      if (vl.isLightInRange && lightComp.castShadows && lightComp.distanceShadowsEnabled !== false) {
        const shadowAct = lightComp.shadowActivationDistance ?? Math.min(LIGHT_SPATIAL_CONSTANTS.DEFAULT_SHADOW_ACTIVATION_RADIUS, rActivation * 0.6);
        const shadowDeact = lightComp.shadowDeactivationDistance ?? (shadowAct + 4.0);

        if (vl.isShadowInRange) {
          if (effectiveDist > shadowDeact) vl.isShadowInRange = false;
        } else {
          if (effectiveDist <= shadowAct) vl.isShadowInRange = true;
        }
      } else {
        vl.isShadowInRange = false;
      }
    }
  }

  private applyStandardProximity(
    vl: VirtualLight, 
    dist: number, 
    rActivation: number, 
    rDeactivation: number, 
    rPrepare: number, 
    wasInRange: boolean,
    timestamp: string
  ): void {
    vl._isInPrepareRange = dist <= rPrepare;
    const currentLimit = wasInRange ? rDeactivation : rActivation;

    vl.targetMultiplier = LightAttenuationCurve.calculate(dist, rActivation * 0.7, rDeactivation);

    if (dist <= currentLimit && vl.targetMultiplier > LIGHT_SPATIAL_CONSTANTS.ZERO_INTENSITY_THRESHOLD) {
      vl.isLightInRange = true;
      this.evaluateStateAndDecision(vl, dist, rActivation, rDeactivation, timestamp, 'PROXIMIDAD RADIAL');
    } else {
      vl.isLightInRange = false;
      this.transitionState(vl, dist > rDeactivation ? 'OUTSIDE' : 'INACTIVE', timestamp, 'OUT_OF_EFFECTIVE_RANGE', 'Fuera de rango');
    }
  }

  private evaluateStateAndDecision(
    vl: VirtualLight, 
    dist: number, 
    rAct: number, 
    rDeact: number, 
    timestamp: string, 
    contextMsg: string
  ): void {
    if (vl.targetMultiplier >= 0.98) {
      this.transitionState(vl, 'ACTIVE', timestamp, undefined, `ACTIVE (${contextMsg})`);
    } else if (vl.targetMultiplier > 0.01) {
      if (vl.targetMultiplier > vl.currentMultiplier) {
        this.transitionState(vl, 'FADING_IN', timestamp, undefined, `FADING IN (${contextMsg})`);
      } else if (vl.targetMultiplier < vl.currentMultiplier) {
        this.transitionState(vl, 'FADING_OUT', timestamp, undefined, `FADING OUT (${contextMsg})`);
      } else {
        this.transitionState(vl, 'ACTIVE', timestamp, undefined, `PARTIAL ACTIVE (${contextMsg})`);
      }
    } else {
      this.transitionState(vl, 'INACTIVE', timestamp, 'INTENSITY_NEAR_ZERO', `NEAR ZERO (${contextMsg})`);
    }
  }

  private transitionState(
    vl: VirtualLight, 
    newState: LightLifecycleStage, 
    timestamp: string, 
    rejectionReason?: string, 
    decisionText: string = ''
  ): void {
    if (vl.lifecycleStage !== newState) {
      vl.previousLifecycleStage = vl.lifecycleStage;
      vl.lifecycleStage = newState;
      vl.lastStateChangeTimestamp = timestamp;
    }
    vl.rejectionReason = rejectionReason;
    vl.decisionText = decisionText;
  }
}
]]>
</file>