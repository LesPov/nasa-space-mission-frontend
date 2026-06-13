import { Injectable, inject } from '@angular/core';
import { 
  AbstractMesh, Color3, Color4, DirectionalLight, Matrix, Mesh, 
  MeshBuilder, PointLight, Quaternion, Scene, SceneLoader, SpotLight, 
  StandardMaterial, TransformNode, Vector3, VideoTexture, FresnelParameters 
} from '@babylonjs/core';

// 🔥 FIX CRÍTICO 1: Importación global obligatoria para que Babylon 
// pueda decodificar JSON de modelos .glb, .gltf y .obj sin crashear.
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
          try { w = JSON.parse(dataBD.worldSettings); } catch (e) { console.error("Error al parsear worldSettings desde BD", e); }
        } else { w = dataBD.worldSettings; }
      }

      if (w) {
        const clearHex = w.clearColor?.length >= 7 ? w.clearColor.substring(0, 7) : '#0d1729';
        const clearHexBW = w.clearColorBW?.length >= 7 ? w.clearColorBW.substring(0, 7) : '#555555';

        this.envSvc.configurarAmbienteGlobal(scene, w);
        const loadedMode = w.visualMode === 'bw' ? 'bw' : 'normal';
        const activeClear = loadedMode === 'bw' ? clearHexBW : clearHex;
        scene.clearColor = Color4.FromHexString(activeClear + 'ff');
        
        scene.metadata = { 
            ...scene.metadata, globalClearColor: clearHex, globalClearColorBW: clearHexBW, globalVisualMode: loadedMode 
        };
        this.motor3d.setVisualMode(loadedMode);
        scene.gravity = new Vector3(0, w.gravityY ?? -0.25, 0);
      } else {
        const clearHex = '#0d1729';
        const clearHexBW = '#555555';
        this.envSvc.configurarAmbienteGlobal(scene, { ambientIntensity: 0.6, ambientDiffuse: '#ffffff', ambientGround: '#333333', ambientDirX: 0, ambientDirY: 1, ambientDirZ: 0 });
        scene.clearColor = Color4.FromHexString(clearHex + 'ff');
        
        scene.metadata = { 
            ...scene.metadata, globalClearColor: clearHex, globalClearColorBW: clearHexBW, globalVisualMode: 'normal' 
        };
        this.motor3d.setVisualMode('normal');
      }

      scene.fogMode = Scene.FOGMODE_NONE;
      scene.cameras.forEach(cam => cam.maxZ = 10000);

      const objetosBD = Array.isArray(dataBD) ? dataBD : (dataBD.sceneObjects || []);
      const triggersBD = Array.isArray(dataBD) ? [] : (dataBD.triggers || []);
      const isAdmin = this.state.rolSimulado() === 'admin';

      const promesasCarga: any[] = [];

      objetosBD.forEach((obj: any) => {
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');
        const isVideo = obj.type === 'video_plane';

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

        const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);

        if (isLight) {
          const lightColorHex = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';

          if (obj.assetId) {
            const path = obj.properties?.path || obj.asset?.path;
            if (!path) return;
            const fullPath = 'http://localhost:4000' + path;
            const lastSlash = fullPath.lastIndexOf('/');
            const p = SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
              const rootNode = result.meshes[0] as Mesh;
              rootNode.name = obj.name; rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
              rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
              rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
              rootNode.checkCollisions = false; rootNode.isPickable = true;
              rootNode.applyFog = !isIgnoraNieblaSaved;

              result.meshes.forEach(m => {
                if (m !== rootNode) {
                  m.isPickable = true; m.checkCollisions = isSolidSaved;
                  m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
                  m.receiveShadows = true; m.applyFog = !isIgnoraNieblaSaved;
                }
                if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
              });
              const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

              let initialHeadLocal: Vector3 | null = null;
              const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
              if (headNode) {
                headNode.computeWorldMatrix(true); rootNode.computeWorldMatrix(true);
                initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
              }

              const playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

              rootNode.metadata = {
                type: obj.type, rol: 'light', assetId: obj.assetId, path, isSolid: isSolidSaved, isSelectable: isSelectableSaved,
                ignoraNiebla: isIgnoraNieblaSaved,
                lightColor: lightColorHex, intensity: obj.properties?.intensity ?? 1.0, range: obj.properties?.range ?? 50, angle: obj.properties?.angle ?? 60,
                attachedNodePath: obj.properties?.attachedNodePath || '', attachedNodeName: obj.properties?.attachedNodeName || '',
                animationNames: anims.map(a => a.name),
                collider: obj.properties?.collider || defaultCollider,
                camOffset: obj.properties?.camOffset || defaultCamOffset,
                playerConfig, selectionRange: { ...playerConfig.selectionRange }, initialHeadLocal
              };

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
            mat.wireframe = true; mat.maxSimultaneousLights = 16;
            mesh.material = mat; mesh.applyFog = !isIgnoraNieblaSaved;

            let lightObj: any;
            if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 2.5, 0), scene);
            else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), (obj.properties?.angle ?? 60) * (Math.PI / 180), 2, scene);
            else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

            lightObj.parent = mesh;
            lightObj.intensity = obj.properties?.intensity ?? 1.0;
            lightObj.diffuse = Color3.FromHexString(lightColorHex);
            lightObj.specular = new Color3(0, 0, 0);
            if (lightObj.range !== undefined) lightObj.range = obj.properties?.range ?? 50;

            const playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

            mesh.metadata = {
              type: obj.type, rol: 'light', isSolid: false, isSelectable: true, ignoraNiebla: isIgnoraNieblaSaved,
              lightColor: lightColorHex, intensity: obj.properties?.intensity ?? 1.0, range: obj.properties?.range ?? 50, angle: obj.properties?.angle ?? 60,
              attachedNodePath: '', attachedNodeName: '', playerConfig, selectionRange: { ...playerConfig.selectionRange }
            };

            mesh.isPickable = true; mesh.checkCollisions = false; mesh.isVisible = isAdmin;
            return;
          }
        }

        const interactDistanceFPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0);
        const interactDistanceTPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0);
        const interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
        const interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';

        const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
        if (savedCollider.radiusX !== undefined) {
          savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
          savedCollider.type = isModel ? 'capsule' : 'box';
        }
        if (!savedCollider.type) savedCollider.type = isModel ? 'capsule' : 'box';

        const savedCamOffset = obj.properties?.camOffset || { ...defaultCamOffset };
        const savedPlayerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

        if (isModel && obj.assetId) {
          const path = obj.properties?.path || obj.asset?.path;
          if (!path) return;
          const fullPath = 'http://localhost:4000' + path;
          const lastSlash = fullPath.lastIndexOf('/');

          const p = SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
            const rootNode = result.meshes[0] as Mesh;
            rootNode.name = obj.name; rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
            rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
            rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            rootNode.checkCollisions = false; rootNode.isPickable = true;
            rootNode.applyFog = !isIgnoraNieblaSaved;

            result.meshes.forEach(m => {
              if (m !== rootNode) {
                m.isPickable = true; m.checkCollisions = isSolidSaved;
                m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
                m.receiveShadows = true; m.applyFog = !isIgnoraNieblaSaved;
              }
              if (m.material) this.materialSvc.ajustarMaterialGLB(m.material);
            });
            const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

            let initialHeadLocal: Vector3 | null = null;
            const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
            if (headNode) {
              headNode.computeWorldMatrix(true); rootNode.computeWorldMatrix(true);
              initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
            }

            rootNode.metadata = {
              type: 'model', rol: rolSaved, assetId: obj.assetId, path, isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
              ignoraNiebla: isIgnoraNieblaSaved, interactDistanceFPS, interactDistanceTPS, interactSequenceIdFPS, interactSequenceIdTPS,
              animationNames: anims.map(a => a.name), collider: savedCollider, camOffset: savedCamOffset,
              playerConfig: savedPlayerConfig, selectionRange: { ...savedPlayerConfig.selectionRange }, initialHeadLocal
            };
            rootNode.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
            rootNode.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);
          });
          promesasCarga.push(p);
        } else {
          let mesh!: Mesh;
          switch (obj.type) {
            case 'cube': mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene); break;
            case 'sphere': mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene); break;
            case 'cylinder': mesh = MeshBuilder.CreateCylinder(obj.name, { height: 1, diameter: 1 }, scene); break;
            case 'plane': mesh = MeshBuilder.CreateGround(obj.name, { width: 1, height: 1 }, scene); break;
            case 'bubble': mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene); break;
            case 'video_plane': mesh = MeshBuilder.CreatePlane(obj.name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
            default: return;
          }

          mesh.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);

          const savedColorHex = obj.properties?.color?.substring(0, 7) || '#888888';
          const savedColorBW = obj.properties?.colorBW?.substring(0, 7) || savedColorHex;

          mesh.metadata = {
            type: obj.type, rol: rolSaved, color: savedColorHex, colorBW: savedColorBW, isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
            ignoraNiebla: isIgnoraNieblaSaved, respawnTime: obj.properties?.respawnTime ?? 8, 
            interactDistanceFPS, interactDistanceTPS, interactSequenceIdFPS, interactSequenceIdTPS,
            collider: savedCollider, camOffset: savedCamOffset,
            playerConfig: savedPlayerConfig, selectionRange: { ...savedPlayerConfig.selectionRange }
          };

          if (isVideo) {
             mesh.metadata.assetId = obj.assetId;
             mesh.metadata.videoUrl = obj.properties?.videoUrl || obj.properties?.path || '';
          }

          mesh.isPickable = true; mesh.checkCollisions = isSolidSaved;
          mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
          mesh.applyFog = !isIgnoraNieblaSaved;
          
          if (obj.type !== 'bubble' && obj.type !== 'video_plane') {
            mesh.receiveShadows = true;
          }

          mesh.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
          mesh.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);

          if (obj.type === 'bubble') {
              const mat = new StandardMaterial('mat_' + obj.name, scene);
              mat.emissiveColor = new Color3(0.9, 0.95, 1.0);
              mat.diffuseColor = new Color3(0, 0, 0); mat.alpha = 0.6; mat.disableLighting = true;
              mat.opacityFresnelParameters = new FresnelParameters();
              mat.opacityFresnelParameters.leftColor = Color3.White(); mat.opacityFresnelParameters.rightColor = Color3.Black(); 
              mat.opacityFresnelParameters.bias = 0.2; mat.opacityFresnelParameters.power = 1.5;
              mesh.material = mat; mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
          } else if (obj.type === 'video_plane') {
              const mat = new StandardMaterial('mat_' + obj.name, scene);
              mat.emissiveColor = new Color3(0, 0, 0); 
              mat.disableLighting = true;
              
              if (mesh.metadata.videoUrl) {
                  const videoUrl = 'http://localhost:4000' + mesh.metadata.videoUrl;
                  
                  // 🔥 FIX CRÍTICO 2 y 3: generateMipMaps en false (4to arg) para evitar GL_INVALID_OPERATION
                  // y autoPlay: false para evitar The play() request was interrupted by a call to pause()
                  const videoTexture = new VideoTexture(
                    "vidTex_" + obj.name, 
                    videoUrl, 
                    scene, 
                    false,  // generateMipMaps: NO SOPORTADO PARA VIDEOS
                    true,   // invertY
                    undefined, 
                    { autoPlay: false } // Evita que arranque automáticamente
                  );
                  
                  // ELIMINADO: videoTexture.video.pause(); -> Causa problemas.
                  mat.diffuseTexture = videoTexture;
              } else {
                  mat.diffuseColor = new Color3(0.1, 0.1, 0.1); 
              }
              mesh.material = mat;
          } else {
              const mat = new StandardMaterial('mat_' + obj.name, scene);
              const isBW = scene.metadata?.globalVisualMode === 'bw';
              mat.diffuseColor = Color3.FromHexString(isBW ? savedColorBW : savedColorHex);
              mat.specularColor = new Color3(0, 0, 0);
              if (rolSaved === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
              mat.maxSimultaneousLights = 16; mesh.material = mat;
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
            case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
            case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
            default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
          }

          mesh.position = new Vector3(trigger.position.x, trigger.position.y, trigger.position.z);
          mesh.scaling = new Vector3(trigger.size.x, trigger.size.y, trigger.size.z);

          const mat = new StandardMaterial('mat_trigger_' + trigger.name, scene);
          mat.diffuseColor = new Color3(0.2, 1, 0.2); mat.alpha = 0.3; mat.wireframe = true; mat.maxSimultaneousLights = 16;
          mesh.material = mat; mesh.isPickable = true; mesh.checkCollisions = false; mesh.isVisible = isAdmin;

          mesh.metadata = {
            type: 'trigger', triggerShape: shape, isComposite: isComposite,
            conditions: [], mensajeEntrada: '', mensajeSalida: '', soundUrlEntrada: '', soundUrlSalida: '', seqEntrada: '', seqSalida: '', timeEntrada: 4.5, timeSalida: 4.5, videoEntrada: '', videoSalida: '',
            condition: 'on_enter', mensaje: '', soundUrl: '', interactSequenceId: '', timeNorm: 4.5, videoNorm: '',
            isRepeatable: trigger.isRepeatable, isEnabled: trigger.isEnabled, hasTriggeredEnter: false, hasTriggeredExit: false
          };
        }

        if (isComposite) {
          if (trigger.condition && !mesh.metadata.conditions.includes(trigger.condition)) { mesh.metadata.conditions.push(trigger.condition); }
          if (trigger.condition === 'on_enter') {
            mesh.metadata.mensajeEntrada = trigger.actionProperties?.mensaje || ''; mesh.metadata.soundUrlEntrada = trigger.actionProperties?.soundUrl || '';
            mesh.metadata.seqEntrada = trigger.actionProperties?.seqEntrada || ''; mesh.metadata.timeEntrada = trigger.actionProperties?.timeEntrada ?? 4.5;
            mesh.metadata.videoEntrada = trigger.actionProperties?.videoEntrada || '';
          } else if (trigger.condition === 'on_exit') {
            mesh.metadata.mensajeSalida = trigger.actionProperties?.mensaje || ''; mesh.metadata.soundUrlSalida = trigger.actionProperties?.soundUrl || '';
            mesh.metadata.seqSalida = trigger.actionProperties?.seqSalida || ''; mesh.metadata.timeSalida = trigger.actionProperties?.timeSalida ?? 4.5;
            mesh.metadata.videoSalida = trigger.actionProperties?.videoSalida || '';
          }
        } else {
          mesh.metadata.condition = trigger.condition || 'on_enter'; mesh.metadata.mensaje = trigger.actionProperties?.mensaje || '';
          mesh.metadata.soundUrl = trigger.actionProperties?.soundUrl || ''; mesh.metadata.interactSequenceId = trigger.actionProperties?.interactSequenceId || '';
          mesh.metadata.timeNorm = trigger.actionProperties?.timeNorm ?? 4.5; mesh.metadata.videoNorm = trigger.actionProperties?.videoNorm || '';
        }
      });

      Promise.all(promesasCarga).then(() => {
        this.shadowsSvc.asignarObjetosASombrasDeLuces();
        this.nodesSvc.actualizarListaNodos();
        resolve(); 
      });
    });
  }
}