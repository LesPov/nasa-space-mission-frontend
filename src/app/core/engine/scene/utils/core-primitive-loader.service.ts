import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3, VideoTexture, Tags, TransformNode } from '@babylonjs/core';
import { CoreSceneProjectionService } from '../utils/core-scene-projection.service';
import { BubblePulseBehavior } from '../../behaviors/bubble-pulse.behavior';
import { DistanceFadeBehavior } from '../../behaviors/distance-fade.behavior';
import { LoopManagerService } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity, LightComponent } from '../../entities/game.entity';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { CameraOwnershipService } from '../../runtime/cameras/camera-ownership.service';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';
 
@Injectable({ providedIn: 'root' })
export class CorePrimitiveLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private projectionSvc = inject(CoreSceneProjectionService);
  private loopManager = inject(LoopManagerService);
  private entityManager = inject(EntityManagerService);
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private ownership = inject(CameraOwnershipService);
  private gameContext = inject(GameContextService);

  public cargarPrimitiva(obj: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.getScene();
    
    const isLightType = obj.type === 'light_point' || obj.type === 'light_spot' || obj.type === 'light_directional';
    const rolSaved = obj.properties?.rol || obj.rol || (isLightType ? 'light' : 'prop');
    const entity = new GameEntity(obj.uid || window.crypto.randomUUID(), obj.name, obj.type, rolSaved);

    this.persistenceMapper.applyDbToEntity(obj, entity);

    const scaleX = entity.transform.scale.x;
    const scaleY = entity.transform.scale.y;
    const scaleZ = entity.transform.scale.z;

    let mesh!: Mesh;

    if (isLightType) {
      if (!entity.light) {
        entity.light = new LightComponent();
      }

      mesh = new Mesh(entity.name, scene);
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.receiveShadows = false;
      mesh.isVisible = false;

      const visualSphere = MeshBuilder.CreateSphere(`visual_${entity.name}`, { diameter: 1.0, segments: 16 }, scene);
      visualSphere.parent = mesh;
      visualSphere.isPickable = false;
      visualSphere.checkCollisions = false;
      visualSphere.receiveShadows = false;
      visualSphere.renderingGroupId = 1;

      visualSphere.scaling.set(0.4, 0.4, 0.4);

      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const activeColor = isBW ? entity.light.lightColorBW : entity.light.lightColor;

      const lightVisualMat = new StandardMaterial(`mat_visual_${entity.name}`, scene);
      const c3 = Color3.FromHexString(activeColor || '#facc15');
      lightVisualMat.emissiveColor = c3.clone();
      lightVisualMat.diffuseColor = c3.clone();
      lightVisualMat.specularColor = Color3.Black();
      lightVisualMat.disableLighting = true;
      lightVisualMat.fogEnabled = false;

      visualSphere.material = lightVisualMat;

      Tags.AddTagsTo(mesh, "light_entity");
      Tags.AddTagsTo(visualSphere, "light_visual");

      mesh.metadata = { entityUid: entity.uid, isLightRoot: true };
      visualSphere.metadata = { entityUid: entity.uid, isLightVisual: true };

      if (obj.type === 'light_spot' || obj.type === 'light_directional') {
        const cone = MeshBuilder.CreateCylinder(`dir_${entity.name}`, { diameterTop: 0, diameterBottom: 0.15, height: 0.4 }, scene);
        cone.parent = visualSphere;
        cone.rotation.x = Math.PI / 2;
        cone.position.z = 0.25;
        cone.material = lightVisualMat;
        cone.isPickable = false;
        cone.renderingGroupId = 1;
        cone.isVisible = false;
        Tags.AddTagsTo(cone, "light_visual ignore_raycast");
      }

      // Por defecto nace estrictamente oculto. LightVisualVisibilityService lo mostrará solo si se selecciona
      visualSphere.isVisible = false;
      visualSphere.setEnabled(true);

    } else {
      switch (obj.type) {
        case 'cube': mesh = MeshBuilder.CreateBox(entity.name, { size: 1 }, scene); break;
        case 'sphere': mesh = MeshBuilder.CreateSphere(entity.name, { diameter: 1 }, scene); break;
        case 'bubble': mesh = MeshBuilder.CreateSphere(entity.name, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(entity.name, { height: 1, diameter: 1 }, scene); break;
        case 'plane': mesh = MeshBuilder.CreateGround(entity.name, { width: 1, height: 1 }, scene); break;
        case 'video_plane': mesh = MeshBuilder.CreatePlane(entity.name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
        case 'image_plane': mesh = MeshBuilder.CreateBox(entity.name, { size: 1 }, scene); break;
        default: return;
      }

      mesh.isPickable = true;
      mesh.checkCollisions = entity.visual.isSolid;
      mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      mesh.applyFog = !entity.visual.ignoraNiebla;
      if (obj.type !== 'bubble' && obj.type !== 'video_plane' && obj.type !== 'image_plane') {
        mesh.receiveShadows = true;
      }

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
      else {
        const mat = new StandardMaterial('mat_' + obj.name, scene);
        const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
        
        const activeHexToApply = isBW ? entity.visual.colorBW : entity.visual.color;
        const activeAmbientToApply = isBW ? entity.visual.ambientColorBW : entity.visual.ambientColor;
        
        const c3 = Color3.FromHexString(activeHexToApply);
        const c3Amb = Color3.FromHexString(activeAmbientToApply);

        mat.diffuseColor = c3;
        mat.ambientColor = c3Amb;
        mat.specularColor = new Color3(0, 0, 0);

        if (entity.characterConfig?.isPlayable) {
          mat.alpha = 0.5;
          mat.emissiveColor = new Color3(0, 1, 0);
        } else if (entity.visual.esEmisivo) {
          mat.emissiveColor = c3.scale(entity.visual.brilloIntensidad);
          mat.disableLighting = false;
        }

        mat.maxSimultaneousLights = 8; 
        mat.fogEnabled = !entity.visual.ignoraNiebla;
        mesh.material = mat;
      }

      if (entity.rol === 'spawn_point') {
        mesh.checkCollisions = false;
        Tags.AddTagsTo(mesh, "editor_only ignore_raycast");
        const isEditorMode = this.gameContext.mode() === GameMode.EDITOR || this.gameContext.mode() === GameMode.EDITING_IN_GAME;
        mesh.isVisible = isEditorMode;

        if (mesh.material && mesh.material instanceof StandardMaterial) {
          mesh.material.alpha = isEditorMode ? 0.4 : 0.0;
          mesh.material.wireframe = false;
          mesh.material.emissiveColor = new Color3(0, 1, 0);
        }
      }
    }

    entity.bindView(mesh); 
    this.entityManager.addEntity(entity);
    mallasCreadas.set(entity.uid, mesh);
  }
}