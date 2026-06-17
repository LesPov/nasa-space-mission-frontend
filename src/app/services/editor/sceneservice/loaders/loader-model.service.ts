
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DirectionalLight, Matrix, Mesh, MeshBuilder, PointLight, Quaternion, SceneLoader, SpotLight, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../../motor-3d.service';
import { SceneMaterialService } from '../scene-material.service';
import { SceneUtilsService } from '../scene-utils.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class LoaderModelService {
  private motor3d = inject(Motor3dService);
  private materialSvc = inject(SceneMaterialService);
  private utilsSvc = inject(SceneUtilsService);
  private entityManager = inject(EntityManagerService); 

  public async cargarModeloAsync(obj: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const scene = this.motor3d.scene;
    const isModel = obj.type === 'model';
    const isLight = obj.type?.startsWith('light_');

    const rolSaved = obj.properties?.rol || 'prop';
    const path = obj.properties?.path || obj.asset?.path;

    // 🔥 FIX: PARCHE CONTRA MODELOS ROTOS (CAJA DE ERROR ROJA)
    // Si la DB guardó el objeto sin path, en lugar de no crear nada, creamos un marcador de error
    if (!path) {
      console.warn(`[LoaderModel] Objeto ${obj.name} sin ruta válida. Creando Malla de Recuperación (Error).`);
      
      const fallbackMesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
      const fallbackMat = new StandardMaterial('error_mat', scene);
      fallbackMat.wireframe = true;
      fallbackMat.emissiveColor = new Color3(1, 0, 0); // Rojo puro brillante
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
      console.error(`[LoaderModel] Error catastrofico cargando el GLB ${path}. Creando malla de error.`, e);
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
    const rolSaved = obj.properties?.rol || 'prop';
    const isProp = rolSaved === 'prop';

    // Construcción limpia de la Entidad Lógica
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, rolSaved);

    entity.transform.position = { x: obj.position?.x ?? 0, y: obj.position?.y ?? 0, z: obj.position?.z ?? 0 };
    entity.transform.rotation = { x: obj.rotation?.x ?? 0, y: obj.rotation?.y ?? 0, z: obj.rotation?.z ?? 0 };
    
    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && Number(obj.scale?.x) !== 0 && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && Number(obj.scale?.y) !== 0 && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && Number(obj.scale?.z) !== 0 && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;
    entity.transform.scale = { x: scaleX, y: scaleY, z: scaleZ };

    entity.parentId = obj.parentId || null;
    
    // Extracción de Propiedades
    entity.visual.color = obj.properties?.color || '#ffffff';
    entity.visual.colorBW = obj.properties?.colorBW || entity.visual.color;
    entity.visual.isSolid = obj.properties?.isSolid ?? true;
    entity.visual.isSelectable = obj.properties?.isSelectable ?? true;
    entity.visual.ignoraNiebla = obj.properties?.ignoraNiebla ?? false;
    entity.visual.esEmisivo = obj.properties?.esEmisivo ?? false;
    entity.visual.brilloIntensidad = this.utilsSvc.normalizarNumero(obj.properties?.brilloIntensidad, 1.0);
    entity.visual.path = obj.properties?.path || obj.asset?.path;
    entity.visual.assetId = obj.assetId;

    entity.interaction.mensaje = obj.properties?.mensaje || '';
    entity.interaction.interactDistanceFPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0);
    entity.interaction.interactDistanceTPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0);
    entity.interaction.interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
    entity.interaction.interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';

    const defaultCollider = isModel ? (isProp ? { type: 'mesh', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 } : { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }) : { type: 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
    const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
    if (savedCollider.radiusX !== undefined) {
      savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
      if (savedCollider.type !== 'mesh') savedCollider.type = 'capsule'; 
    }
    entity.collider = savedCollider;

    // 🔥 FIX TYPESCRIPT: Asignar valores directamente ya normalizados
    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);
    entity.selectionRange = { ...savedSelectionRange };
    entity.playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

    entity.camOffset = obj.properties?.camOffset || { x: 0, y: 1.6, z: 0 };
    entity.autoAnim = obj.properties?.autoAnim || null;

    if (isLight && entity.light) {
      entity.light.lightColor = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.intensity = obj.properties?.intensity ?? 1.0;
      entity.light.range = obj.properties?.range ?? 50;
      entity.light.angle = obj.properties?.angle ?? 60;
      entity.light.lightPosX = obj.properties?.lightPosX ?? 0;
      entity.light.lightPosY = obj.properties?.lightPosY ?? 0;
      entity.light.lightPosZ = obj.properties?.lightPosZ ?? 0;
      entity.light.attachedNodePath = obj.properties?.attachedNodePath || '';
      entity.light.attachedNodeName = obj.properties?.attachedNodeName || '';
    }

    // APLICAMOS AL MESH Y DELEGAMOS A LA ENTIDAD EL CONTROL
    entity.bindView(rootNode); 

    // Configuración Babylon-Específica
    rootNode.checkCollisions = false;
    rootNode.isPickable = true;
    rootNode.ellipsoid = new Vector3((entity.collider.sizeX ?? 0.5) * scaleX, (entity.collider.sizeY ?? 0.5) * scaleY, (entity.collider.sizeZ ?? 0.5) * scaleZ);
    rootNode.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    subMeshes.forEach(m => {
      if (m !== rootNode) {
        m.isPickable = entity.visual.isSelectable; 
        const vertices = m.getTotalVertices();
        if (vertices > 0) {
            m.checkCollisions = entity.visual.isSolid; 
            if (entity.visual.isSolid && vertices > 500 && m instanceof Mesh) {
                m.useOctreeForCollisions = true; m.useOctreeForPicking = true;
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
        entity.initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
      }
    }

    if (isLight && entity.light) {
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
      lightObj.diffuse = Color3.FromHexString(entity.light.lightColor);
      lightObj.specular = new Color3(0, 0, 0);
      if (lightObj.range !== undefined) lightObj.range = entity.light.range;

      if (lightObj.position) {
          lightObj.position.copyFromFloats(entity.light.lightPosX, entity.light.lightPosY, entity.light.lightPosZ);
      }
    }

    // 🔥 Forzamos la reinyección del metadata final.
    entity.syncToView();
    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, rootNode);
  }
}