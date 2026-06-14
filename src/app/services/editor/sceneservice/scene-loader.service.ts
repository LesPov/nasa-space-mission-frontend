import { Injectable, inject } from '@angular/core';
import {
  AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PointLight,
  Quaternion,
  Scene,
  SceneLoader,
  SpotLight,
  StandardMaterial,
  TransformNode,
  Vector3,
  VideoTexture,
  FresnelParameters,
  Texture,
  Ray,
  Engine,
  BaseTexture
} from '@babylonjs/core';

import '@babylonjs/loaders';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { SceneUtilsService } from './scene-utils.service';
import { SceneMaterialService } from './scene-material.service';
import { SceneShadowsService } from './scene-shadows.service';
import { SceneNodesService } from './scene-nodes.service';
import { SceneEnvironmentService } from './scene-environment.service';
import { cloneDefaultPlayerConfig } from '../player-config.model';

@Injectable({ providedIn: 'root' })
export class SceneLoaderService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private utilsSvc = inject(SceneUtilsService);
  private materialSvc = inject(SceneMaterialService);
  private shadowsSvc = inject(SceneShadowsService);
  private nodesSvc = inject(SceneNodesService);
  private envSvc = inject(SceneEnvironmentService);

  private clampNum(v: number, min: number, max: number, fallback = min): number {
    if (Number.isNaN(v) || v === null || v === undefined) return fallback;
    return Math.max(min, Math.min(max, Number(v)));
  }

  // =======================================================
  // CARGA DE PROYECTOR CON MULTIPLICADOR DE BRILLO REAL Y FIX PARPADEO
  // =======================================================
  private configurarMaterialProyector(
    mat: StandardMaterial,
    colorHex: string,
    brilloIntensidad: number,
    ignoraNiebla: boolean,
    texture?: Texture | BaseTexture | null
  ): void {
    const colorSeguro = colorHex || '#ffffff';
    const c3 = Color3.FromHexString(colorSeguro);
    const brillo = this.clampNum(Number(brilloIntensidad), 0, 10, 1.0);

    mat.disableLighting = true;
    mat.diffuseColor = c3;
    mat.ambientColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.alphaMode = Engine.ALPHA_COMBINE;
    mat.fogEnabled = !ignoraNiebla;
    
    // 🔥 FIX PARPADEO
    mat.zOffset = -10;

    if (texture) {
      texture.hasAlpha = true;
      texture.gammaSpace = true;

      mat.diffuseTexture = texture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.opacityTexture = texture;

      mat.emissiveTexture = null as any;
      mat.emissiveColor = c3.scale(brillo);
      mat.alpha = 1.0;
    } else {
      mat.diffuseTexture = null as any;
      mat.opacityTexture = null as any;
      mat.emissiveTexture = null as any;
      mat.useAlphaFromDiffuseTexture = false;

      mat.emissiveColor = c3.scale(brillo);
      mat.alpha = Math.max(0.2, Math.min(1.0, brillo * 0.5));
    }
  }

  private limpiarDecalsImagen(mesh: Mesh): void {
    const meta: any = mesh.metadata || {};
    if (Array.isArray(meta.decalMeshes)) {
      meta.decalMeshes.forEach((d: Mesh | null) => {
        if (d && !d.isDisposed()) d.dispose();
      });
    }
    if (meta.decalMesh && !meta.decalMesh.isDisposed()) {
      meta.decalMesh.dispose();
    }
    meta.decalMeshes = [];
    meta.decalMesh = null;
    mesh.metadata = meta;
  }

  public cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
    return new Promise((resolve) => {
      if (!dataBD) {
        resolve();
        return;
      }

      const scene = this.motor3d.scene;

      let w: any = null;
      if (dataBD.worldSettings) {
        if (typeof dataBD.worldSettings === 'string') {
          try {
            w = JSON.parse(dataBD.worldSettings);
          } catch (e) {
            console.error('Error al parsear worldSettings desde BD', e);
          }
        } else {
          w = dataBD.worldSettings;
        }
      }

      if (w) {
        const clearHex = w.clearColor?.length >= 7 ? w.clearColor.substring(0, 7) : '#0d1729';
        const clearHexBW = w.clearColorBW?.length >= 7 ? w.clearColorBW.substring(0, 7) : '#555555';

        this.envSvc.configurarAmbienteGlobal(scene, w);
        const loadedMode = w.visualMode === 'bw' ? 'bw' : 'normal';
        const activeClear = loadedMode === 'bw' ? clearHexBW : clearHex;
        scene.clearColor = Color4.FromHexString(activeClear + 'ff');

        scene.metadata = {
          ...scene.metadata,
          globalClearColor: clearHex,
          globalClearColorBW: clearHexBW,
          globalVisualMode: loadedMode
        };

        this.motor3d.setVisualMode(loadedMode);
        scene.gravity = new Vector3(0, w.gravityY ?? -0.25, 0);
      } else {
        const clearHex = '#0d1729';
        const clearHexBW = '#555555';
        this.envSvc.configurarAmbienteGlobal(scene, {
          ambientIntensity: 0.6,
          ambientDiffuse: '#ffffff',
          ambientGround: '#333333',
          ambientDirX: 0,
          ambientDirY: 1,
          ambientDirZ: 0
        });
        scene.clearColor = Color4.FromHexString(clearHex + 'ff');

        scene.metadata = {
          ...scene.metadata,
          globalClearColor: clearHex,
          globalClearColorBW: clearHexBW,
          globalVisualMode: 'normal'
        };

        this.motor3d.setVisualMode('normal');
      }

      scene.cameras.forEach(cam => cam.maxZ = 10000);

      const objetosBD = Array.isArray(dataBD) ? dataBD : (dataBD.sceneObjects || []);
      const triggersBD = Array.isArray(dataBD) ? [] : (dataBD.triggers || []);
      const isAdmin = this.state.rolSimulado() === 'admin';

      const promesasCarga: any[] = [];
      const mallasCreadas = new Map<string, Mesh>();

      objetosBD.forEach((obj: any) => {
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');
        const isVideo = obj.type === 'video_plane';
        const isImage = obj.type === 'image_plane';

        const defaultCollider = isModel
          ? { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
          : { type: obj.type === 'sphere' || obj.type === 'bubble' ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };

        const defaultCamOffset = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.8, z: 0 };
        const defaultPlayerConfig = cloneDefaultPlayerConfig();

        const rolSaved = obj.properties?.rol || 'prop';
        const isSolidSaved = obj.properties?.isSolid ?? true;
        const isSelectableSaved = obj.properties?.isSelectable ?? true;
        const mensajeSaved = obj.properties?.mensaje || '';
        const isIgnoraNieblaSaved = obj.properties?.ignoraNiebla ?? false;
        const isEmisivoSaved = obj.properties?.esEmisivo ?? false;
        
        // 🔥 AHORA CARGA CON 1.0 POR DEFECTO
        const savedBrilloIntensidad = this.utilsSvc.normalizarNumero(obj.properties?.brilloIntensidad, 1.0);

        const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);

        // EXTRAEMOS LOS COLORES A NIVEL DE OBJETO
        const savedColorHex = obj.properties?.color?.substring(0, 7) || '#888888';
        const savedColorBW = obj.properties?.colorBW?.substring(0, 7) || savedColorHex;

        if (isLight) {
          const lightColorHex = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';

          if (obj.assetId) {
            const path = obj.properties?.path || obj.asset?.path;
            if (!path) return;

            const fullPath = 'http://localhost:4000' + path;
            const lastSlash = fullPath.lastIndexOf('/');

            const p = SceneLoader.ImportMeshAsync(
              '',
              fullPath.substring(0, lastSlash + 1),
              fullPath.substring(lastSlash + 1),
              scene
            ).then((result) => {
              const rootNode = result.meshes[0] as Mesh;
              rootNode.name = obj.name;
              rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
              rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
              rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
              rootNode.checkCollisions = false;
              rootNode.isPickable = true;

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
                if (mesh.material) {
                  mesh.material.fogEnabled = !isIgnoraNieblaSaved;
                }
                mesh.getChildMeshes().forEach(c => setFog(c));
              };
              setFog(rootNode);

              const anims = result.animationGroups || [];
              anims.forEach(ag => ag.stop());

              let initialHeadLocal: Vector3 | null = null;
              const headNode = rootNode.getChildTransformNodes(false).find(
                n => n.name.toLowerCase() === 'head' ||
                  n.name.toLowerCase() === 'neck' ||
                  n.name.toLowerCase().includes('head')
              ) as TransformNode;
              if (headNode) {
                headNode.computeWorldMatrix(true);
                rootNode.computeWorldMatrix(true);
                initialHeadLocal = Vector3.TransformCoordinates(
                  headNode.getAbsolutePosition(),
                  Matrix.Invert(rootNode.getWorldMatrix())
                );
              }

              const playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(
                obj.properties?.playerConfig || null,
                savedSelectionRange
              );

              rootNode.metadata = {
                uid: obj.uid || window.crypto.randomUUID(),
                type: obj.type,
                rol: 'light',
                assetId: obj.assetId,
                path,
                isSolid: isSolidSaved,
                isSelectable: isSelectableSaved,
                mensaje: mensajeSaved,
                ignoraNiebla: isIgnoraNieblaSaved,
                parentId: obj.parentId || null,
                lightColor: lightColorHex,
                intensity: obj.properties?.intensity ?? 1.0,
                range: obj.properties?.range ?? 50,
                angle: obj.properties?.angle ?? 60,
                attachedNodePath: obj.properties?.attachedNodePath || '',
                attachedNodeName: obj.properties?.attachedNodeName || '',
                animationNames: anims.map(a => a.name),
                collider: obj.properties?.collider || defaultCollider,
                camOffset: obj.properties?.camOffset || defaultCamOffset,
                playerConfig,
                selectionRange: { ...playerConfig.selectionRange },
                initialHeadLocal
              };

              mallasCreadas.set(rootNode.metadata.uid, rootNode);

              let lightObj: any;
              if (obj.type === 'light_point') {
                lightObj = new PointLight('l_' + obj.name, new Vector3(0, 2.5, 0), scene);
              } else if (obj.type === 'light_spot') {
                lightObj = new SpotLight(
                  'l_' + obj.name,
                  new Vector3(0, 2.5, 0),
                  new Vector3(0, -1, 0),
                  (obj.properties?.angle ?? 60) * (Math.PI / 180),
                  2,
                  scene
                );
              } else if (obj.type === 'light_directional') {
                lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);
              }

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
            });

            promesasCarga.push(p);
            return;
          } else {
            const mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 0.4 }, scene);
            mesh.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
            mesh.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
            mesh.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);

            const mat = new StandardMaterial('mat_' + obj.name, scene);
            mat.emissiveColor = Color3.FromHexString(lightColorHex);
            mat.wireframe = true;
            mat.maxSimultaneousLights = 16;
            mat.fogEnabled = !isIgnoraNieblaSaved;
            mesh.material = mat;

            let lightObj: any;
            if (obj.type === 'light_point') {
              lightObj = new PointLight('l_' + obj.name, new Vector3(0, 2.5, 0), scene);
            } else if (obj.type === 'light_spot') {
              lightObj = new SpotLight(
                'l_' + obj.name,
                new Vector3(0, 2.5, 0),
                new Vector3(0, -1, 0),
                (obj.properties?.angle ?? 60) * (Math.PI / 180),
                2,
                scene
              );
            } else if (obj.type === 'light_directional') {
              lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);
            }

            lightObj.parent = mesh;
            lightObj.intensity = obj.properties?.intensity ?? 1.0;
            lightObj.diffuse = Color3.FromHexString(lightColorHex);
            lightObj.specular = new Color3(0, 0, 0);
            if (lightObj.range !== undefined) lightObj.range = obj.properties?.range ?? 50;

            const playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(
              obj.properties?.playerConfig || null,
              savedSelectionRange
            );

            mesh.metadata = {
              uid: obj.uid || window.crypto.randomUUID(),
              type: obj.type,
              rol: 'light',
              isSolid: false,
              isSelectable: true,
              ignoraNiebla: isIgnoraNieblaSaved,
              lightColor: lightColorHex,
              intensity: obj.properties?.intensity ?? 1.0,
              range: obj.properties?.range ?? 50,
              angle: obj.properties?.angle ?? 60,
              attachedNodePath: '',
              attachedNodeName: '',
              playerConfig,
              selectionRange: { ...playerConfig.selectionRange },
              parentId: obj.parentId || null
            };

            mallasCreadas.set(mesh.metadata.uid, mesh);

            mesh.isPickable = true;
            mesh.checkCollisions = false;
            mesh.isVisible = isAdmin;
            return;
          }
        }

        const interactDistanceFPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0);
        const interactDistanceTPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0);
        const interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
        const interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';

        const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
        if (savedCollider.radiusX !== undefined) {
          savedCollider.sizeX = savedCollider.radiusX;
          savedCollider.sizeY = savedCollider.heightY;
          savedCollider.sizeZ = savedCollider.radiusZ;
          savedCollider.type = isModel ? 'capsule' : 'box';
        }
        if (!savedCollider.type) savedCollider.type = isModel ? 'capsule' : 'box';

        const savedCamOffset = obj.properties?.camOffset || { ...defaultCamOffset };
        const savedPlayerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(
          obj.properties?.playerConfig || null,
          savedSelectionRange
        );

        if (isModel && obj.assetId) {
          const path = obj.properties?.path || obj.asset?.path;
          if (!path) return;

          const fullPath = 'http://localhost:4000' + path;
          const lastSlash = fullPath.lastIndexOf('/');

          const p = SceneLoader.ImportMeshAsync(
            '',
            fullPath.substring(0, lastSlash + 1),
            fullPath.substring(lastSlash + 1),
            scene
          ).then((result) => {
            const rootNode = result.meshes[0] as Mesh;
            rootNode.name = obj.name;
            rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
            rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
            rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            rootNode.checkCollisions = false;
            rootNode.isPickable = true;

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
              if (mesh.material) {
                mesh.material.fogEnabled = !isIgnoraNieblaSaved;
              }
              mesh.getChildMeshes().forEach(c => setFog(c));
            };
            setFog(rootNode);

            const anims = result.animationGroups || [];
            anims.forEach(ag => ag.stop());

            let initialHeadLocal: Vector3 | null = null;
            const headNode = rootNode.getChildTransformNodes(false).find(
              n => n.name.toLowerCase() === 'head' ||
                n.name.toLowerCase() === 'neck' ||
                n.name.toLowerCase().includes('head')
            ) as TransformNode;
            if (headNode) {
              headNode.computeWorldMatrix(true);
              rootNode.computeWorldMatrix(true);
              initialHeadLocal = Vector3.TransformCoordinates(
                headNode.getAbsolutePosition(),
                Matrix.Invert(rootNode.getWorldMatrix())
              );
            }

            rootNode.metadata = {
              uid: obj.uid || window.crypto.randomUUID(),
              type: 'model',
              rol: rolSaved,
              assetId: obj.assetId,
              path,
              isSolid: isSolidSaved,
              isSelectable: isSelectableSaved,
              mensaje: mensajeSaved,
              ignoraNiebla: isIgnoraNieblaSaved,
              esEmisivo: isEmisivoSaved,
              brilloIntensidad: savedBrilloIntensidad,
              interactDistanceFPS,
              interactDistanceTPS,
              interactSequenceIdFPS,
              interactSequenceIdTPS,
              animationNames: anims.map(a => a.name),
              collider: savedCollider,
              camOffset: savedCamOffset,
              playerConfig: savedPlayerConfig,
              selectionRange: { ...savedPlayerConfig.selectionRange },
              initialHeadLocal,
              parentId: obj.parentId || null
            };

            mallasCreadas.set(rootNode.metadata.uid, rootNode);

            rootNode.ellipsoid = new Vector3(
              savedCollider.sizeX * obj.scale.x,
              savedCollider.sizeY * obj.scale.y,
              savedCollider.sizeZ * obj.scale.z
            );
            rootNode.ellipsoidOffset = new Vector3(
              savedCollider.offsetX * obj.scale.x,
              savedCollider.offsetY * obj.scale.y,
              savedCollider.offsetZ * obj.scale.z
            );
          });

          promesasCarga.push(p);
        } else {
          let mesh!: Mesh;

          switch (obj.type) {
            case 'cube':
              mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
              break;
            case 'sphere':
              mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene);
              break;
            case 'cylinder':
              mesh = MeshBuilder.CreateCylinder(obj.name, { height: 1, diameter: 1 }, scene);
              break;
            case 'plane':
              mesh = MeshBuilder.CreateGround(obj.name, { width: 1, height: 1 }, scene);
              break;
            case 'bubble':
              mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene);
              break;
            case 'video_plane':
              mesh = MeshBuilder.CreatePlane(obj.name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
              break;
            case 'image_plane':
              mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene);
              {
                const projMat = new StandardMaterial('projMat_' + obj.name, scene);
                projMat.emissiveColor = new Color3(1, 1, 0);
                projMat.alpha = 0.4;
                projMat.wireframe = true; 
                projMat.disableLighting = true;
                mesh.material = projMat;
                mesh.isVisible = isAdmin;
              }
              break;
            default:
              return;
          }

          mesh.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);

          mesh.metadata = {
            uid: obj.uid || window.crypto.randomUUID(),
            type: obj.type,
            rol: rolSaved,
            color: savedColorHex,
            colorBW: savedColorBW,
            isSolid: isSolidSaved,
            isSelectable: isSelectableSaved,
            mensaje: mensajeSaved,
            ignoraNiebla: isIgnoraNieblaSaved,
            esEmisivo: isEmisivoSaved,
            brilloIntensidad: savedBrilloIntensidad,
            respawnTime: obj.properties?.respawnTime ?? 8,

            profundidadProyeccion: obj.properties?.profundidadProyeccion ?? 10,
            anguloProyeccion: obj.properties?.anguloProyeccion ?? 0,
            proyeccionAncho: obj.properties?.proyeccionAncho ?? 2,
            proyeccionAlto: obj.properties?.proyeccionAlto ?? 2,

            proyeccionRepeticiones: obj.properties?.proyeccionRepeticiones ?? 1,
            proyeccionEspaciado: obj.properties?.proyeccionEspaciado ?? 2,
            proyeccionEje: obj.properties?.proyeccionEje || 'Y',

            interactDistanceFPS,
            interactDistanceTPS,
            interactSequenceIdFPS,
            interactSequenceIdTPS,
            collider: savedCollider,
            camOffset: savedCamOffset,
            playerConfig: savedPlayerConfig,
            selectionRange: { ...savedPlayerConfig.selectionRange },
            parentId: obj.parentId || null
          };

          mallasCreadas.set(mesh.metadata.uid, mesh);

          if (isVideo) {
            mesh.metadata.assetId = obj.assetId;
            mesh.metadata.videoUrl = obj.properties?.videoUrl || obj.properties?.path || '';
          }

          if (isImage) {
            mesh.metadata.assetId = obj.assetId;
            mesh.metadata.imageUrl = obj.properties?.imageUrl || obj.properties?.path || '';
          }

          mesh.isPickable = true;
          mesh.checkCollisions = isSolidSaved;
          mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
          mesh.applyFog = !isIgnoraNieblaSaved;

          if (obj.type === 'image_plane') {
            mesh.alwaysSelectAsActiveMesh = true;
          }

          if (obj.type !== 'bubble' && obj.type !== 'video_plane' && obj.type !== 'image_plane') {
            mesh.receiveShadows = true;
          }

          mesh.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
          mesh.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);

          if (obj.type === 'bubble') {
            const mat = new StandardMaterial('mat_' + obj.name, scene);
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
          } else if (obj.type === 'video_plane') {
            const mat = new StandardMaterial('mat_' + obj.name, scene);
            mat.emissiveColor = new Color3(0, 0, 0);
            mat.disableLighting = true;

            if (mesh.metadata.videoUrl) {
              const videoUrl = 'http://localhost:4000' + mesh.metadata.videoUrl;
              const videoTexture = new VideoTexture(
                'vidTex_' + obj.name,
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
          } else if (obj.type === 'image_plane') {
            const mat = new StandardMaterial('decalMat_' + obj.name, scene);
            const isBW = scene.metadata?.globalVisualMode === 'bw';
            const activeColorAUsar = isBW ? savedColorBW : savedColorHex;

            // Obtener la URL de la imagen desde metadata o desde las propiedades del objeto
            const imagePath = mesh.metadata?.imageUrl || obj.properties?.imageUrl || obj.properties?.path || '';
            const imageUrl = imagePath ? 'http://localhost:4000' + imagePath : '';
            const tex = imageUrl ? new Texture(imageUrl, scene) : undefined;

            this.configurarMaterialProyector(mat, activeColorAUsar, savedBrilloIntensidad, isIgnoraNieblaSaved, tex);

            mesh.metadata.decalMaterial = mat;
            mesh.metadata.brilloIntensidad = savedBrilloIntensidad;
            
            // 🔥 RECUPERA EL VALOR GUARDADO EN LA BASE DE DATOS
            mesh.metadata.fadeDistance = this.utilsSvc.normalizarNumero(obj.properties?.fadeDistance, 0);

            // 🔥 NUEVO VIGILANTE: ATADO A LA ESCENA PARA QUE NUNCA SE DETENGA
            const fadeObserver = scene.onBeforeRenderObservable.add(() => {
              
              // 1. Lógica de Blanco y Negro (B&W)
              const currentModeIsBW = scene.metadata?.globalVisualMode === 'bw';
              if (mesh.metadata._lastVisualMode !== currentModeIsBW) {
                  mesh.metadata._lastVisualMode = currentModeIsBW;
                  if (mesh.metadata.updateDecal) mesh.metadata.updateDecal();
              }

              // 2. Lógica de Desvanecimiento por Distancia (Fade-Out)
              const fadeDist = Number(mesh.metadata.fadeDistance ?? 0);
              
              // 🔥 Si fadeDist es 0, ignoramos completamente la lógica y forzamos Alpha 1
              if (fadeDist > 0 && scene.activeCamera) {
                  const distanceToCam = Vector3.Distance(scene.activeCamera.globalPosition, mesh.getAbsolutePosition());
                  
                  // Empieza a desvanecerse al 70% de la distancia total establecida
                  const fadeStart = fadeDist * 0.7;
                  
                  let opacity = 1.0;
                  if (distanceToCam > fadeDist) {
                      opacity = 0;
                  } else if (distanceToCam > fadeStart) {
                      const progress = (distanceToCam - fadeStart) / (fadeDist - fadeStart);
                      opacity = 1.0 - progress;
                  }

                  // Aplicar a los decals directamente usando .visibility
                  if (mesh.metadata.decalMeshes && Array.isArray(mesh.metadata.decalMeshes)) {
                      mesh.metadata.decalMeshes.forEach((decal: Mesh) => {
                          if (decal) {
                              decal.visibility = opacity;
                              decal.alwaysSelectAsActiveMesh = true; // Asegura render a la distancia
                          }
                      });
                  }
              } else {
                   // Si fadeDist es 0, forzamos la visibilidad total
                   if (mesh.metadata.decalMeshes && Array.isArray(mesh.metadata.decalMeshes)) {
                      mesh.metadata.decalMeshes.forEach((decal: Mesh) => {
                          if (decal) {
                              decal.visibility = 1.0;
                              decal.alwaysSelectAsActiveMesh = true;
                          }
                      });
                  }
              }
            });

            mesh.metadata.updateDecal = () => {
              this.limpiarDecalsImagen(mesh);

              try {
                // 🔥 LEEMOS EL COLOR CORRECTO EN TIEMPO REAL
                const isNowBW = scene.metadata?.globalVisualMode === 'bw';
                const colorReal = isNowBW ? mesh.metadata.colorBW : mesh.metadata.color;
                const decalTexture = (mesh.metadata.decalMaterial as StandardMaterial).diffuseTexture;
                this.configurarMaterialProyector(
                  mesh.metadata.decalMaterial,
                  colorReal,
                  mesh.metadata.brilloIntensidad,
                  mesh.metadata.ignoraNiebla,
                  decalTexture instanceof Texture ? decalTexture : undefined
                );

                mesh.computeWorldMatrix(true);
                const origin = mesh.getAbsolutePosition();
                const direction = mesh.forward;

                const ray = new Ray(origin, direction, 500);

                const hit = scene.pickWithRay(ray, (m) => {
                  if (!m.isPickable || !m.isVisible) return false;
                  if (m === mesh) return false;

                  const n = m.name.toLowerCase();
                  if (n.includes('trigger') || m.metadata?.type === 'trigger') return false;
                  if (n.includes('proxycol') || n.includes('gizmo') || n.includes('debug')) return false;
                  if (m.metadata?.type === 'image_plane' || m.metadata?.type === 'bubble') return false;
                  if (['ejex', 'ejey', 'ejez', 'gridhelper', 'sueloinvisible'].includes(n)) return false;

                  return true;
                });

                if (hit && hit.hit && hit.pickedMesh && hit.pickedPoint) {
                  const targetMesh = hit.pickedMesh as Mesh;

                  const ancho = this.clampNum(Number(mesh.metadata.proyeccionAncho ?? 2), 0.05, 9999);
                  const alto = this.clampNum(Number(mesh.metadata.proyeccionAlto ?? 2), 0.05, 9999);
                  const prof = this.clampNum(Number(mesh.metadata.profundidadProyeccion ?? 10), 0.01, 9999);

                  let angulo = Number(mesh.metadata.anguloProyeccion ?? 0) * (Math.PI / 180);
                  if (mesh.rotationQuaternion) {
                    angulo += mesh.rotationQuaternion.toEulerAngles().z;
                  } else {
                    angulo += mesh.rotation.z;
                  }

                  const normal = direction.scale(-1).normalize();
                  const decalSize = new Vector3(ancho, alto, prof);

                  const repeticiones = Math.floor(this.clampNum(Number(mesh.metadata.proyeccionRepeticiones ?? 1), 1, 50));
                  const espaciado = Number(mesh.metadata.proyeccionEspaciado ?? 2);
                  const ejeRepeticion = mesh.metadata.proyeccionEje === 'X' ? mesh.right : mesh.up;

                  const totalDist = (repeticiones - 1) * espaciado;
                  const centerDecalPos = hit.pickedPoint.add(direction.scale(prof * 0.5));
                  const startPos = centerDecalPos.subtract(ejeRepeticion.scale(totalDist * 0.5));

                  mesh.metadata.decalMeshes = [];

                  for (let i = 0; i < repeticiones; i++) {
                    const currentDecalPos = startPos.add(ejeRepeticion.scale(i * espaciado));

                    const decal = MeshBuilder.CreateDecal('decal_' + mesh.name + '_' + i, targetMesh, {
                      position: currentDecalPos,
                      normal: normal,
                      size: decalSize,
                      angle: angulo
                    });

                    decal.material = mesh.metadata.decalMaterial;
                    decal.setParent(targetMesh);
                    decal.isPickable = false;
                    decal.receiveShadows = false;
                    decal.applyFog = !mesh.metadata.ignoraNiebla;

                    // 🔥 FIX CORTE DE CÁMARA (EVITA DESAPARECER POR PARTES)
                    decal.alwaysSelectAsActiveMesh = true;

                    mesh.metadata.decalMeshes.push(decal);
                  }
                }
              } catch (e) {
                console.warn('Error proyectando imagen con raycast:', e);
              }
            };

            mesh.onDisposeObservable.add(() => {
              scene.onBeforeRenderObservable.remove(fadeObserver);
              this.limpiarDecalsImagen(mesh);
              if (mesh.metadata.decalMaterial && !mesh.metadata.decalMaterial.isDisposed()) {
                mesh.metadata.decalMaterial.dispose();
              }
            });

            setTimeout(() => {
              if (mesh.metadata.updateDecal) mesh.metadata.updateDecal();
            }, 150);
          } else {
            const mat = new StandardMaterial('mat_' + mesh.name, scene);
            const isBW = scene.metadata?.globalVisualMode === 'bw';
            const activeHexToApply = isBW ? savedColorBW : savedColorHex;
            const c3 = Color3.FromHexString(activeHexToApply);

            mat.diffuseColor = c3;
            mat.specularColor = new Color3(0, 0, 0);

            if (rolSaved === 'spawn_point') {
              mat.alpha = 0.5;
              mat.emissiveColor = new Color3(0, 1, 0);
            }

            if (isEmisivoSaved) {
              mat.emissiveColor = c3.scale(savedBrilloIntensidad);
              mat.disableLighting = false;
            } else {
              mat.emissiveColor = new Color3(0, 0, 0);
              mat.disableLighting = false;
            }

            mat.maxSimultaneousLights = 16;
            mesh.material = mat;
          }

          if (mesh.material) {
            mesh.material.fogEnabled = !isIgnoraNieblaSaved;
          }

          this.shadowsSvc.asignarObjetosASombrasDeLuces();
        }
      });

      triggersBD.forEach((trigger: any) => {
        let mesh = scene.getMeshByName(trigger.name) as Mesh;
        const shape = trigger.actionProperties?.triggerShape || 'cube';
        const isComposite = trigger.actionProperties?.isComposite ?? false;

        if (!mesh) {
          switch (shape) {
            case 'sphere':
              mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene);
              break;
            case 'cylinder':
              mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene);
              break;
            default:
              mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene);
              break;
          }

          mesh.position = new Vector3(trigger.position.x, trigger.position.y, trigger.position.z);
          mesh.scaling = new Vector3(trigger.size.x, trigger.size.y, trigger.size.z);

          const mat = new StandardMaterial('mat_trigger_' + trigger.name, scene);
          mat.diffuseColor = new Color3(0.2, 1, 0.2);
          mat.alpha = 0.3;
          mat.wireframe = true;
          mat.maxSimultaneousLights = 16;
          mesh.material = mat;
          mesh.isPickable = true;
          mesh.checkCollisions = false;
          mesh.isVisible = isAdmin;

          mesh.metadata = {
            uid: trigger.uid || window.crypto.randomUUID(),
            type: 'trigger',
            triggerShape: shape,
            isComposite: isComposite,
            parentId: trigger.parentId || null,
            conditions: [],
            mensajeEntrada: '',
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
            mensaje: '',
            soundUrl: '',
            interactSequenceId: '',
            timeNorm: 4.5,
            videoNorm: '',
            isRepeatable: trigger.isRepeatable,
            isEnabled: trigger.isEnabled,
            hasTriggeredEnter: false,
            hasTriggeredExit: false
          };

          mallasCreadas.set(mesh.metadata.uid, mesh);
        }

        if (isComposite) {
          if (trigger.condition && !mesh.metadata.conditions.includes(trigger.condition)) {
            mesh.metadata.conditions.push(trigger.condition);
          }
          if (trigger.condition === 'on_enter') {
            mesh.metadata.mensajeEntrada = trigger.actionProperties?.mensaje || '';
            mesh.metadata.soundUrlEntrada = trigger.actionProperties?.soundUrl || '';
            mesh.metadata.seqEntrada = trigger.actionProperties?.seqEntrada || '';
            mesh.metadata.timeEntrada = trigger.actionProperties?.timeEntrada ?? 4.5;
            mesh.metadata.videoEntrada = trigger.actionProperties?.videoEntrada || '';
          } else if (trigger.condition === 'on_exit') {
            mesh.metadata.mensajeSalida = trigger.actionProperties?.mensaje || '';
            mesh.metadata.soundUrlSalida = trigger.actionProperties?.soundUrl || '';
            mesh.metadata.seqSalida = trigger.actionProperties?.seqSalida || '';
            mesh.metadata.timeSalida = trigger.actionProperties?.timeSalida ?? 4.5;
            mesh.metadata.videoSalida = trigger.actionProperties?.videoSalida || '';
          }
        } else {
          mesh.metadata.condition = trigger.condition || 'on_enter';
          mesh.metadata.mensaje = trigger.actionProperties?.mensaje || '';
          mesh.metadata.soundUrl = trigger.actionProperties?.soundUrl || '';
          mesh.metadata.interactSequenceId = trigger.actionProperties?.interactSequenceId || '';
          mesh.metadata.timeNorm = trigger.actionProperties?.timeNorm ?? 4.5;
          mesh.metadata.videoNorm = trigger.actionProperties?.videoNorm || '';
        }
      });

      Promise.all(promesasCarga).then(() => {
        mallasCreadas.forEach((mesh) => {
          if (mesh.metadata?.parentId) {
            const parentNode = mallasCreadas.get(mesh.metadata.parentId) || scene.getMeshByName(mesh.metadata.parentId);
            if (parentNode) {
              mesh.parent = parentNode;
            }
          }
        });

        setTimeout(() => {
          mallasCreadas.forEach((mesh) => {
            if (mesh.metadata?.type === 'image_plane' && mesh.metadata.updateDecal) {
              mesh.metadata.updateDecal();
            }
          });
        }, 150);

        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        this.nodesSvc.actualizarListaNodos();
        resolve();
      });
    });
  }
}