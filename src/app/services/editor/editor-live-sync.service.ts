
import { Injectable, inject } from '@angular/core';
import { WindowSyncService } from '../../core/services/window-sync.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { WorldSettingsService } from '../../core/engine/world/world-settings.service';
import { EditorCinematicService } from './editor-cinematic.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { GameContextService } from '../../core/engine/session/game-context.service';

@Injectable({ providedIn: 'root' })
export class EditorLiveSyncService {
  private windowSync = inject(WindowSyncService);
  private entityManager = inject(EntityManagerService);
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private worldSettingsSvc = inject(WorldSettingsService);
  private cinematicSvc = inject(EditorCinematicService);
  private runtime = inject(RuntimeEngineService);
  private gameContext = inject(GameContextService);

  public broadcastMapData(mapData: any): void {
    this.windowSync.broadcast({
      type: 'SYNC_MAP_DATA',
      payload: mapData
    });
  }

  public broadcastTransformLive(uid: string, position: any, rotation: any, scaling: any, rotationQuaternion?: any): void {
    this.windowSync.broadcast({
      type: 'SYNC_TRANSFORM_LIVE',
      payload: { uid, position, rotation, rotationQuaternion, scaling }
    });
  }

  public async handleLiveSync(newMapData: any, episodioActual: any): Promise<any> {
    let requiereReboot = false;

    if (newMapData.cinematicsDelta) {
       this.cinematicSvc.loadFromData(newMapData.cinematicsDelta);
    }

    if (newMapData.deletedObjects?.length) newMapData.deletedObjects.forEach((uid: string) => this.entityManager.removeEntity(uid));
    if (newMapData.deletedTriggers?.length) newMapData.deletedTriggers.forEach((uid: string) => this.entityManager.removeEntity(uid));

    const procesarDeltas = (deltas: any[]) => {
        if (!deltas) return;
        for (const delta of deltas) {
            const entity = this.entityManager.getEntityByUid(delta.uid);
            if (entity) {
                if (delta.position) entity.transform.position = { ...delta.position };
                if (delta.rotation) entity.transform.rotation = { ...delta.rotation };
                if (delta.scale) entity.transform.scale = { ...delta.scale };
                if (delta.properties) {
                   if (delta.properties.color) entity.visual.color = delta.properties.color;
                   if (delta.properties.colorBW) entity.visual.colorBW = delta.properties.colorBW;
                }
                entity.syncToView();
                entity.isDirty = false;
            } else {
                requiereReboot = true;
            }
        }
    };

    procesarDeltas(newMapData.sceneObjectsDelta);
    procesarDeltas(newMapData.triggersDelta);

    if (newMapData.environmentSettings || newMapData.uiSettings) {
        this.worldSettingsSvc.loadFromDb(newMapData.environmentSettings, newMapData.uiSettings);
        this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
    }

    if (requiereReboot) {
        let lastPos: any = null;
        let lastRotQuat: any = null;
        let lastRotEuler: any = null;
        
        const playerEnt = this.gameContext.activePlayerEntity();
        if (playerEnt && playerEnt.view) {
           lastPos = playerEnt.view.position.clone();
           if (playerEnt.view.rotationQuaternion) {
               lastRotQuat = { x: playerEnt.view.rotationQuaternion.x, y: playerEnt.view.rotationQuaternion.y, z: playerEnt.view.rotationQuaternion.z, w: playerEnt.view.rotationQuaternion.w };
           } else {
               lastRotEuler = { x: playerEnt.view.rotation.x, y: playerEnt.view.rotation.y, z: playerEnt.view.rotation.z };
           }
        }

        const newEpisodio = { ...episodioActual, ...newMapData };
        try {
          const spawnEntity = await this.runtime.bootProductionGame(newEpisodio);
          if (lastPos && spawnEntity.view) {
             spawnEntity.view.position.copyFrom(lastPos);
             if (lastRotQuat && spawnEntity.view.rotationQuaternion) {
                 spawnEntity.view.rotationQuaternion.set(lastRotQuat.x, lastRotQuat.y, lastRotQuat.z, lastRotQuat.w);
             } else if (lastRotEuler && !spawnEntity.view.rotationQuaternion) {
                 spawnEntity.view.rotation.set(lastRotEuler.x, lastRotEuler.y, lastRotEuler.z);
             }
             spawnEntity.syncTransformFromView();
          }
        } catch(e) {}
        
        return newEpisodio;
    }
    
    return episodioActual;
  }

  public handleLiveTransform(data: any): void {
      const entity = this.entityManager.getEntityByUid(data.uid);
      if (entity && entity.view) {
          entity.view.position.set(data.position.x, data.position.y, data.position.z);
          if (data.rotationQuaternion && entity.view.rotationQuaternion) {
              entity.view.rotationQuaternion.set(data.rotationQuaternion.x, data.rotationQuaternion.y, data.rotationQuaternion.z, data.rotationQuaternion.w);
          } else if (data.rotation) {
              entity.view.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
          }
          entity.view.scaling.set(data.scaling.x, data.scaling.y, data.scaling.z);
          entity.syncTransformFromView();
      }
  }
}