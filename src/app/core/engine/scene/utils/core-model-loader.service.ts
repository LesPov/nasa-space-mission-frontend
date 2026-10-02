import { Injectable, inject } from '@angular/core';
import { 
    AbstractMesh, AssetContainer, Color3, Matrix, Mesh, MeshBuilder, 
    StandardMaterial, PBRMaterial, TransformNode, Vector3, 
    Tags, Quaternion, InstancedMesh 
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

    try {
      const container = await this.getCachedAssetContainer(fullPath, scene);
      if (!this.sessionSvc.isSessionActive(sessionId) || scene.isDisposed) { 
        container.dispose(); 
        return; 
      }

      // Siempre clonar jerarquía completa real para garantizar receivers y self-shadowing limpios en WebGL
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
        const compensacion = obj.properties.internalScale;
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

    const scaleX = entity.transform.scale.x;
    const scaleY = entity.transform.scale.y;
    const scaleZ = entity.transform.scale.z;

    rootNode.checkCollisions = false; 
    rootNode.isPickable = true;

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
      
      m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      
      // Todas las piezas del modelo reciben y proyectan sombras
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
        if (override.scale) m.scaling.set(override.scale.x, override.scale.y, override.scale.z);
      }
      
      const isInteractable = !!entity.interaction?.mensaje || !!entity.interaction?.interactSequenceIdFPS;
      if (!isCharacter && entity.rol === 'prop' && !isEditor && !entity.autoAnim?.enabled && !override && !isInteractable) {
        m.computeWorldMatrix(true);
        m.freezeWorldMatrix();
      }
      
      if (m.material) {
        // Garantizar soporte de 8 luces simultáneas para evitar que la luz interior sea descartada
        if (m.material.getClassName() === "StandardMaterial" || m.material.getClassName() === "PBRMaterial") {
          (m.material as any).maxSimultaneousLights = 8;
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
      const visualSphere = MeshBuilder.CreateSphere(`visual_${entity.name}`, { diameter: 1.0, segments: 16 }, scene);
      visualSphere.parent = rootNode;
      visualSphere.isPickable = false;
      visualSphere.checkCollisions = false;
      visualSphere.receiveShadows = false;
      visualSphere.renderingGroupId = 1;
      visualSphere.scaling.set(0.4, 0.4, 0.4);

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