import { Injectable, inject } from '@angular/core';
import { AbstractMesh, AssetContainer, Color3, Matrix, Mesh, MeshBuilder, SceneLoader, StandardMaterial, TransformNode, Vector3, Tags } from '@babylonjs/core';
import '@babylonjs/loaders';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { CoreSceneMaterialService } from '../utils/core-scene-material.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity, LightComponent } from '../../entities/game.entity';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';
import { SceneAssetCacheService } from './scene-asset-cache.service';
import { EngineSessionService } from '../../session/engine-session.service';

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
    const path = obj.properties?.path || obj.asset?.path;

    if (!path) {
      await this.crearMallaError(obj, scene, mallasCreadas);
      return;
    }

    const fullPath = 'http://localhost:4000' + path;

    try {
      const container = await this.getCachedAssetContainer(fullPath, scene);
      
      if (!this.sessionSvc.isSessionActive(sessionId) || scene.isDisposed) {
        container.dispose();
        return;
      }

      const instances = container.instantiateModelsToScene(name => name ? `${obj.uid}_${name}` : obj.uid, false, { doNotInstantiate: true });
      
      const wrapperMesh = new Mesh(obj.name, scene);
      instances.rootNodes.forEach(node => {
          node.parent = wrapperMesh;
      });

      wrapperMesh.computeWorldMatrix(true);
      const bounds = wrapperMesh.getHierarchyBoundingVectors();
      const realSize = bounds.max.subtract(bounds.min);
      const maxSize = Math.max(realSize.x, realSize.y, realSize.z);

      if (obj.isNewCreation && maxSize > 0.01) {
          const compensacion = 1.0 / maxSize; 
          
          if (!obj.properties) obj.properties = {};
          obj.properties.internalScale = compensacion; 
          
          instances.rootNodes.forEach(node => {
              const tNode = node as TransformNode;
              if (tNode.scaling) {
                  tNode.scaling.scaleInPlace(compensacion);
              }
          });
          
          obj.scale = { x: 1, y: 1, z: 1 };
          wrapperMesh.computeWorldMatrix(true);
          delete obj.isNewCreation;

      } else if (obj.properties?.internalScale) {
          const compensacion = obj.properties.internalScale;
          instances.rootNodes.forEach(node => {
              const tNode = node as TransformNode;
              if (tNode.scaling) {
                  tNode.scaling.scaleInPlace(compensacion);
              }
          });
          wrapperMesh.computeWorldMatrix(true);
      }
      
      await this.aplicarTransformacionesYEntidad(wrapperMesh, obj, mallasCreadas, instances.rootNodes as AbstractMesh[], instances.animationGroups);
    } catch (e) {
      console.error(`[CoreModelLoader] Error cargando GLB ${path}`, e);
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
      await this.aplicarTransformacionesYEntidad(fallbackMesh, obj, mallasCreadas, [fallbackMesh]);
  }

  private async aplicarTransformacionesYEntidad(rootNode: Mesh, obj: any, mallasCreadas: Map<string, Mesh>, allMeshes: AbstractMesh[] = [], anims: any[] = []): Promise<void> {
    const scene = this.motor3d.getScene();
    const isModel = obj.type === 'model';
    const isLight = obj.type?.startsWith('light_');
    const rolSaved = obj.properties?.rol || obj.rol || 'prop';

    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, rolSaved);
    this.persistenceMapper.applyDbToEntity(obj, entity);
    
    const isCharacter = entity.type === 'character' || entity.rol === 'player';

    const scaleX = entity.transform.scale.x;
    const scaleY = entity.transform.scale.y;
    const scaleZ = entity.transform.scale.z;

    entity.bindView(rootNode); 

    rootNode.checkCollisions = false; 
    rootNode.isPickable = true;

    rootNode.computeWorldMatrix(true);
    const updatedBounds = rootNode.getHierarchyBoundingVectors();
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
    rootNode.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    const subMeshes = rootNode.getChildMeshes(false);
    
    const isEditor = this.gameContext.mode() === GameMode.EDITOR || this.gameContext.mode() === GameMode.EDITING_IN_GAME || this.gameContext.mode() === GameMode.TEST_LIVE;
    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';

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
      
      m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      m.receiveShadows = true;
      
      if (!isCharacter && entity.rol === 'prop' && !isEditor && !entity.autoAnim?.enabled) {
          m.computeWorldMatrix(true);
          m.freezeWorldMatrix();
      }
      
      if (m.material) {
          this.materialSvc.asegurarMaterialUnico(m, entity.uid);
          const activeAmbient = isBW ? entity.visual.ambientColorBW : entity.visual.ambientColor;
          await this.materialSvc.ajustarMaterialGLB(m.material, isBW, scene, activeAmbient);
      }
    }

    if (!isCharacter && entity.rol === 'prop' && !isEditor && !entity.autoAnim?.enabled) {
        rootNode.computeWorldMatrix(true);
        rootNode.freezeWorldMatrix();
    }

    if (entity.visual.isSolid && !isCharacter && entity.collider.type !== 'mesh') {
        let colMesh: Mesh;
        if (entity.collider.type === 'sphere') {
            colMesh = MeshBuilder.CreateSphere(`col_${obj.uid}`, { diameterX: finalSizeX * 2, diameterY: finalSizeY * 2, diameterZ: finalSizeZ * 2 }, scene);
        } else if (entity.collider.type === 'capsule') {
            const r = Math.max(finalSizeX, finalSizeZ); 
            colMesh = MeshBuilder.CreateCapsule(`col_${obj.uid}`, { radius: r, height: finalSizeY * 2 }, scene);
        } else {
            colMesh = MeshBuilder.CreateBox(`col_${obj.uid}`, { width: finalSizeX * 2, height: finalSizeY * 2, depth: finalSizeZ * 2 }, scene);
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

    anims.forEach(ag => {
      ag.stop();
      ag.speedRatio = 1.0;
    });
    entity.animationNames = anims.map(a => a.name);

    if (isLight) {
      if (!entity.light) {
          entity.light = new LightComponent();
          entity.light.lightPosY = 0.5;
      }
      if (!obj.asset && !obj.properties?.path) {
          rootNode.isVisible = false;
      }
    }

    if (entity.rol === 'spawn_point') {
        rootNode.checkCollisions = false;
        Tags.AddTagsTo(rootNode, "editor_only ignore_raycast");
        rootNode.isVisible = isEditor;
        subMeshes.forEach(m => {
            m.checkCollisions = false;
            Tags.AddTagsTo(m, "editor_only ignore_raycast");
            m.isVisible = isEditor;
            if (m.material && m.material instanceof StandardMaterial) {
                m.material.alpha = isEditor ? 0.4 : 0.0;
                m.material.wireframe = false;
            }
        });
    }

    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, rootNode);
  }
}