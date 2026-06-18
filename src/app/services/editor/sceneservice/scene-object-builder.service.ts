
import { Injectable, inject } from '@angular/core';
import {
  AbstractMesh, Color3, DirectionalLight, FresnelParameters, Matrix, Mesh, MeshBuilder, PointLight, SceneLoader, SpotLight, StandardMaterial, TransformNode, Vector3, VideoTexture, Texture
} from '@babylonjs/core';
import '@babylonjs/loaders';
import { cloneDefaultPlayerConfig, mergePlayerConfig } from '../../../core/engine/models/player-config.model';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { HistorialService } from '../../historial.service';
import { SceneUtilsService } from './scene-utils.service';
import { SceneMaterialService } from './scene-material.service';
import { SceneShadowsService } from './scene-shadows.service';
import { SceneNodesService } from './scene-nodes.service';
import { SceneProjectionService } from './scene-projection.service';
import { BuilderTriggerService } from './builder-trigger.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';

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
  private entityManager = inject(EntityManagerService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.triggerBuilderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  public agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null): void {
    this.triggerBuilderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode);
  }

  public agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): void {
    
    if (tipo === 'trigger' || tipo === 'trigger_compuesto') {
      this.agregarTriggerCustom(nombre, 'cube', tipo === 'trigger_compuesto', mensaje, sizeX, sizeY, sizeZ, parentNode);
      return;
    }

    const scene = this.motor3d.scene;
    const isModel = tipo === 'model';
    const isLight = tipo.startsWith('light_');
    const isVideo = tipo === 'video_plane';
    const isImage = tipo === 'image_plane';

    const safeSizeX = this.utilsSvc.normalizarNumero(sizeX, 1);
    const safeSizeY = this.utilsSvc.normalizarNumero(sizeY, 1);
    const safeSizeZ = this.utilsSvc.normalizarNumero(sizeZ, 1);

    const entity = new GameEntity(window.crypto.randomUUID(), nombre, tipo, isLight ? 'light' : rol);
    
    entity.visual.color = colorHex;
    entity.visual.colorBW = colorHex;
    entity.visual.isSolid = isSolid;
    entity.visual.isSelectable = isSelectable;
    entity.visual.assetId = asset?.id;
    entity.visual.path = asset?.path;
    
    entity.interaction.mensaje = mensaje;

    if (isModel) {
      entity.collider = { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 };
    } else {
      entity.collider = { type: (tipo === 'sphere' || tipo === 'bubble') ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
    }

    entity.playerConfig = mergePlayerConfig(cloneDefaultPlayerConfig());
    entity.selectionRange = { fpsAdminMax: 10000, fpsUserMax: 3 };

    if (isLight && entity.light) {
      entity.light.lightColor = colorHex;
    }
    if (isVideo && entity.media) {
      entity.media.videoUrl = asset?.path;
    }
    if (isImage && entity.media) {
      entity.media.imageUrl = asset?.path;
    }

    entity.transform.scale = { x: safeSizeX, y: safeSizeY, z: safeSizeZ };

    if (parentNode) {
      const parentEntity = this.entityManager.getEntityByMesh(parentNode);
      entity.parentId = parentEntity?.uid || null;
      entity.transform.position = tipo === 'image_plane' ? { x: 0, y: 0, z: -2 } : { x: 0, y: 0, z: 0 };
    } else {
      entity.transform.position = { x: 0, y: isLight ? 2 : (0.5 * safeSizeY), z: 0 };
    }

    if ((isLight && asset) || (isModel && asset)) {
      const fullPath = 'http://localhost:4000' + asset.path;
      const lastSlash = fullPath.lastIndexOf('/');

      SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
        const rootNode = result.meshes[0] as Mesh;
        
        if (parentNode) { 
           rootNode.setParent(parentNode); 
        }

        entity.bindView(rootNode);

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
          if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
        });

        const anims = result.animationGroups || [];
        anims.forEach(ag => ag.stop());
        entity.animationNames = anims.map(a => a.name);

        if (isModel) {
          const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase().includes('head') || n.name.toLowerCase().includes('neck')) as TransformNode;
          if (headNode) {
            headNode.computeWorldMatrix(true);
            rootNode.computeWorldMatrix(true);
            entity.initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
            entity.syncToView(); 
          }
        }

        this.entityManager.addEntity(entity);
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
        case 'sphere': case 'bubble': case 'light_point': case 'light_spot': case 'light_directional': 
          mesh = MeshBuilder.CreateSphere(nombre, { diameter: tipo === 'bubble' ? 1 : 0.4 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
        case 'plane': mesh = MeshBuilder.CreateGround(nombre, { width: 1, height: 1 }, scene); break;
        case 'video_plane': mesh = MeshBuilder.CreatePlane(nombre, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
        case 'image_plane': mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
        default: return;
      }

      if (parentNode) {
        mesh.setParent(parentNode);
      }

      entity.bindView(mesh);
      
      mesh.isPickable = true;
      mesh.checkCollisions = isSolid && !isLight;
      mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      mesh.applyFog = true;

      if (tipo !== 'bubble' && tipo !== 'video_plane' && tipo !== 'image_plane' && !isLight) {
        mesh.receiveShadows = true;
      }

      mesh.ellipsoid = new Vector3(entity.collider.sizeX * safeSizeX, entity.collider.sizeY * safeSizeY, entity.collider.sizeZ * safeSizeZ);
      mesh.ellipsoidOffset = new Vector3(entity.collider.offsetX * safeSizeX, entity.collider.offsetY * safeSizeY, entity.collider.offsetZ * safeSizeZ);

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
          const videoTexture = new VideoTexture('vidTex_' + nombre, 'http://localhost:4000' + asset.path, scene, false, true, undefined, { autoPlay: false });
          mat.diffuseTexture = videoTexture;
        } else {
          mat.diffuseColor = new Color3(0.1, 0.1, 0.1);
        }
        mesh.material = mat;
      } 
      else if (tipo === 'image_plane') {
        const mat = new StandardMaterial('decalMat_' + nombre, scene);
        const isBW = scene.metadata?.globalVisualMode === 'bw';
        const activeColorAUsar = isBW ? entity.visual.colorBW : colorHex;
        const tex = asset?.path ? new Texture('http://localhost:4000' + asset.path, scene) : undefined;

        this.projectionSvc.configurarMaterialProyector(mat, activeColorAUsar, 1.0, false, tex);
        mesh.material = mat;
        mesh.metadata.decalMaterial = mat; 
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isVisible = this.state.rolSimulado() === 'admin';

        setTimeout(() => { this.projectionSvc.aplicarLogicaHolograma(mesh, scene); }, 100);
      } 
      else if (isLight) {
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

      this.entityManager.addEntity(entity);
      this.shadowsSvc.asignarObjetosASombrasDeLuces();
      this.state.objetoSeleccionado.set(mesh);
      this.nodesSvc.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(mesh);
      this.state.triggerUpdate();
    }
  }
}