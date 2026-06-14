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

@Injectable({ providedIn: 'root' })
export class SceneObjectBuilderService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private utilsSvc = inject(SceneUtilsService);
  private materialSvc = inject(SceneMaterialService);
  private shadowsSvc = inject(SceneShadowsService);
  private nodesSvc = inject(SceneNodesService);

  private configurarMaterialImagenPlano(
    mat: StandardMaterial,
    colorHex: string,
    ignoraNiebla: boolean,
    esEmisivo: boolean,
    texture?: Texture
  ): void {
    const c3 = Color3.FromHexString(colorHex);

    mat.diffuseColor = c3;
    mat.specularColor = new Color3(0, 0, 0);
    mat.ambientColor = c3.scale(0.2);

    // Evitar el blanco quemado.
    mat.emissiveColor = esEmisivo ? c3.scale(0.08) : new Color3(0, 0, 0);

    // No apagar luces del todo para no “lavar” la textura.
    mat.disableLighting = false;

    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.alpha = 1;
    mat.fogEnabled = !ignoraNiebla;
    mat.zOffset = -2;

    if (texture) {
      texture.hasAlpha = true;
      texture.gammaSpace = true;
      mat.diffuseTexture = texture;
    }
  }

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    const scene = this.motor3d.scene;
    let newMesh!: Mesh;

    switch (nuevaForma) {
      case 'sphere':
        newMesh = MeshBuilder.CreateSphere(oldMesh.name, { diameter: 1 }, scene);
        break;
      case 'cylinder':
        newMesh = MeshBuilder.CreateCylinder(oldMesh.name, { height: 1, diameter: 1 }, scene);
        break;
      default:
        newMesh = MeshBuilder.CreateBox(oldMesh.name, { size: 1 }, scene);
        break;
    }

    if (oldMesh.parent) {
      newMesh.position = oldMesh.getAbsolutePosition().clone();
      newMesh.setParent(oldMesh.parent);
    } else {
      newMesh.position = oldMesh.position.clone();
    }

    if (oldMesh.rotationQuaternion) newMesh.rotationQuaternion = oldMesh.rotationQuaternion.clone();
    else newMesh.rotation = oldMesh.rotation.clone();

    newMesh.scaling = oldMesh.scaling.clone();
    newMesh.metadata = JSON.parse(JSON.stringify(oldMesh.metadata));
    newMesh.metadata.triggerShape = nuevaForma;

    const mat = new StandardMaterial('mat_trigger_' + newMesh.name, scene);
    mat.diffuseColor = new Color3(0.2, 1, 0.2);
    mat.alpha = 0.3;
    mat.wireframe = true;
    mat.maxSimultaneousLights = 16;
    newMesh.material = mat;

    newMesh.isPickable = true;
    newMesh.checkCollisions = false;
    newMesh.isVisible = this.state.rolSimulado() === 'admin';

    if (this.state.objetoSeleccionado() === oldMesh) {
      this.state.objetoSeleccionado.set(newMesh);
    }

    oldMesh.dispose();
    this.nodesSvc.actualizarListaNodos();
    return newMesh;
  }

  public agregarTriggerCustom(
    nombre: string,
    shape: string,
    isComposite: boolean,
    mensaje: string,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    parentNode: AbstractMesh | null = null
  ): void {
    const scene = this.motor3d.scene;
    let mesh!: Mesh;

    switch (shape) {
      case 'sphere':
        mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene);
        break;
      case 'cylinder':
        mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene);
        break;
      default:
        mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene);
        break;
    }

    mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);

    if (parentNode) {
      mesh.position = parentNode.getAbsolutePosition().clone();
      mesh.setParent(parentNode);
    } else {
      mesh.position = new Vector3(0, sizeY / 2, 0);
    }

    const mat = new StandardMaterial('mat_trigger_' + nombre, scene);
    mat.diffuseColor = new Color3(0.2, 1, 0.2);
    mat.alpha = 0.3;
    mat.wireframe = true;
    mat.maxSimultaneousLights = 16;
    mesh.material = mat;

    mesh.metadata = {
      uid: window.crypto.randomUUID(),
      type: 'trigger',
      isComposite: isComposite,
      triggerShape: shape || 'cube',
      conditions: isComposite ? ['on_enter'] : [],
      mensajeEntrada: isComposite ? mensaje : '',
      mensajeSalida: '',
      soundUrlEntrada: '',
      soundUrlSalida: '',
      seqEntrada: '',
      seqSalida: '',
      timeEntrada: 4.5,
      timeSalida: 4.5,
      videoEntrada: '',
      videoSalida: '',
      condition: 'on_enter',
      mensaje: isComposite ? '' : mensaje,
      soundUrl: '',
      interactSequenceId: '',
      timeNorm: 4.5,
      videoNorm: '',
      isRepeatable: false,
      isEnabled: true,
      hasTriggeredEnter: false,
      hasTriggeredExit: false
    };

    mesh.isPickable = true;
    mesh.checkCollisions = false;
    mesh.isVisible = this.state.rolSimulado() === 'admin';

    this.state.objetoSeleccionado.set(mesh);
    this.nodesSvc.actualizarListaNodos();
    this.historialSvc.registrarAccionCrear(mesh);
    this.state.triggerUpdate();
  }

  public agregarObjetoCustom(
    tipo: string,
    nombre: string,
    rol: string,
    colorHex: string,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    asset?: any,
    isSolid: boolean = true,
    isSelectable: boolean = true,
    mensaje: string = '',
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

    if (isLight) {
      const lightColorHex = colorHex;

      if (asset) {
        const fullPath = 'http://localhost:4000' + asset.path;
        const lastSlash = fullPath.lastIndexOf('/');
        SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
          const rootNode = result.meshes[0] as Mesh;
          rootNode.name = nombre;
          rootNode.scaling = new Vector3(sizeX, sizeY, sizeZ);

          if (!rootNode.rotationQuaternion) {
            rootNode.rotationQuaternion = Quaternion.FromEulerAngles(
              rootNode.rotation.x,
              rootNode.rotation.y,
              rootNode.rotation.z
            );
          }

          if (parentNode) {
            rootNode.position = parentNode.getAbsolutePosition().clone();
            rootNode.setParent(parentNode);
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

          rootNode.metadata = {
            uid: window.crypto.randomUUID(),
            type: tipo,
            rol: 'light',
            assetId: asset.id,
            path: asset.path,
            isSolid,
            isSelectable,
            mensaje,
            ignoraNiebla: false,
            lightColor: colorHex,
            intensity: 1.0,
            range: 50,
            angle: 60,
            attachedNodePath: '',
            attachedNodeName: '',
            animationNames: anims.map(a => a.name),
            collider: { ...defaultCollider },
            camOffset: { ...defaultCamOffset },
            playerConfig,
            selectionRange: { ...playerConfig.selectionRange }
          };

          let lightObj: any;
          if (tipo === 'light_point') lightObj = new PointLight('l_' + nombre, new Vector3(0, 2.5, 0), scene);
          else if (tipo === 'light_spot') lightObj = new SpotLight('l_' + nombre, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
          else if (tipo === 'light_directional') lightObj = new DirectionalLight('l_' + nombre, new Vector3(0, -1, 0), scene);

          lightObj.parent = rootNode;
          lightObj.intensity = 1.0;
          lightObj.diffuse = Color3.FromHexString(colorHex);
          lightObj.specular = new Color3(0, 0, 0);

          this.shadowsSvc.asignarObjetosASombrasDeLuces();
          this.state.objetoSeleccionado.set(rootNode);
          this.nodesSvc.actualizarListaNodos();
          this.historialSvc.registrarAccionCrear(rootNode);
          this.state.triggerUpdate();
        });
        return;
      } else {
        const mesh = MeshBuilder.CreateSphere(nombre, { diameter: 0.4 }, scene);
        mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);

        if (parentNode) {
          mesh.position = parentNode.getAbsolutePosition().clone();
          mesh.setParent(parentNode);
        } else {
          mesh.position = new Vector3(0, 2, 0);
        }

        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = Color3.FromHexString(colorHex);
        mat.wireframe = true;
        mat.maxSimultaneousLights = 16;
        mesh.material = mat;
        mesh.applyFog = true;

        let lightObj: any;
        if (tipo === 'light_point') lightObj = new PointLight('l_' + nombre, new Vector3(0, 2.5, 0), scene);
        else if (tipo === 'light_spot') lightObj = new SpotLight('l_' + nombre, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
        else if (tipo === 'light_directional') lightObj = new DirectionalLight('l_' + nombre, new Vector3(0, -1, 0), scene);

        lightObj.parent = mesh;
        lightObj.intensity = 1.0;
        lightObj.diffuse = Color3.FromHexString(colorHex);
        lightObj.specular = new Color3(0, 0, 0);

        const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));
        mesh.metadata = {
          uid: window.crypto.randomUUID(),
          type: tipo,
          rol: 'light',
          isSolid: false,
          isSelectable: true,
          ignoraNiebla: false,
          lightColor: colorHex,
          intensity: 1.0,
          range: 50,
          angle: 60,
          attachedNodePath: '',
          attachedNodeName: '',
          playerConfig,
          selectionRange: { ...playerConfig.selectionRange }
        };

        mesh.isPickable = true;
        mesh.checkCollisions = false;
        mesh.isVisible = this.state.rolSimulado() === 'admin';

        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        this.state.objetoSeleccionado.set(mesh);
        this.nodesSvc.actualizarListaNodos();
        this.historialSvc.registrarAccionCrear(mesh);
        this.state.triggerUpdate();
        return;
      }
    }

    if (isModel && asset) {
      const fullPath = 'http://localhost:4000' + asset.path;
      const lastSlash = fullPath.lastIndexOf('/');

      SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
        const rootNode = result.meshes[0] as Mesh;
        rootNode.name = nombre;
        rootNode.scaling = new Vector3(sizeX, sizeY, sizeZ);

        if (!rootNode.rotationQuaternion) {
          rootNode.rotationQuaternion = Quaternion.FromEulerAngles(
            rootNode.rotation.x,
            rootNode.rotation.y,
            rootNode.rotation.z
          );
        }

        if (parentNode) {
          rootNode.position = parentNode.getAbsolutePosition().clone();
          rootNode.setParent(parentNode);
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

        let initialHeadLocal: Vector3 | null = null;
        const headNode = rootNode.getChildTransformNodes(false).find(
          n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')
        ) as TransformNode;
        if (headNode) {
          headNode.computeWorldMatrix(true);
          rootNode.computeWorldMatrix(true);
          initialHeadLocal = Vector3.TransformCoordinates(
            headNode.getAbsolutePosition(),
            Matrix.Invert(rootNode.getWorldMatrix())
          );
        }

        const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));

        rootNode.metadata = {
          uid: window.crypto.randomUUID(),
          type: 'model',
          rol,
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
          initialHeadLocal
        };

        rootNode.ellipsoid = new Vector3(defaultCollider.sizeX * sizeX, defaultCollider.sizeY * sizeY, defaultCollider.sizeZ * sizeZ);
        rootNode.ellipsoidOffset = new Vector3(defaultCollider.offsetX * sizeX, defaultCollider.offsetY * sizeY, defaultCollider.offsetZ * sizeZ);

        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        this.state.objetoSeleccionado.set(rootNode);
        this.nodesSvc.actualizarListaNodos();
        this.historialSvc.registrarAccionCrear(rootNode);
        this.state.triggerUpdate();
      });
    } else {
      let mesh!: Mesh;

      switch (tipo) {
        case 'cube':
          mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene);
          break;
        case 'sphere':
          mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene);
          break;
        case 'cylinder':
          mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene);
          break;
        case 'plane':
          mesh = MeshBuilder.CreateGround(nombre, { width: 1, height: 1 }, scene);
          break;
        case 'bubble':
          mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene);
          break;
        case 'video_plane':
          mesh = MeshBuilder.CreatePlane(nombre, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
          break;
        case 'image_plane':
          mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene);
          {
            const projMat = new StandardMaterial('projMat_' + nombre, scene);
            projMat.wireframe = true;
            projMat.emissiveColor = new Color3(1, 1, 0);
            projMat.alpha = 0.05;
            projMat.disableLighting = true;
            mesh.material = projMat;
            mesh.isVisible = this.state.rolSimulado() === 'admin';
          }
          break;
        default:
          return;
      }

      mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);

      if (parentNode) {
        mesh.position = parentNode.getAbsolutePosition().clone();
        mesh.setParent(parentNode);
      } else {
        mesh.position = new Vector3(0, 0.5 * sizeY, 0);
      }

      const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));

      mesh.metadata = {
        uid: window.crypto.randomUUID(),
        type: tipo,
        rol,
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
        interactDistanceFPS: 3.0,
        interactDistanceTPS: 5.0,
        interactSequenceIdFPS: '',
        interactSequenceIdTPS: '',
        collider: { ...defaultCollider },
        camOffset: { ...defaultCamOffset },
        playerConfig,
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
      mesh.checkCollisions = isSolid;
      mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      mesh.applyFog = true;

      if (tipo !== 'bubble' && tipo !== 'video_plane' && tipo !== 'image_plane') {
        mesh.receiveShadows = true;
      }

      mesh.ellipsoid = new Vector3(defaultCollider.sizeX * sizeX, defaultCollider.sizeY * sizeY, defaultCollider.sizeZ * sizeZ);
      mesh.ellipsoidOffset = new Vector3(defaultCollider.offsetX * sizeX, defaultCollider.offsetY * sizeY, defaultCollider.offsetZ * sizeZ);

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
      } else if (tipo === 'video_plane') {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = new Color3(0, 0, 0);
        mat.disableLighting = true;

        if (asset && asset.path) {
          const videoUrl = 'http://localhost:4000' + asset.path;
          const videoTexture = new VideoTexture(
            'vidTex_' + nombre,
            videoUrl,
            scene,
            false,
            true,
            undefined,
            { autoPlay: false }
          );
          mat.diffuseTexture = videoTexture;
        } else {
          mat.diffuseColor = new Color3(0.1, 0.1, 0.1);
        }

        mesh.material = mat;
      } else if (tipo === 'image_plane') {
        const mat = new StandardMaterial('decalMat_' + nombre, scene);
        const colorC3 = Color3.FromHexString(colorHex);

        const imageUrl = asset && asset.path ? 'http://localhost:4000' + asset.path : '';
        const tex = imageUrl ? new Texture(imageUrl, scene) : undefined;

        this.configurarMaterialImagenPlano(mat, colorHex, false, false, tex);

        if (!asset || !asset.path) {
          mat.alpha = 0.5;
        }

        mesh.material = mat;
        mesh.metadata.decalMaterial = mat;
        mesh.metadata.esEmisivo = false;

        mesh.metadata.updateDecal = () => {
          const pNode = mesh.parent as Mesh;
          if (!pNode || !pNode.geometry || pNode.name === '__root__' || pNode.metadata?.type === 'trigger') return;

          if (mesh.metadata.decalMesh) {
            mesh.metadata.decalMesh.dispose();
            mesh.metadata.decalMesh = null;
          }

          try {
            mesh.computeWorldMatrix(true);
            const absScale = new Vector3();
            const absRot = new Quaternion();
            const absPos = new Vector3();
            mesh.getWorldMatrix().decompose(absScale, absRot, absPos);

            const normal = mesh.forward.scale(-1).normalize();
            const depthMeters = mesh.metadata.profundidadProyeccion ?? 10;

            const decalSize = new Vector3(absScale.x, absScale.y, depthMeters);
            const rotationRadians = (mesh.metadata.anguloProyeccion ?? 0) * (Math.PI / 180);

            const decal = MeshBuilder.CreateDecal('decal_' + mesh.name, pNode, {
              position: absPos,
              normal: normal,
              size: decalSize,
              angle: rotationRadians
            });

            decal.material = mesh.metadata.decalMaterial;
            decal.setParent(pNode);
            decal.isPickable = false;
            decal.receiveShadows = false;
            decal.applyFog = !mesh.metadata.ignoraNiebla;
            mesh.metadata.decalMesh = decal;
          } catch (e) {
            console.warn('Error creando Decal:', e);
          }
        };

        mesh.onDisposeObservable.add(() => {
          if (mesh.metadata.decalMesh) mesh.metadata.decalMesh.dispose();
          if (mesh.metadata.decalMaterial) mesh.metadata.decalMaterial.dispose();
        });

        setTimeout(() => {
          if (mesh.metadata.updateDecal) mesh.metadata.updateDecal();
        }, 150);
      } else {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        const isBW = scene.metadata?.globalVisualMode === 'bw';
        const activeColor = isBW ? mesh.metadata.colorBW : colorHex;
        const c3 = Color3.FromHexString(activeColor);

        mat.diffuseColor = c3;
        mat.specularColor = new Color3(0, 0, 0);

        if (rol === 'spawn_point') {
          mat.alpha = 0.5;
          mat.emissiveColor = new Color3(0, 1, 0);
        }

        if (mesh.metadata.esEmisivo) {
          mat.emissiveColor = c3.scale(0.12);
          mat.disableLighting = false;
        } else {
          mat.emissiveColor = new Color3(0, 0, 0);
          mat.disableLighting = false;
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