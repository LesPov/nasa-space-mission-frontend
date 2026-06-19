
import { Injectable } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from './game.entity';

@Injectable({ providedIn: 'root' })
export class EntityManagerService {
  private entitiesByUid = new Map<string, GameEntity>();
  private entitiesByMesh = new Map<AbstractMesh, GameEntity>();

  // 🔥 DIRTY TRACKING: Mantener registro de lo que se eliminó para el Backend Delta Update
  public deletedObjects: string[] = [];
  public deletedTriggers: string[] = [];

  public addEntity(entity: GameEntity): void {
    this.entitiesByUid.set(entity.uid, entity);
    if (entity.view) {
      this.entitiesByMesh.set(entity.view, entity);
    }
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
    return Array.from(this.entitiesByUid.values());
  }

  public getEntitiesByRol(rol: string): GameEntity[] {
    return this.getAllEntities().filter(e => e.rol === rol);
  }

  public clearDeletedRecords(): void {
    this.deletedObjects = [];
    this.deletedTriggers = [];
  }

  public clearDirtyFlags(): void {
    this.entitiesByUid.forEach(e => e.isDirty = false);
  }

  public clear(): void {
    this.entitiesByUid.forEach(entity => entity.destroyView());
    this.entitiesByUid.clear();
    this.entitiesByMesh.clear();
    this.clearDeletedRecords();
  }
}