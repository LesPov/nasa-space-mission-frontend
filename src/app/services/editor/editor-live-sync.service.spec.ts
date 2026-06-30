// src/app/services/editor/editor-live-sync.service.ts
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Quaternion } from '@babylonjs/core';
import { WindowSyncService } from '../../core/services/window-sync.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { CoreSceneLoaderService } from '../../core/engine/scene/utils/core-scene-loader.service';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { SceneLoadPayload, SceneSavePayload } from '../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class EditorLiveSyncService {
  private windowSync = inject(WindowSyncService);
  private entityManager = inject(EntityManagerService);
  private sceneLoader = inject(CoreSceneLoaderService);

  // ==========================================
  // ORIGEN (EDITOR BROADCAST)
  // ==========================================

  public broadcastMapData(payload: SceneSavePayload & { uiSettings?: any, forceFullReboot?: boolean }): void {
    this.windowSync.broadcast({ type: 'SYNC_MAP_DATA', payload });
  }

  public broadcastLiveTransform(entity: GameEntity, mesh: AbstractMesh): void {
    this.windowSync.broadcast({
      type: 'SYNC_TRANSFORM_LIVE',
      payload: {
        uid: entity.uid,
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        rotationQuaternion: mesh.rotationQuaternion 
          ? { x: mesh.rotationQuaternion.x, y: mesh.rotationQuaternion.y, z: mesh.rotationQuaternion.z, w: mesh.rotationQuaternion.w } 
          : null,
        scaling: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z }
      }
    });
  }

  // ==========================================
  // RECEPTOR (RUNTIME / JUEGO)
  // ==========================================

  public requiresFullReboot(payload: any): boolean {
    return !!payload?.forceFullReboot;
  }

  public async applyDelta(payload: any, currentEpisode: any): Promise<any> {
    if (this.requiresFullReboot(payload)) {
      return currentEpisode; 
    }

    if (payload.deletedObjects) {
      payload.deletedObjects.forEach((uid: string) => this.entityManager.removeEntity(uid));
    }
    if (payload.deletedTriggers) {
      payload.deletedTriggers.forEach((uid: string) => this.entityManager.removeEntity(uid));
    }

    const loadPayload: SceneLoadPayload = {
      sceneObjectsDelta: payload.sceneObjectsDelta || [],
      triggersDelta: payload.triggersDelta || [],
      cinematicsDelta: payload.cinematicsDelta || [],
      environmentSettings: payload.environmentSettings,
      uiSettings: payload.uiSettings
    };

    await this.sceneLoader.loadSceneFromData(loadPayload);

    const updatedEpisode = { ...currentEpisode };
    if (payload.uiSettings) {
      updatedEpisode.uiSettings = payload.uiSettings;
    }

    return updatedEpisode;
  }

  public applyTransformLive(payload: any): void {
    const entity = this.entityManager.getEntityByUid(payload.uid);
    if (!entity || !entity.view) return;

    const mesh = entity.view as AbstractMesh;

    entity.transform.position = { ...payload.position };
    entity.transform.scale = { ...payload.scaling };

    mesh.position.set(payload.position.x, payload.position.y, payload.position.z);
    mesh.scaling.set(payload.scaling.x, payload.scaling.y, payload.scaling.z);

    if (payload.rotationQuaternion) {
      if (!mesh.rotationQuaternion) mesh.rotationQuaternion = new Quaternion();
      mesh.rotationQuaternion.set(
        payload.rotationQuaternion.x,
        payload.rotationQuaternion.y,
        payload.rotationQuaternion.z,
        payload.rotationQuaternion.w
      );
      const euler = mesh.rotationQuaternion.toEulerAngles();
      entity.transform.rotation = { x: euler.x, y: euler.y, z: euler.z };
    } else {
      mesh.rotationQuaternion = null;
      mesh.rotation.set(payload.rotation.x, payload.rotation.y, payload.rotation.z);
      entity.transform.rotation = { ...payload.rotation };
    }

    entity.isDirty = true;
    entity.syncToView();
  }

  // Métodos de compatibilidad legacy para que ningún componente estalle en transición
  public async handleLiveSync(payload: any, currentEpisode: any): Promise<any> {
    return this.applyDelta(payload, currentEpisode);
  }

  public handleLiveTransform(payload: any): void {
    this.applyTransformLive(payload);
  }
}