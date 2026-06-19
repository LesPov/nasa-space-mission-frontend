
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DirectionalLight, FresnelParameters, Mesh, MeshBuilder, PointLight, SpotLight, StandardMaterial, Texture, Vector3, VideoTexture } from '@babylonjs/core';
 import { CoreSceneUtilsService } from '../utils/core-scene-utils.service';
import { CoreSceneProjectionService } from '../utils/core-scene-projection.service';
import { BubblePulseBehavior } from '../../behaviors/bubble-pulse.behavior';
import { DistanceFadeBehavior } from '../../behaviors/distance-fade.behavior';
import { LoopManagerService } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { Motor3dService } from '../../../../services/motor-3d.service';
 
@Injectable({ providedIn: 'root' })
export class CorePrimitiveLoaderService {
  private motor3d = inject(Motor3dService);
  private utilsSvc = inject(CoreSceneUtilsService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private loopManager = inject(LoopManagerService);
  private entityManager = inject(EntityManagerService); 

  public cargarPrimitiva(obj: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.scene;
    
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, obj.properties?.rol || 'prop');

    entity.transform.position = { x: obj.position?.x ?? 0, y: obj.position?.y ?? 0, z: obj.position?.z ?? 0 };
    entity.transform.rotation = { x: obj.rotation?.x ?? 0, y: obj.rotation?.y ?? 0, z: obj.rotation?.z ?? 0 };
    
    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && Number(obj.scale?.x) !== 0 && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && Number(obj.scale?.y) !== 0 && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && Number(obj.scale?.z) !== 0 && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;
    entity.transform.scale = { x: scaleX, y: scaleY, z: scaleZ };

    entity.parentId = obj.parentId || null;

    entity.visual.color = obj.properties?.color?.substring(0, 7) || '#888888';
    entity.visual.colorBW = obj.properties?.colorBW?.substring(0, 7) || entity.visual.color;
    entity.visual.isSolid = obj.properties?.isSolid ?? true;
    entity.visual.isSelectable = obj.properties?.isSelectable ?? true;
    entity.visual.ignoraNiebla = obj.properties?.ignoraNiebla ?? false;
    entity.visual.esEmisivo = obj.properties?.esEmisivo ?? false;
    entity.visual.brilloIntensidad = this.utilsSvc.normalizarNumero(obj.properties?.brilloIntensidad, 1.0);
    
    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);
    entity.selectionRange = { ...savedSelectionRange };
    entity.playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

    const defaultCollider = { type: (obj.type === 'sphere' || obj.type === 'bubble') ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
    entity.collider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };

    entity.interaction.mensaje = obj.properties?.mensaje || '';
    entity.interaction.interactDistanceFPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0);
    entity.interaction.interactDistanceTPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0);
    entity.interaction.interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
    entity.interaction.interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';
    entity.interaction.interactSequenceId = obj.properties?.interactSequenceId || '';
    entity.interaction.respawnTime = this.utilsSvc.normalizarNumero(obj.properties?.respawnTime, 8);
    
    entity.camOffset = obj.properties?.camOffset || { x: 0, y: 0.8, z: 0 };
    entity.autoAnim = obj.properties?.autoAnim || null;

    if (obj.type === 'video_plane' && entity.media) {
      entity.visual.assetId = obj.assetId;
      entity.visual.path = obj.properties?.videoUrl || obj.properties?.path || '';
      entity.media.videoUrl = entity.visual.path || '';
    }
    if (obj.type === 'image_plane' && entity.media) {
      entity.visual.assetId = obj.assetId;
      entity.visual.path = obj.properties?.imageUrl || obj.properties?.path || '';
      entity.media.imageUrl = entity.visual.path || '';
      
      entity.media.profundidadProyeccion = obj.properties?.profundidadProyeccion ?? 10;
      entity.media.anguloProyeccion = obj.properties?.anguloProyeccion ?? 0;
      entity.media.proyeccionAncho = obj.properties?.proyeccionAncho ?? 2;
      entity.media.proyeccionAlto = obj.properties?.proyeccionAlto ?? 2;
      entity.media.proyeccionRepeticiones = obj.properties?.proyeccionRepeticiones ?? 1;
      entity.media.proyeccionEspaciado = obj.properties?.proyeccionEspaciado ?? 2;
      entity.media.proyeccionEje = obj.properties?.proyeccionEje || 'Y';
      entity.media.fadeDistance = this.utilsSvc.normalizarNumero(obj.properties?.fadeDistance, 0);
    }
    
    if (obj.type?.startsWith('light_') && entity.light) {
      entity.light.lightColor = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.lightColorBW = obj.properties?.lightColorBW?.substring(0, 7) || entity.light.lightColor;
      entity.light.intensity = obj.properties?.intensity ?? 1.0;
      entity.light.range = obj.properties?.range ?? 50;
      entity.light.angle = obj.properties?.angle ?? 60;
      entity.light.lightPosX = obj.properties?.lightPosX ?? 0;
      entity.light.lightPosY = obj.properties?.lightPosY ?? 0;
      entity.light.lightPosZ = obj.properties?.lightPosZ ?? 0;
      entity.light.attachedNodePath = obj.properties?.attachedNodePath || '';
      entity.light.attachedNodeName = obj.properties?.attachedNodeName || '';
    }

    let mesh!: Mesh;
    switch (obj.type) {
      case 'cube': mesh = MeshBuilder.CreateBox(entity.name, { size: 1 }, scene); break;
      case 'sphere': case 'bubble': case 'light_point': case 'light_spot': case 'light_directional':
        mesh = MeshBuilder.CreateSphere(entity.name, { diameter: obj.type === 'bubble' ? 1 : 0.4 }, scene); break;
      case 'cylinder': mesh = MeshBuilder.CreateCylinder(entity.name, { height: 1, diameter: 1 }, scene); break;
      case 'plane': mesh = MeshBuilder.CreateGround(entity.name, { width: 1, height: 1 }, scene); break;
      case 'video_plane': mesh = MeshBuilder.CreatePlane(entity.name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
      case 'image_plane': mesh = MeshBuilder.CreateBox(entity.name, { size: 1 }, scene); break;
      default: return;
    }

    entity.bindView(mesh); 
    
    mesh.isPickable = true;
    mesh.checkCollisions = entity.visual.isSolid;
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
    mesh.applyFog = !entity.visual.ignoraNiebla;
    if (obj.type !== 'bubble' && obj.type !== 'video_plane' && obj.type !== 'image_plane') mesh.receiveShadows = true;

    mesh.ellipsoid = new Vector3((entity.collider.sizeX ?? 0.5) * scaleX, (entity.collider.sizeY ?? 0.5) * scaleY, (entity.collider.sizeZ ?? 0.5) * scaleZ);
    mesh.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    if (obj.type === 'bubble') {
      mesh.addBehavior(new BubblePulseBehavior(this.loopManager, this.entityManager));
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager));

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
    } 
    else if (obj.type === 'video_plane') {
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager));
      
      const mat = new StandardMaterial('mat_' + obj.name, scene);
      mat.emissiveColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      if (entity.visual.path) {
        const videoTexture = new VideoTexture('vidTex_' + obj.name, 'http://localhost:4000' + entity.visual.path, scene, false, true, undefined, { autoPlay: false });
        mat.diffuseTexture = videoTexture;
      } else {
        mat.diffuseColor = new Color3(0.1, 0.1, 0.1);
      }
      mesh.material = mat;
    } 
    else if (obj.type === 'image_plane' && entity.media && entity.mediaRuntime) {
      const mat = new StandardMaterial('decalMat_' + obj.name, scene);
      const isBW = scene.metadata?.globalVisualMode === 'bw';
      const activeColorAUsar = isBW ? entity.visual.colorBW : entity.visual.color;
      const tex = entity.visual.path ? new Texture('http://localhost:4000' + entity.visual.path, scene) : null;

      this.projectionSvc.configurarMaterialProyector(mat, activeColorAUsar, entity.visual.brilloIntensidad, entity.visual.ignoraNiebla, tex);
      
      mesh.material = mat;
      entity.mediaRuntime.runtimeDecalMaterial = mat;

      mesh.isVisible = false;
      mesh.alwaysSelectAsActiveMesh = true;

      this.projectionSvc.aplicarLogicaHolograma(mesh, scene);
    } 
    else if (obj.type?.startsWith('light_') && entity.light) {
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager));

      const isBW = scene.metadata?.globalVisualMode === 'bw';
      const activeColor = isBW ? entity.light.lightColorBW : entity.light.lightColor;

      const mat = new StandardMaterial('mat_' + obj.name, scene);
      mat.emissiveColor = Color3.FromHexString(activeColor);
      mat.wireframe = true;
      mat.maxSimultaneousLights = 4;
      mat.fogEnabled = !entity.visual.ignoraNiebla;
      mesh.material = mat;

      mesh.isVisible = false;

      let lightObj: any;
      if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 0, 0), scene);
      else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 0, 0), new Vector3(0, -1, 0), entity.light.angle * (Math.PI / 180), 2, scene);
      else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

      lightObj.parent = mesh;
      lightObj.intensity = entity.light.intensity;
      lightObj.diffuse = Color3.FromHexString(activeColor);
      lightObj.specular = new Color3(0, 0, 0);
      
      if (lightObj.range !== undefined) lightObj.range = entity.light.range;

      if (lightObj.position) {
          lightObj.position.copyFromFloats(entity.light.lightPosX, entity.light.lightPosY, entity.light.lightPosZ);
      }
    } 
    else {
      const mat = new StandardMaterial('mat_' + obj.name, scene);
      const activeHexToApply = scene.metadata?.globalVisualMode === 'bw' ? entity.visual.colorBW : entity.visual.color;
      const c3 = Color3.FromHexString(activeHexToApply);

      mat.diffuseColor = c3;
      mat.specularColor = new Color3(0, 0, 0);

      if (entity.rol === 'spawn_point') {
        mat.alpha = 0.5;
        mat.emissiveColor = new Color3(0, 1, 0);
      } else if (entity.visual.esEmisivo) {
        mat.emissiveColor = c3.scale(entity.visual.brilloIntensidad);
        mat.disableLighting = false;
      }

      mat.maxSimultaneousLights = 4;
      mat.fogEnabled = !entity.visual.ignoraNiebla;
      mesh.material = mat;
    }

    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, mesh);
  }
}