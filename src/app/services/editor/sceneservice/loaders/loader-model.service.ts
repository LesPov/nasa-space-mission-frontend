import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DirectionalLight, Matrix, Mesh, PointLight, Quaternion, SceneLoader, SpotLight, TransformNode, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../../motor-3d.service';
import { SceneMaterialService } from '../scene-material.service';
import { SceneUtilsService } from '../scene-utils.service';

@Injectable({ providedIn: 'root' })
export class LoaderModelService {
  private motor3d = inject(Motor3dService);
  private materialSvc = inject(SceneMaterialService);
  private utilsSvc = inject(SceneUtilsService);

  public cargarModeloAsync(obj: any, mallasCreadas: Map<string, Mesh>): Promise<void> {
    const scene = this.motor3d.scene;
    const isModel = obj.type === 'model';
    const isLight = obj.type?.startsWith('light_');

    const defaultCollider = { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 };
    const defaultCamOffset = { x: 0, y: 1.6, z: 0 };

    const rolSaved = obj.properties?.rol || 'prop';
    const isSolidSaved = obj.properties?.isSolid ?? true;
    const isSelectableSaved = obj.properties?.isSelectable ?? true;
    const mensajeSaved = obj.properties?.mensaje || '';
    const isIgnoraNieblaSaved = obj.properties?.ignoraNiebla ?? false;
    const isEmisivoSaved = obj.properties?.esEmisivo ?? false;
    const savedBrilloIntensidad = this.utilsSvc.normalizarNumero(obj.properties?.brilloIntensidad, 1.0);
    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);
    const lightColorHex = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';

    const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
    if (savedCollider.radiusX !== undefined) {
      savedCollider.sizeX = savedCollider.radiusX;
      savedCollider.sizeY = savedCollider.heightY;
      savedCollider.sizeZ = savedCollider.radiusZ;
      savedCollider.type = 'capsule';
    }

    const savedCamOffset = obj.properties?.camOffset || { ...defaultCamOffset };
    const savedPlayerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

    const path = obj.properties?.path || obj.asset?.path;
    
    if (!path) {
      console.warn(`[LoaderModel] El objeto ${obj.name} no tiene una ruta válida de modelo. Se omitirá para no romper la carga.`);
      return Promise.resolve();
    }

    const fullPath = 'http://localhost:4000' + path;
    const lastSlash = fullPath.lastIndexOf('/');

    // 🔥 FIX VITAL: Sanitización extrema para asegurar 100% integridad
    const posX = obj.position?.x ?? 0;
    const posY = obj.position?.y ?? 0;
    const posZ = obj.position?.z ?? 0;
    
    const rotX = obj.rotation?.x ?? 0;
    const rotY = obj.rotation?.y ?? 0;
    const rotZ = obj.rotation?.z ?? 0;
    
    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && Number(obj.scale?.x) !== 0 && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && Number(obj.scale?.y) !== 0 && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && Number(obj.scale?.z) !== 0 && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;

    return SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
      const rootNode = result.meshes[0] as Mesh;
      rootNode.name = obj.name;
      rootNode.position = new Vector3(posX, posY, posZ);
      rootNode.rotationQuaternion = Quaternion.FromEulerAngles(rotX, rotY, rotZ);
      rootNode.scaling = new Vector3(scaleX, scaleY, scaleZ);
      rootNode.checkCollisions = false;
      rootNode.isPickable = true;

      // 🔥 ELLIPSOIDES SANITIZADOS
      rootNode.ellipsoid = new Vector3((savedCollider.sizeX ?? 0.5) * scaleX, (savedCollider.sizeY ?? 0.5) * scaleY, (savedCollider.sizeZ ?? 0.5) * scaleZ);
      rootNode.ellipsoidOffset = new Vector3((savedCollider.offsetX ?? 0) * scaleX, (savedCollider.offsetY ?? 0) * scaleY, (savedCollider.offsetZ ?? 0) * scaleZ);

      result.meshes.forEach(m => {
        if (m !== rootNode) {
          m.isPickable = true;
          m.checkCollisions = isSolidSaved;
          m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
          m.receiveShadows = true;
        }
        if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
      });

      const setFog = (mesh: AbstractMesh) => {
        if (mesh.material) mesh.material.fogEnabled = !isIgnoraNieblaSaved;
        mesh.getChildMeshes().forEach(c => setFog(c));
      };
      setFog(rootNode);

      const anims = result.animationGroups || [];
      anims.forEach(ag => ag.stop());

      let initialHeadLocal: Vector3 | null = null;
      if (isModel) {
        const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
        if (headNode) {
          headNode.computeWorldMatrix(true);
          rootNode.computeWorldMatrix(true);
          initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
        }
      }

      rootNode.metadata = {
        uid: obj.uid || window.crypto.randomUUID(),
        type: obj.type,
        rol: rolSaved,
        assetId: obj.assetId,
        path,
        isSolid: isSolidSaved,
        isSelectable: isSelectableSaved,
        mensaje: mensajeSaved,
        ignoraNiebla: isIgnoraNieblaSaved,
        esEmisivo: isEmisivoSaved,
        brilloIntensidad: savedBrilloIntensidad,
        interactDistanceFPS: this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0),
        interactDistanceTPS: this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0),
        interactSequenceIdFPS: obj.properties?.interactSequenceIdFPS || '',
        interactSequenceIdTPS: obj.properties?.interactSequenceIdTPS || '',
        animationNames: anims.map(a => a.name),
        collider: savedCollider,
        camOffset: savedCamOffset,
        playerConfig: savedPlayerConfig,
        selectionRange: { ...savedPlayerConfig.selectionRange },
        initialHeadLocal,
        parentId: obj.parentId || null,
        autoAnim: obj.properties?.autoAnim || null
      };

      if (isLight) {
        rootNode.metadata.lightColor = lightColorHex;
        rootNode.metadata.intensity = obj.properties?.intensity ?? 1.0;
        rootNode.metadata.range = obj.properties?.range ?? 50;
        rootNode.metadata.angle = obj.properties?.angle ?? 60;
        rootNode.metadata.attachedNodePath = obj.properties?.attachedNodePath || '';
        rootNode.metadata.attachedNodeName = obj.properties?.attachedNodeName || '';

        let lightObj: any;
        if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 2.5, 0), scene);
        else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), (obj.properties?.angle ?? 60) * (Math.PI / 180), 2, scene);
        else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

        let targetParent: TransformNode | AbstractMesh = rootNode;
        if (obj.properties?.attachedNodeName) {
          const allDescendants = rootNode.getDescendants(false);
          const foundNode = allDescendants.find((n: any) => n.name === obj.properties.attachedNodeName) as TransformNode | AbstractMesh;
          if (foundNode) targetParent = foundNode;
        }

        lightObj.parent = targetParent;
        lightObj.intensity = obj.properties?.intensity ?? 1.0;
        lightObj.diffuse = Color3.FromHexString(lightColorHex);
        lightObj.specular = new Color3(0, 0, 0);
        if (lightObj.range !== undefined) lightObj.range = obj.properties?.range ?? 50;
      }

      mallasCreadas.set(rootNode.metadata.uid, rootNode);
    });
  }
}