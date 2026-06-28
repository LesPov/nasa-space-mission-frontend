

import { Injectable, inject } from '@angular/core';
import { AbstractMesh, AssetContainer, Color3, DirectionalLight, Matrix, Mesh, MeshBuilder, PointLight, SceneLoader, SpotLight, StandardMaterial, TransformNode, Vector3, Tags } from '@babylonjs/core';
import '@babylonjs/loaders';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { CoreSceneMaterialService } from '../utils/core-scene-material.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class CoreModelLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private materialSvc = inject(CoreSceneMaterialService);
  private entityManager = inject(EntityManagerService); 
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private gameContext = inject(GameContextService);

  private assetRegistry = new Map<string, AssetContainer>();

  public async cargarModeloAsync(obj: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const scene = this.motor3d.getScene();
    const path = obj.properties?.path || obj.asset?.path;

    if (!path) {
      this.crearMallaError(obj, scene, mallasCreadas);
      return Promise.resolve();
    }

    const fullPath = 'http://localhost:4000' + path;
    const lastSlash = fullPath.lastIndexOf('/');
    const rootUrl = fullPath.substring(0, lastSlash + 1);
    const fileName = fullPath.substring(lastSlash + 1);

    try {
      if (!this.assetRegistry.has(fullPath)) {
        const container = await SceneLoader.LoadAssetContainerAsync(rootUrl, fileName, scene);
        this.assetRegistry.set(fullPath, container);
      }

      const container = this.assetRegistry.get(fullPath)!;
      // Clonado de alta eficiencia compartiendo Buffers de geometría
      const instances = container.instantiateModelsToScene(name => name ? `${obj.uid}_${name}` : obj.uid, false, { doNotInstantiate: true });
      
      const rootNode = instances.rootNodes[0] as Mesh;
      rootNode.name = obj.name;
      
      this.aplicarTransformacionesYEntidad(rootNode, obj, mallasCreadas, instances.rootNodes as AbstractMesh[], instances.animationGroups);
    } catch (e) {
      console.error(`[CoreModelLoader] Error cargando GLB ${path}`, e);
      this.crearMallaError(obj, scene, mallasCreadas);
    }
  }

  private crearMallaError(obj: any, scene: any, mallasCreadas: Map<string, Mesh>) {
      const fallbackMesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
      const fallbackMat = new StandardMaterial('error_mat', scene);
      fallbackMat.wireframe = true;
      fallbackMat.emissiveColor = new Color3(1, 0, 0); 
      fallbackMesh.material = fallbackMat;
      this.aplicarTransformacionesYEntidad(fallbackMesh, obj, mallasCreadas, [fallbackMesh]);
  }

  private aplicarTransformacionesYEntidad(rootNode: Mesh, obj: any, mallasCreadas: Map<string, Mesh>, allMeshes: AbstractMesh[] = [], anims: any[] = []): void {
    const scene = this.motor3d.getScene();
    const isModel = obj.type === 'model';
    const isLight = obj.type?.startsWith('light_');
    const rolSaved = obj.properties?.rol || obj.rol || 'prop';

    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, rolSaved);
    this.persistenceMapper.applyDbToEntity(obj, entity);

    const isCharacter = !!entity.characterConfig;
    const scaleX = entity.transform.scale.x;
    const scaleY = entity.transform.scale.y;
    const scaleZ = entity.transform.scale.z;

    entity.bindView(rootNode); 

    rootNode.checkCollisions = false; 
    rootNode.isPickable = true;

    // 🔥 OBTENER DIMENSIONES REALES DEL MODELO 3D
    rootNode.computeWorldMatrix(true);
    const bounds = rootNode.getHierarchyBoundingVectors();
    const realSize = bounds.max.subtract(bounds.min);
    
    // Si la BD no mandó sizes específicos (que llegan como 1), usamos el real del modelo.
    const finalSizeX = (entity.collider.sizeX === 1) ? Math.max(0.1, realSize.x / scaleX) : entity.collider.sizeX!;
    const finalSizeY = (entity.collider.sizeY === 1) ? Math.max(0.1, realSize.y / scaleY) : entity.collider.sizeY!;
    const finalSizeZ = (entity.collider.sizeZ === 1) ? Math.max(0.1, realSize.z / scaleZ) : entity.collider.sizeZ!;

    // Asignamos para el editor visual
    entity.collider.sizeX = finalSizeX;
    entity.collider.sizeY = finalSizeY;
    entity.collider.sizeZ = finalSizeZ;

    rootNode.ellipsoid = new Vector3(finalSizeX * scaleX, finalSizeY * scaleY, finalSizeZ * scaleZ);
    rootNode.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    const subMeshes = rootNode.getChildMeshes(false);
    
    // 🔥 Verificamos si estamos en el Editor (En cualquiera de sus variantes)
    const isEditor = this.gameContext.mode() === GameMode.EDITOR || this.gameContext.mode() === GameMode.EDITING_IN_GAME || this.gameContext.mode() === GameMode.TEST_LIVE;

    subMeshes.forEach(m => {
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
      
      // 🔥 FIX DE GIZMO Y TRANSFORMACIONES EN VIVO:
      // Solo aplicamos optimizaciones destructivas (congelar matrices) si el juego está
      // en modo producción (FINAL_USER) y es un prop inanimado.
      if (!isCharacter && entity.rol === 'prop' && !isEditor) {
          m.doNotSyncBoundingInfo = true;
          m.freezeWorldMatrix();
      }
      
      if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
    });

    // Congelar matriz del root si es un prop estático (Solo en producción)
    if (!isCharacter && entity.rol === 'prop' && !isEditor) {
        rootNode.freezeWorldMatrix();
    }

    // 🔥 GENERACIÓN DE COLISIONADORES PERFECTOS
    if (entity.visual.isSolid && !isCharacter && entity.collider.type !== 'mesh') {
        let colMesh: Mesh;
        if (entity.collider.type === 'sphere') {
            colMesh = MeshBuilder.CreateSphere(`col_${obj.uid}`, { diameterX: finalSizeX, diameterY: finalSizeY, diameterZ: finalSizeZ }, scene);
        } else if (entity.collider.type === 'capsule') {
            const r = Math.max(finalSizeX, finalSizeZ) / 2;
            colMesh = MeshBuilder.CreateCapsule(`col_${obj.uid}`, { radius: r, height: finalSizeY }, scene);
        } else {
            colMesh = MeshBuilder.CreateBox(`col_${obj.uid}`, { width: finalSizeX, height: finalSizeY, depth: finalSizeZ }, scene);
        }

        colMesh.parent = rootNode;
        colMesh.position.set(entity.collider.offsetX ?? 0, entity.collider.offsetY ?? 0, entity.collider.offsetZ ?? 0);
        colMesh.isVisible = false;
        colMesh.checkCollisions = true; 
        Tags.AddTagsTo(colMesh, "proxy_collider system_element");
    }

    const setFog = (mesh: AbstractMesh) => {
      if (mesh.material) mesh.material.fogEnabled = !entity.visual.ignoraNiebla;
      mesh.getChildMeshes().forEach(c => setFog(c));
    };
    setFog(rootNode);

    anims.forEach(ag => ag.stop());
    entity.animationNames = anims.map(a => a.name);

    if (isLight && entity.light) {
      rootNode.isVisible = false;
      let lightObj: any;
      if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 0, 0), scene);
      else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 0, 0), new Vector3(0, -1, 0), entity.light.angle * (Math.PI / 180), 2, scene);
      else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

      let targetParent: TransformNode | AbstractMesh = rootNode;
      if (entity.light.attachedNodeName) {
        const foundNode = rootNode.getDescendants(false).find((n: any) => n.name === entity.light!.attachedNodeName) as TransformNode | AbstractMesh;
        if (foundNode) targetParent = foundNode;
      }

      lightObj.parent = targetParent;
      lightObj.intensity = entity.light.intensity;
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      lightObj.diffuse = Color3.FromHexString(isBW ? entity.light.lightColorBW : entity.light.lightColor);
      if (lightObj.position) lightObj.position.copyFromFloats(entity.light.lightPosX, entity.light.lightPosY, entity.light.lightPosZ);
    }

    if (entity.rol === 'spawn_point') {
        rootNode.checkCollisions = false;
        subMeshes.forEach(m => {
            m.checkCollisions = false;
            if (m.material && m.material instanceof StandardMaterial) {
                m.material.alpha = 0.4;
                m.material.wireframe = false;
            }
        });
    }

    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, rootNode);
  }
}
