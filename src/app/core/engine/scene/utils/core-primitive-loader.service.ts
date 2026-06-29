
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3, VideoTexture, Tags } from '@babylonjs/core';
import { CoreSceneProjectionService } from '../utils/core-scene-projection.service';
import { BubblePulseBehavior } from '../../behaviors/bubble-pulse.behavior';
import { DistanceFadeBehavior } from '../../behaviors/distance-fade.behavior';
import { LoopManagerService } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { CameraOwnershipService } from '../../runtime/cameras/camera-ownership.service';
 
@Injectable({ providedIn: 'root' })
export class CorePrimitiveLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private projectionSvc = inject(CoreSceneProjectionService);
  private loopManager = inject(LoopManagerService);
  private entityManager = inject(EntityManagerService);
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private ownership = inject(CameraOwnershipService);

  public cargarPrimitiva(obj: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.getScene();
    
    const rolSaved = obj.properties?.rol || obj.rol || 'prop';
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, rolSaved);

    this.persistenceMapper.applyDbToEntity(obj, entity);

    const scaleX = entity.transform.scale.x;
    const scaleY = entity.transform.scale.y;
    const scaleZ = entity.transform.scale.z;

    let mesh!: Mesh;
    switch (obj.type) {
      case 'cube': mesh = MeshBuilder.CreateBox(entity.name, { size: 1 }, scene); break;
      case 'sphere': mesh = MeshBuilder.CreateSphere(entity.name, { diameter: 1 }, scene); break;
      case 'bubble': mesh = MeshBuilder.CreateSphere(entity.name, { diameter: 1 }, scene); break;
      case 'light_point': case 'light_spot': case 'light_directional':
        mesh = MeshBuilder.CreateSphere(entity.name, { diameter: 0.4 }, scene); break;
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

    mesh.ellipsoid = new Vector3((entity.collider.sizeX ?? 1) * scaleX, (entity.collider.sizeY ?? 1) * scaleY, (entity.collider.sizeZ ?? 1) * scaleZ);
    mesh.ellipsoidOffset = new Vector3((entity.collider.offsetX ?? 0) * scaleX, (entity.collider.offsetY ?? 0) * scaleY, (entity.collider.offsetZ ?? 0) * scaleZ);

    if (obj.type === 'bubble') {
      mesh.addBehavior(new BubblePulseBehavior(this.loopManager, this.entityManager));
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager, this.ownership));

      const mat = new StandardMaterial('mat_' + obj.name, scene);
      mat.emissiveColor = new Color3(0.9, 0.95, 1.0);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.alpha = 0.6;
      mat.disableLighting = true;
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
      this.projectionSvc.aplicarLogicaHolograma(mesh, scene);
    } 
    else if (obj.type?.startsWith('light_') && entity.light) {
      mesh.addBehavior(new DistanceFadeBehavior(this.loopManager, this.entityManager, this.ownership));
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const activeColor = isBW ? entity.light.lightColorBW : entity.light.lightColor;

      const mat = new StandardMaterial('mat_' + obj.name, scene);
      mat.emissiveColor = Color3.FromHexString(activeColor);
      mat.wireframe = true;
      mat.maxSimultaneousLights = 16;
      mesh.material = mat;
      mesh.isVisible = false;
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

      mat.maxSimultaneousLights = 16; 
      mat.fogEnabled = !entity.visual.ignoraNiebla;
      mesh.material = mat;
    }

    if (entity.rol === 'spawn_point') {
        mesh.checkCollisions = false;
        if (mesh.material && mesh.material instanceof StandardMaterial) {
            mesh.material.alpha = 0.4;
            mesh.material.wireframe = false;
            mesh.material.emissiveColor = new Color3(0, 1, 0);
        }
    }

    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, mesh);
  }
}