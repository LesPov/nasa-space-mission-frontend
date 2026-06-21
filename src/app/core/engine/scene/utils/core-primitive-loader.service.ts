
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, DirectionalLight, FresnelParameters, Mesh, MeshBuilder, PointLight, SpotLight, StandardMaterial, Texture, Vector3, VideoTexture } from '@babylonjs/core';
import { CoreSceneProjectionService } from '../utils/core-scene-projection.service';
import { BubblePulseBehavior } from '../../behaviors/bubble-pulse.behavior';
import { DistanceFadeBehavior } from '../../behaviors/distance-fade.behavior';
import { LoopManagerService } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { CameraOwnershipService } from '../../runtime/cameras/camera-ownership.service';
 
@Injectable({ providedIn: 'root' })
export class CorePrimitiveLoaderService {
  private motor3d = inject(Motor3dService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private loopManager = inject(LoopManagerService);
  private entityManager = inject(EntityManagerService);
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private ownership = inject(CameraOwnershipService);

  public cargarPrimitiva(obj: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.scene;
    
    const rolSaved = obj.properties?.rol || obj.rol || 'prop';
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, rolSaved);

    this.persistenceMapper.applyDbToEntity(obj, entity);

    const scaleX = entity.transform.scale.x;
    const scaleY = entity.transform.scale.y;
    const scaleZ = entity.transform.scale.z;

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
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager, this.ownership));

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
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager, this.ownership));
      
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
      
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
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
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager, this.ownership));

      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
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
      
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const activeHexToApply = isBW ? entity.visual.colorBW : entity.visual.color;
      
      const c3 = Color3.FromHexString(activeHexToApply);

      mat.diffuseColor = c3;
      mat.specularColor = new Color3(0, 0, 0);

      if (entity.characterConfig?.isPlayable) {
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