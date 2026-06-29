
import { Injectable, inject } from '@angular/core';
import { PointLight, SpotLight, DirectionalLight, Vector3, Color3, TransformNode, AbstractMesh, Light, Mesh } from '@babylonjs/core';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';

@Injectable({ providedIn: 'root' })
export class LightSyncSystem implements IUpdatable {
  public id = 'LightSyncSystem';
  private entityManager = inject(EntityManagerService);
  private worldSettings = inject(WorldSettingsService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  public update(dtMs: number): void {
    this.syncAllLights();
  }

  public syncAllLights(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    const isBW = this.worldSettings.settings().visualMode === 'bw';
    const entities = this.entityManager.getEntitiesWithComponent('light');

    for (const entity of entities) {
      if (entity.type.startsWith('light_') && entity.light && entity.view) {
         const mesh = entity.view as Mesh;
         
         let lightObj = mesh.getDescendants(false).find(c => c.name === 'l_' + entity.uid) as Light;
         
         if (!lightObj) {
            if (entity.type === 'light_point') {
               lightObj = new PointLight('l_' + entity.uid, Vector3.Zero(), scene);
            } else if (entity.type === 'light_spot') {
               lightObj = new SpotLight('l_' + entity.uid, Vector3.Zero(), new Vector3(0, -1, 0), entity.light.angle * (Math.PI / 180), 2, scene);
            } else if (entity.type === 'light_directional') {
               lightObj = new DirectionalLight('l_' + entity.uid, new Vector3(0, -1, 0), scene);
            }
            
            if (lightObj) {
              lightObj.parent = mesh;
            }
         }

         if (lightObj) {
             const lConf = entity.light;
             
             lightObj.setEnabled(lConf.enabled !== false);
             
             let targetParent: TransformNode | AbstractMesh = mesh;
             if (lConf.attachedNodeName) {
                 const foundNode = mesh.getDescendants(false).find((n: any) => n.name === lConf.attachedNodeName) as TransformNode | AbstractMesh;
                 if (foundNode) targetParent = foundNode;
             }
             if (lightObj.parent !== targetParent) {
                 lightObj.parent = targetParent;
             }

             const activeColor = isBW ? lConf.lightColorBW : lConf.lightColor;
             lightObj.diffuse = Color3.FromHexString(activeColor || '#ffffff');
             
             const finalIntensity = lConf.renderIntensity !== undefined ? lConf.renderIntensity : lConf.intensity;
             lightObj.intensity = finalIntensity;
             
             if ((lightObj as any).position) {
                 (lightObj as any).position.copyFromFloats(lConf.lightPosX ?? 0, lConf.lightPosY ?? 0, lConf.lightPosZ ?? 0);
             }

             if (lightObj instanceof SpotLight || lightObj instanceof PointLight) {
                 (lightObj as any).range = lConf.range ?? 50;
             }

             if (lightObj instanceof SpotLight || lightObj instanceof DirectionalLight) {
                 if (lightObj instanceof SpotLight) {
                     lightObj.angle = (lConf.angle ?? 60) * (Math.PI / 180);
                 }
                 if (lightObj.parent) {
                     const parentNode = lightObj.parent as TransformNode;
                     const worldMatrix = parentNode.getWorldMatrix();
                     const localDown = Vector3.TransformNormal(new Vector3(0, -1, 0), worldMatrix);
                     lightObj.direction.copyFrom(localDown.normalize());
                 } else {
                     lightObj.direction.copyFromFloats(0, -1, 0);
                 }
             }
         }
      }
    }
  }
}