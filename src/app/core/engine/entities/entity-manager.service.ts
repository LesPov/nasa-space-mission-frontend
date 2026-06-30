
import { Injectable } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from './game.entity';

@Injectable({ providedIn: 'root' })
export class EntityManagerService {
  private entitiesByUid = new Map<string, GameEntity>();
  private entitiesByMesh = new Map<AbstractMesh, GameEntity>();

  public deletedObjects: string[] = [];
  public deletedTriggers: string[] = [];

  // 🔥 OPTIMIZACIÓN: Caché estricto de arreglos de entidades para evitar GC frame-drops.
  private _entitiesArrayCache: GameEntity[] | null = null;

  public addEntity(entity: GameEntity): void {
    this.entitiesByUid.set(entity.uid, entity);
    if (entity.view) {
      this.entitiesByMesh.set(entity.view, entity);
    }
    this._entitiesArrayCache = null;
  }

  public removeEntity(uid: string): void {
    const entity = this.entitiesByUid.get(uid);
    if (entity) {
      if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') {
          this.deletedTriggers.push(entity.uid);
      } else {
          this.deletedObjects.push(entity.uid);
      }

      if (entity.view) {
        this.entitiesByMesh.delete(entity.view);
        entity.destroyView();
      }
      this.entitiesByUid.delete(uid);
      this._entitiesArrayCache = null;
    }
  }

  public getEntityByUid(uid: string): GameEntity | undefined {
    return this.entitiesByUid.get(uid);
  }

  public getEntityByMesh(mesh: AbstractMesh | null | undefined): GameEntity | undefined {
    if (!mesh) return undefined;
    let entity = this.entitiesByMesh.get(mesh);
    if (!entity && mesh.metadata?.entityUid) {
      entity = this.entitiesByUid.get(mesh.metadata.entityUid);
      if (entity) this.entitiesByMesh.set(mesh, entity);
    }
    return entity;
  }

  public getAllEntities(): GameEntity[] {
    if (!this._entitiesArrayCache) {
      this._entitiesArrayCache = Array.from(this.entitiesByUid.values());
    }
    return this._entitiesArrayCache;
  }

  public getEntitiesWithComponent(componentKey: string): GameEntity[] {
    const all = this.getAllEntities();
    const result: GameEntity[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].hasComponent(componentKey)) {
        result.push(all[i]);
      }
    }
    return result;
  }

  public clearDeletedRecords(): void {
    this.deletedObjects = [];
    this.deletedTriggers = [];
  }

  public clearDirtyFlags(): void {
    this.entitiesByUid.forEach(e => e.isDirty = false);
  }

  public clear(): void {
    const persistentEntities = new Map<string, GameEntity>();
    
    this.entitiesByUid.forEach(entity => {
      if (entity.isPersistent) {
        persistentEntities.set(entity.uid, entity);
      } else {
        if (entity.view) {
          this.entitiesByMesh.delete(entity.view);
        }
        entity.destroyView();
      }
    });

    this.entitiesByUid.clear();
    this.entitiesByMesh.clear();

    persistentEntities.forEach(entity => {
      this.addEntity(entity);
    });

    this.clearDeletedRecords();
    this._entitiesArrayCache = null;
  }
}