
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, AssetContainer, Color3, DirectionalLight, Matrix, Mesh, MeshBuilder, PointLight, SceneLoader, SpotLight, StandardMaterial, TransformNode, Vector3, Tags } from '@babylonjs/core';
import '@babylonjs/loaders';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { CoreSceneMaterialService } from '../utils/core-scene-material.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';

@Injectable({ providedIn: 'root' })
export class CoreModelLoaderService {
  private motor3d = inject(Motor3dService);
  private materialSvc = inject(CoreSceneMaterialService);
  private entityManager = inject(EntityManagerService); 
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private worldSettingsSvc = inject(WorldSettingsService);

  // 🔥 SOLUCIÓN ARQUITECTÓNICA: Caché de Assets para evitar re-descargas y saturación de RAM
  private assetRegistry = new Map<string, AssetContainer>();

  public async cargarModeloAsync(obj: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const scene = this.motor3d.scene;
    const path = obj.properties?.path || obj.asset?.path;

    if (!path) {
      console.warn(`[CoreModelLoader] Objeto ${obj.name} sin ruta válida. Creando Malla de Recuperación (Error).`);
      this.crearMallaError(obj, scene, mallasCreadas);
      return Promise.resolve();
    }

    const fullPath = 'http://localhost:4000' + path;
    const lastSlash = fullPath.lastIndexOf('/');
    const rootUrl = fullPath.substring(0, lastSlash + 1);
    const fileName = fullPath.substring(lastSlash + 1);

    try {
      // 1. Cargar y Cachear el Contenedor Maestro si no existe
      if (!this.assetRegistry.has(fullPath)) {
        const container = await SceneLoader.LoadAssetContainerAsync(rootUrl, fileName, scene);
        this.assetRegistry.set(fullPath, container);
      }

      // 2. Instanciar desde el caché (Ultra rápido, comparte buffers de geometría)
      const container = this.assetRegistry.get(fullPath)!;
      const instances = container.instantiateModelsToScene(name => name ? `${obj.uid}_${name}` : obj.uid, false, { doNotInstantiate: true });
      
      const rootNode = instances.rootNodes[0] as Mesh;
      rootNode.name = obj.name;
      
      this.aplicarTransformacionesYEntidad(rootNode, obj, mallasCreadas, instances.rootNodes as AbstractMesh[], instances.animationGroups);
    } catch (e) {
      console.error(`[CoreModelLoader] Error catastrófico cargando el GLB ${path}. Creando malla de error.`, e);
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
    const scene = this.motor3d.scene;
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
    
    // Mantenemos el elipsoide base para cuando el objeto actúa como jugador/entidad móvil
    rootNode.ellipsoid = new Vector3((entity.collider.sizeX ?? 0.5) * scaleX, (entity.collider.sizeY ?? 0.5) * scaleY, (entity.collider.sizeZ ?? 0.5) * scaleZ);
    rootNode.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    const subMeshes = rootNode.getChildMeshes(false);

    // 🔥 SOLUCIÓN ARQUITECTÓNICA: Desactivar colisiones complejas en mallas visuales para evitar caídas de FPS
    subMeshes.forEach(m => {
      const nameL = m.name.toLowerCase();
      if (nameL.includes('proxycol')) Tags.AddTagsTo(m, "proxy_collider ignore_raycast system_element");
      if (nameL.startsWith('decal_')) Tags.AddTagsTo(m, "decal system_element ignore_raycast");

      m.isPickable = entity.visual.isSelectable; 
      
      // La malla visual NUNCA tiene colisiones complejas a menos que sea explícitamente forzado a tipo "mesh"
      if (entity.collider.type === 'mesh' && entity.visual.isSolid && !isCharacter) {
          m.checkCollisions = m.getTotalVertices() > 0;
      } else {
          m.checkCollisions = false;
      }
      
      m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      m.receiveShadows = true;
      
      if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
    });

    // 🔥 GENERACIÓN DE COLISIONADORES PRIMITIVOS INVISIBLES (Máximo Rendimiento Físico)
    if (entity.visual.isSolid && !isCharacter && entity.collider.type !== 'mesh') {
        const cX = entity.collider.sizeX ?? 1;
        const cY = entity.collider.sizeY ?? 1;
        const cZ = entity.collider.sizeZ ?? 1;
        
        let colMesh: Mesh;
        if (entity.collider.type === 'sphere') {
            colMesh = MeshBuilder.CreateSphere(`col_${obj.uid}`, { diameterX: cX, diameterY: cY, diameterZ: cZ }, scene);
        } else if (entity.collider.type === 'capsule') {
            const r = Math.max(cX, cZ) / 2;
            colMesh = MeshBuilder.CreateCapsule(`col_${obj.uid}`, { radius: r, height: cY }, scene);
        } else {
            colMesh = MeshBuilder.CreateBox(`col_${obj.uid}`, { width: cX, height: cY, depth: cZ }, scene);
        }

        colMesh.parent = rootNode;
        colMesh.position.set(entity.collider.offsetX ?? 0, entity.collider.offsetY ?? 0, entity.collider.offsetZ ?? 0);
        colMesh.isVisible = false;
        colMesh.checkCollisions = true; // Este es el que bloquea realmente al jugador
        // Le quitamos el tag 'ignore_raycast' para asegurar que la gravedad golpee este bloque
        Tags.AddTagsTo(colMesh, "proxy_collider system_element");
    }

    const setFog = (mesh: AbstractMesh) => {
      if (mesh.material) mesh.material.fogEnabled = !entity.visual.ignoraNiebla;
      mesh.getChildMeshes().forEach(c => setFog(c));
    };
    setFog(rootNode);

    anims.forEach(ag => ag.stop());
    entity.animationNames = anims.map(a => a.name);

    if (isModel) {
      const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
      if (headNode) {
        headNode.computeWorldMatrix(true);
        rootNode.computeWorldMatrix(true);
        entity.initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
        entity.syncToView(); 
      }
    }

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
      const activeColor = isBW ? entity.light.lightColorBW : entity.light.lightColor;
      lightObj.diffuse = Color3.FromHexString(activeColor);
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