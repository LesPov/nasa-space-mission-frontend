import { Injectable, inject } from '@angular/core';
import {
  AbstractMesh,
  Color3,
  DirectionalLight,
  FresnelParameters,
  Matrix,
  Mesh,
  MeshBuilder,
  PointLight,
  Quaternion,
  SceneLoader,
  SpotLight,
  StandardMaterial,
  TransformNode,
  Vector3,
  VideoTexture,
  Texture
} from '@babylonjs/core';

import '@babylonjs/loaders';

import { cloneDefaultPlayerConfig, mergePlayerConfig } from '../player-config.model';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { HistorialService } from '../../historial.service';
import { SceneUtilsService } from './scene-utils.service';
import { SceneMaterialService } from './scene-material.service';
import { SceneShadowsService } from './scene-shadows.service';
import { SceneNodesService } from './scene-nodes.service';
import { SceneProjectionService } from './scene-projection.service';
import { BuilderTriggerService } from './builder-trigger.service';
 
@Injectable({ providedIn: 'root' })
export class SceneObjectBuilderService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private utilsSvc = inject(SceneUtilsService);
  private materialSvc = inject(SceneMaterialService);
  private shadowsSvc = inject(SceneShadowsService);
  private nodesSvc = inject(SceneNodesService);

  private projectionSvc = inject(SceneProjectionService);
  private triggerBuilderSvc = inject(BuilderTriggerService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.triggerBuilderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  public agregarTriggerCustom(
    nombre: string, shape: string, isComposite: boolean, mensaje: string,
    sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null
  ): void {
    this.triggerBuilderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode);
  }

  public agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): void {
    
    if (tipo === 'trigger' || tipo === 'trigger_compuesto') {
      const isComposite = tipo === 'trigger_compuesto';
      this.agregarTriggerCustom(nombre, 'cube', isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode);
      return;
    }

    const scene = this.motor3d.scene;
    const isModel = tipo === 'model';
    const isLight = tipo.startsWith('light_');
    const isVideo = tipo === 'video_plane';
    const isImage = tipo === 'image_plane';

    const safeSizeX = (sizeX !== undefined && sizeX !== null && Number(sizeX) !== 0 && !isNaN(Number(sizeX))) ? Number(sizeX) : 1;
    const safeSizeY = (sizeY !== undefined && sizeY !== null && Number(sizeY) !== 0 && !isNaN(Number(sizeY))) ? Number(sizeY) : 1;
    const safeSizeZ = (sizeZ !== undefined && sizeZ !== null && Number(sizeZ) !== 0 && !isNaN(Number(sizeZ))) ? Number(sizeZ) : 1;

    const defaultCollider = isModel
      ? { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
      : { type: (tipo === 'sphere' || tipo === 'bubble') ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };

    const defaultCamOffset = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.8, z: 0 };
    const defaultPlayerConfig = cloneDefaultPlayerConfig();

    const attachSelectionRange = (cfg: any) => {
      cfg.selectionRange = cfg.selectionRange || { fpsAdminMax: 10000, fpsUserMax: 3 };
      cfg.selectionRange.fpsAdminMax = this.utilsSvc.normalizarNumero(cfg.selectionRange.fpsAdminMax, 10000);
      cfg.selectionRange.fpsUserMax = this.utilsSvc.normalizarNumero(cfg.selectionRange.fpsUserMax, 3);
      return cfg;
    };

    if ((isLight && asset) || (isModel && asset)) {
      const fullPath = 'http://localhost:4000' + asset.path;
      const lastSlash = fullPath.lastIndexOf('/');

      SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
        const rootNode = result.meshes[0] as Mesh;
        rootNode.name = nombre;
        
        rootNode.scaling = new Vector3(safeSizeX, safeSizeY, safeSizeZ);

        if (!rootNode.rotationQuaternion) {
          rootNode.rotationQuaternion = Quaternion.FromEulerAngles(rootNode.rotation.x, rootNode.rotation.y, rootNode.rotation.z);
        }

        if (parentNode) {
          rootNode.position = parentNode.getAbsolutePosition().clone();
          rootNode.setParent(parentNode);
          rootNode.position = new Vector3(0, 0, 0);
        } else {
          rootNode.position = new Vector3(0, 0, 0);
        }

        rootNode.checkCollisions = false;
        rootNode.isPickable = true;
        rootNode.applyFog = true;

        result.meshes.forEach(m => {
          if (m !== rootNode) {
            m.isPickable = true;
            m.checkCollisions = isSolid;
            m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
            m.receiveShadows = true;
            m.applyFog = true;
          }
          if (m.material) {
            this.materialSvc.ajustarMaterialGLB(m.material);
          }
        });

        const anims = result.animationGroups || [];
        anims.forEach(ag => ag.stop());

        const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));

        let initialHeadLocal: Vector3 | null = null;
        if (isModel) {
          const headNode = rootNode.getChildTransformNodes(false).find(
            n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')
          ) as TransformNode;
          if (headNode) {
            headNode.computeWorldMatrix(true);
            rootNode.computeWorldMatrix(true);
            initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
          }
        }

        rootNode.metadata = {
          uid: window.crypto.randomUUID(),
          type: tipo,
          rol: isLight ? 'light' : rol,
          assetId: asset.id,
          path: asset.path,
          isSolid,
          isSelectable,
          mensaje,
          ignoraNiebla: false,
          interactDistanceFPS: 3.0,
          interactDistanceTPS: 5.0,
          interactSequenceIdFPS: '',
          interactSequenceIdTPS: '',
          animationNames: anims.map(a => a.name),
          collider: { ...defaultCollider },
          camOffset: { ...defaultCamOffset },
          playerConfig,
          selectionRange: { ...playerConfig.selectionRange },
          initialHeadLocal: isModel ? initialHeadLocal : undefined
        };

        if (isLight) {
          rootNode.metadata.lightColor = colorHex;
          rootNode.metadata.intensity = 1.0;
          rootNode.metadata.range = 50;
          rootNode.metadata.angle = 60;
          rootNode.metadata.attachedNodePath = '';
          rootNode.metadata.attachedNodeName = '';
          rootNode.metadata.lightPosX = 0;
          rootNode.metadata.lightPosY = 0;
          rootNode.metadata.lightPosZ = 0;

          let lightObj: any;
          if (tipo === 'light_point') lightObj = new PointLight('l_' + nombre, new Vector3(0, 0, 0), scene);
          else if (tipo === 'light_spot') lightObj = new SpotLight('l_' + nombre, new Vector3(0, 0, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
          else if (tipo === 'light_directional') lightObj = new DirectionalLight('l_' + nombre, new Vector3(0, -1, 0), scene);

          lightObj.parent = rootNode;
          lightObj.intensity = 1.0;
          lightObj.diffuse = Color3.FromHexString(colorHex);
          lightObj.specular = new Color3(0, 0, 0);
          
          // 🔥 FIX CREADOR VITAL: Fuerza a iniciar en 0 para que empate la métrica al momento de crearlo.
          if (lightObj.position) {
              lightObj.position.copyFromFloats(0, 0, 0);
          }
        } else {
          rootNode.metadata.esEmisivo = false;
          rootNode.metadata.brilloIntensidad = 1.0;
          rootNode.ellipsoid = new Vector3(defaultCollider.sizeX * safeSizeX, defaultCollider.sizeY * safeSizeY, defaultCollider.sizeZ * safeSizeZ);
          rootNode.ellipsoidOffset = new Vector3(defaultCollider.offsetX * safeSizeX, defaultCollider.offsetY * safeSizeY, defaultCollider.offsetZ * safeSizeZ);
        }

        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        this.state.objetoSeleccionado.set(rootNode);
        this.nodesSvc.actualizarListaNodos();
        this.historialSvc.registrarAccionCrear(rootNode);
        this.state.triggerUpdate();
      });
      return;
    } 
    else {
      let mesh!: Mesh;

      switch (tipo) {
        case 'cube': mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
        case 'sphere':
        case 'bubble':
        case 'light_point':
        case 'light_spot':
        case 'light_directional': mesh = MeshBuilder.CreateSphere(nombre, { diameter: tipo === 'bubble' ? 1 : 0.4 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
        case 'plane': mesh = MeshBuilder.CreateGround(nombre, { width: 1, height: 1 }, scene); break;
        case 'video_plane': mesh = MeshBuilder.CreatePlane(nombre, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
        case 'image_plane': mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
        default: return;
      }

      mesh.scaling = new Vector3(safeSizeX, safeSizeY, safeSizeZ);

      // 🔥 LÓGICA DE PADRE (E HOLOGAMAS)
      if (parentNode) {
        mesh.position = parentNode.getAbsolutePosition().clone();
        mesh.setParent(parentNode);
        
        if (tipo === 'image_plane') {
            mesh.position = new Vector3(0, 0, -2);
        } else {
            mesh.position = new Vector3(0, 0, 0); 
        }
      } else {
        mesh.position = new Vector3(0, tipo.startsWith('light_') ? 2 : (0.5 * safeSizeY), 0);
      }

      const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));

      mesh.metadata = {
        uid: window.crypto.randomUUID(),
        type: tipo,
        rol: isLight ? 'light' : rol,
        color: colorHex,
        colorBW: colorHex,
        isSolid,
        isSelectable,
        mensaje,
        ignoraNiebla: false,
        esEmisivo: false,
        respawnTime: 8,
        profundidadProyeccion: 10, 
        anguloProyeccion: 0,
        proyeccionAncho: 2,
        proyeccionAlto: 2,
        proyeccionRepeticiones: 1,
        proyeccionEspaciado: 2,
        proyeccionEje: 'Y',
        interactDistanceFPS: 3.0,
        interactDistanceTPS: 5.0,
        interactSequenceIdFPS: '',
        interactSequenceIdTPS: '',
        collider: { ...defaultCollider },
        camOffset: { ...defaultCamOffset },
        playerConfig,
        brilloIntensidad: 1.0,
        fadeDistance: 0,
        selectionRange: { ...playerConfig.selectionRange }
      };

      if (isVideo && asset) {
        mesh.metadata.assetId = asset.id;
        mesh.metadata.videoUrl = asset.path;
      }

      if (isImage && asset) {
        mesh.metadata.assetId = asset.id;
        mesh.metadata.imageUrl = asset.path;
      }

      mesh.isPickable = true;
      mesh.checkCollisions = isSolid && !isLight;
      mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      mesh.applyFog = true;

      if (tipo !== 'bubble' && tipo !== 'video_plane' && tipo !== 'image_plane' && !isLight) {
        mesh.receiveShadows = true;
      }

      mesh.ellipsoid = new Vector3(defaultCollider.sizeX * safeSizeX, defaultCollider.sizeY * safeSizeY, defaultCollider.sizeZ * safeSizeZ);
      mesh.ellipsoidOffset = new Vector3(defaultCollider.offsetX * safeSizeX, defaultCollider.offsetY * safeSizeY, defaultCollider.offsetZ * safeSizeZ);

      if (tipo === 'bubble') {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = new Color3(0.9, 0.95, 1.0);
        mat.diffuseColor = new Color3(0, 0, 0);
        mat.alpha = 0.6;
        mat.disableLighting = true;
        mat.opacityFresnelParameters = new FresnelParameters();
        mat.opacityFresnelParameters.leftColor = Color3.White();
        mat.opacityFresnelParameters.rightColor = Color3.Black();
        mat.opacityFresnelParameters.bias = 0.2;
        mat.opacityFresnelParameters.power = 1.5;
        mesh.material = mat;
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      } 
      else if (tipo === 'video_plane') {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = new Color3(0, 0, 0);
        mat.disableLighting = true;

        if (asset && asset.path) {
          const videoUrl = 'http://localhost:4000' + asset.path;
          const videoTexture = new VideoTexture('vidTex_' + nombre, videoUrl, scene, false, true, undefined, { autoPlay: false });
          mat.diffuseTexture = videoTexture;
        } else {
          mat.diffuseColor = new Color3(0.1, 0.1, 0.1);
        }
        mesh.material = mat;
      } 
      else if (tipo === 'image_plane') {
        const mat = new StandardMaterial('decalMat_' + nombre, scene);
        const isBW = scene.metadata?.globalVisualMode === 'bw';
        const activeColorAUsar = isBW ? mesh.metadata.colorBW : colorHex;
        const imageUrl = asset && asset.path ? 'http://localhost:4000' + asset.path : '';
        const tex = imageUrl ? new Texture(imageUrl, scene) : undefined;

        this.projectionSvc.configurarMaterialProyector(mat, activeColorAUsar, 1.0, false, tex);
        
        mesh.material = mat;
        mesh.metadata.decalMaterial = mat;
        mesh.metadata.brilloIntensidad = 1.0;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isVisible = this.state.rolSimulado() === 'admin';

        setTimeout(() => {
           this.projectionSvc.aplicarLogicaHolograma(mesh, scene);
        }, 100);
      } 
      else if (isLight) {
        mesh.metadata.lightColor = colorHex;
        mesh.metadata.intensity = 1.0;
        mesh.metadata.range = 50;
        mesh.metadata.angle = 60;
        
        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = Color3.FromHexString(colorHex);
        mat.wireframe = true;
        mat.maxSimultaneousLights = 16;
        mesh.material = mat;
        mesh.isVisible = this.state.rolSimulado() === 'admin';

        let lightObj: any;
        if (tipo === 'light_point') lightObj = new PointLight('l_' + nombre, new Vector3(0, 0, 0), scene);
        else if (tipo === 'light_spot') lightObj = new SpotLight('l_' + nombre, new Vector3(0, 0, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
        else if (tipo === 'light_directional') lightObj = new DirectionalLight('l_' + nombre, new Vector3(0, -1, 0), scene);

        lightObj.parent = mesh;
        lightObj.intensity = 1.0;
        lightObj.diffuse = Color3.FromHexString(colorHex);
        lightObj.specular = new Color3(0, 0, 0);

        // 🔥 FIX CREADOR VITAL
        if (lightObj.position) {
            lightObj.position.copyFromFloats(0, 0, 0);
        }
      } 
      else {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        const c3 = Color3.FromHexString(colorHex);
        mat.diffuseColor = c3;
        mat.specularColor = new Color3(0, 0, 0);

        if (rol === 'spawn_point') {
          mat.alpha = 0.5;
          mat.emissiveColor = new Color3(0, 1, 0);
        }

        mat.maxSimultaneousLights = 16;
        mesh.material = mat;
      }

      this.shadowsSvc.asignarObjetosASombrasDeLuces();
      this.state.objetoSeleccionado.set(mesh);
      this.nodesSvc.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(mesh);
      this.state.triggerUpdate();
    }
  }
}