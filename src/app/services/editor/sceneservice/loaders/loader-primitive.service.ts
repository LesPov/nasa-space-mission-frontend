import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DirectionalLight, FresnelParameters, Mesh, MeshBuilder, PointLight, Quaternion, SpotLight, StandardMaterial, Texture, Vector3, VideoTexture } from '@babylonjs/core';
import { Motor3dService } from '../../../motor-3d.service';
import { EditorStateService } from '../../editor-state.service';
import { SceneUtilsService } from '../scene-utils.service';
import { SceneProjectionService } from '../scene-projection.service';

@Injectable({ providedIn: 'root' })
export class LoaderPrimitiveService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private utilsSvc = inject(SceneUtilsService);
  private projectionSvc = inject(SceneProjectionService);

  public cargarPrimitiva(obj: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.scene;
    const isAdmin = this.state.rolSimulado() === 'admin';
    let mesh!: Mesh;

    switch (obj.type) {
      case 'cube': mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene); break;
      case 'sphere':
      case 'bubble':
      case 'light_point':
      case 'light_spot':
      case 'light_directional':
        mesh = MeshBuilder.CreateSphere(obj.name, { diameter: obj.type === 'bubble' ? 1 : 0.4 }, scene);
        break;
      case 'cylinder': mesh = MeshBuilder.CreateCylinder(obj.name, { height: 1, diameter: 1 }, scene); break;
      case 'plane': mesh = MeshBuilder.CreateGround(obj.name, { width: 1, height: 1 }, scene); break;
      case 'video_plane': mesh = MeshBuilder.CreatePlane(obj.name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
      case 'image_plane': mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene); break;
      default: return;
    }

    const posX = obj.position?.x ?? 0;
    const posY = obj.position?.y ?? 0;
    const posZ = obj.position?.z ?? 0;
    mesh.position = new Vector3(posX, posY, posZ);

    const rotX = obj.rotation?.x ?? 0;
    const rotY = obj.rotation?.y ?? 0;
    const rotZ = obj.rotation?.z ?? 0;
    mesh.rotationQuaternion = Quaternion.FromEulerAngles(rotX, rotY, rotZ);

    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && Number(obj.scale?.x) !== 0 && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && Number(obj.scale?.y) !== 0 && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && Number(obj.scale?.z) !== 0 && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;
    mesh.scaling = new Vector3(scaleX, scaleY, scaleZ);

    const isSolidSaved = obj.properties?.isSolid ?? true;
    const isIgnoraNieblaSaved = obj.properties?.ignoraNiebla ?? false;
    const savedColorHex = obj.properties?.color?.substring(0, 7) || '#888888';
    const lightColorHex = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';
    
    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);
    const savedPlayerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);
    const defaultCollider = { type: (obj.type === 'sphere' || obj.type === 'bubble') ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
    const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };

    mesh.metadata = {
      uid: obj.uid || window.crypto.randomUUID(),
      type: obj.type,
      rol: obj.properties?.rol || 'prop',
      color: savedColorHex,
      colorBW: obj.properties?.colorBW?.substring(0, 7) || savedColorHex,
      isSolid: isSolidSaved,
      isSelectable: obj.properties?.isSelectable ?? true,
      mensaje: obj.properties?.mensaje || '',
      ignoraNiebla: isIgnoraNieblaSaved,
      esEmisivo: obj.properties?.esEmisivo ?? false,
      brilloIntensidad: this.utilsSvc.normalizarNumero(obj.properties?.brilloIntensidad, 1.0),
      respawnTime: obj.properties?.respawnTime ?? 8,
      profundidadProyeccion: obj.properties?.profundidadProyeccion ?? 10,
      anguloProyeccion: obj.properties?.anguloProyeccion ?? 0,
      proyeccionAncho: obj.properties?.proyeccionAncho ?? 2,
      proyeccionAlto: obj.properties?.proyeccionAlto ?? 2,
      proyeccionRepeticiones: obj.properties?.proyeccionRepeticiones ?? 1,
      proyeccionEspaciado: obj.properties?.proyeccionEspaciado ?? 2,
      proyeccionEje: obj.properties?.proyeccionEje || 'Y',
      fadeDistance: this.utilsSvc.normalizarNumero(obj.properties?.fadeDistance, 0),
      interactDistanceFPS: this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0),
      interactDistanceTPS: this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0),
      interactSequenceIdFPS: obj.properties?.interactSequenceIdFPS || '',
      interactSequenceIdTPS: obj.properties?.interactSequenceIdTPS || '',
      collider: savedCollider,
      camOffset: obj.properties?.camOffset || { x: 0, y: 0.8, z: 0 },
      playerConfig: savedPlayerConfig,
      selectionRange: { ...savedPlayerConfig.selectionRange },
      parentId: obj.parentId || null,
      autoAnim: obj.properties?.autoAnim || null
    };

    if (obj.type === 'video_plane') {
      mesh.metadata.assetId = obj.assetId;
      mesh.metadata.videoUrl = obj.properties?.videoUrl || obj.properties?.path || '';
    }
    if (obj.type === 'image_plane') {
      mesh.metadata.assetId = obj.assetId;
      mesh.metadata.imageUrl = obj.properties?.imageUrl || obj.properties?.path || '';
    }
    
    // 🔥 FIX VITAL LUZ SIN MODELO: Rescatar la posición local guardada
    if (obj.type?.startsWith('light_')) {
      mesh.metadata.lightColor = lightColorHex;
      mesh.metadata.intensity = obj.properties?.intensity ?? 1.0;
      mesh.metadata.range = obj.properties?.range ?? 50;
      mesh.metadata.angle = obj.properties?.angle ?? 60;
      mesh.metadata.lightPosX = obj.properties?.lightPosX ?? 0;
      mesh.metadata.lightPosY = obj.properties?.lightPosY ?? 0;
      mesh.metadata.lightPosZ = obj.properties?.lightPosZ ?? 0;
      mesh.metadata.attachedNodePath = obj.properties?.attachedNodePath || '';
      mesh.metadata.attachedNodeName = obj.properties?.attachedNodeName || '';
    }

    mesh.isPickable = true;
    mesh.checkCollisions = isSolidSaved;
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
    mesh.applyFog = !isIgnoraNieblaSaved;
    if (obj.type !== 'bubble' && obj.type !== 'video_plane' && obj.type !== 'image_plane') mesh.receiveShadows = true;

    mesh.ellipsoid = new Vector3((savedCollider.sizeX ?? 0.5) * scaleX, (savedCollider.sizeY ?? 0.5) * scaleY, (savedCollider.sizeZ ?? 0.5) * scaleZ);
    mesh.ellipsoidOffset = new Vector3((savedCollider.offsetX ?? 0) * scaleX, (savedCollider.offsetY ?? 0) * scaleY, (savedCollider.offsetZ ?? 0) * scaleZ);

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
        const videoTexture = new VideoTexture('vidTex_' + obj.name, 'http://localhost:4000' + mesh.metadata.videoUrl, scene, false, true, undefined, { autoPlay: false });
        mat.diffuseTexture = videoTexture;
      } else {
        mat.diffuseColor = new Color3(0.1, 0.1, 0.1);
      }
      mesh.material = mat;
    } else if (obj.type === 'image_plane') {
      const mat = new StandardMaterial('decalMat_' + obj.name, scene);
      const activeColorAUsar = scene.metadata?.globalVisualMode === 'bw' ? mesh.metadata.colorBW : mesh.metadata.color;
      const imageUrl = mesh.metadata.imageUrl ? 'http://localhost:4000' + mesh.metadata.imageUrl : '';
      const tex = imageUrl ? new Texture(imageUrl, scene) : null;

      this.projectionSvc.configurarMaterialProyector(mat, activeColorAUsar, mesh.metadata.brilloIntensidad, isIgnoraNieblaSaved, tex);
      
      mesh.material = mat;
      mesh.metadata.decalMaterial = mat;
      mesh.isVisible = isAdmin;
      mesh.alwaysSelectAsActiveMesh = true;

      this.projectionSvc.aplicarLogicaHolograma(mesh, scene);
    } else if (obj.type?.startsWith('light_')) {
      const mat = new StandardMaterial('mat_' + obj.name, scene);
      mat.emissiveColor = Color3.FromHexString(lightColorHex);
      mat.wireframe = true;
      mat.maxSimultaneousLights = 16;
      mat.fogEnabled = !isIgnoraNieblaSaved;
      mesh.material = mat;
      mesh.isVisible = isAdmin;

      let lightObj: any;
      if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 0, 0), scene);
      else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 0, 0), new Vector3(0, -1, 0), (obj.properties?.angle ?? 60) * (Math.PI / 180), 2, scene);
      else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

      lightObj.parent = mesh;
      lightObj.intensity = obj.properties?.intensity ?? 1.0;
      lightObj.diffuse = Color3.FromHexString(lightColorHex);
      lightObj.specular = new Color3(0, 0, 0);
      if (lightObj.range !== undefined) lightObj.range = obj.properties?.range ?? 50;

      // 🔥 FIX VITAL LUZ SIN MODELO: Restaurar la posición real en el mundo 3D
      if (lightObj.position) {
          lightObj.position.copyFromFloats(mesh.metadata.lightPosX, mesh.metadata.lightPosY, mesh.metadata.lightPosZ);
      }
    } else {
      const mat = new StandardMaterial('mat_' + obj.name, scene);
      const activeHexToApply = scene.metadata?.globalVisualMode === 'bw' ? mesh.metadata.colorBW : mesh.metadata.color;
      const c3 = Color3.FromHexString(activeHexToApply);

      mat.diffuseColor = c3;
      mat.specularColor = new Color3(0, 0, 0);

      if (mesh.metadata.rol === 'spawn_point') {
        mat.alpha = 0.5;
        mat.emissiveColor = new Color3(0, 1, 0);
      } else if (mesh.metadata.esEmisivo) {
        mat.emissiveColor = c3.scale(mesh.metadata.brilloIntensidad);
        mat.disableLighting = false;
      }

      mat.maxSimultaneousLights = 16;
      mat.fogEnabled = !isIgnoraNieblaSaved;
      mesh.material = mat;
    }

    mallasCreadas.set(mesh.metadata.uid, mesh);
  }
}