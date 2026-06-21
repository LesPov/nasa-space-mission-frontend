
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DirectionalLight, Matrix, Mesh, MeshBuilder, PointLight, SceneLoader, SpotLight, StandardMaterial, TransformNode, Vector3, Tags } from '@babylonjs/core';
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

  public async cargarModeloAsync(obj: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const scene = this.motor3d.scene;
    const path = obj.properties?.path || obj.asset?.path;

    if (!path) {
      console.warn(`[CoreModelLoader] Objeto ${obj.name} sin ruta válida. Creando Malla de Recuperación (Error).`);
      const fallbackMesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
      const fallbackMat = new StandardMaterial('error_mat', scene);
      fallbackMat.wireframe = true;
      fallbackMat.emissiveColor = new Color3(1, 0, 0); 
      fallbackMesh.material = fallbackMat;
      this.aplicarTransformacionesYEntidad(fallbackMesh, obj, mallasCreadas);
      return Promise.resolve();
    }

    const fullPath = 'http://localhost:4000' + path;
    const lastSlash = fullPath.lastIndexOf('/');

    try {
      const result = await SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene);
      const rootNode = result.meshes[0] as Mesh;
      rootNode.name = obj.name;
      this.aplicarTransformacionesYEntidad(rootNode, obj, mallasCreadas, result.meshes, result.animationGroups);
    } catch (e) {
      console.error(`[CoreModelLoader] Error catastrofico cargando el GLB ${path}. Creando malla de error.`, e);
      const fallbackMesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
      const fallbackMat = new StandardMaterial('error_mat', scene);
      fallbackMat.wireframe = true;
      fallbackMat.emissiveColor = new Color3(1, 0, 0); 
      fallbackMesh.material = fallbackMat;
      this.aplicarTransformacionesYEntidad(fallbackMesh, obj, mallasCreadas);
    }
  }

  private aplicarTransformacionesYEntidad(rootNode: Mesh, obj: any, mallasCreadas: Map<string, Mesh>, subMeshes: AbstractMesh[] = [], anims: any[] = []): void {
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
    rootNode.ellipsoid = new Vector3((entity.collider.sizeX ?? 0.5) * scaleX, (entity.collider.sizeY ?? 0.5) * scaleY, (entity.collider.sizeZ ?? 0.5) * scaleZ);
    rootNode.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    subMeshes.forEach(m => {
      const nameL = m.name.toLowerCase();
      if (nameL.includes('proxycol')) Tags.AddTagsTo(m, "proxy_collider ignore_raycast system_element");
      if (nameL.startsWith('decal_')) Tags.AddTagsTo(m, "decal system_element ignore_raycast");

      if (m !== rootNode) {
        m.isPickable = entity.visual.isSelectable; 
        const vertices = m.getTotalVertices();
        
        if (vertices > 0) {
            if (isCharacter) {
                m.checkCollisions = false;
            } else {
                m.checkCollisions = entity.visual.isSolid; 
                if (entity.visual.isSolid && vertices > 500 && m instanceof Mesh) {
                    m.useOctreeForCollisions = true; m.useOctreeForPicking = true;
                }
            }
        } else {
            m.checkCollisions = false;
        }
        
        m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
        m.receiveShadows = true;
      }
      if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
    });

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
        // 🔥 FIX: Actualizado al getter/setter directo del ECS
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
      lightObj.specular = new Color3(0, 0, 0);
      
      if (lightObj.range !== undefined) lightObj.range = entity.light.range;

      if (lightObj.position) {
          lightObj.position.copyFromFloats(entity.light.lightPosX, entity.light.lightPosY, entity.light.lightPosZ);
      }
    }

    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, rootNode);
  }
}