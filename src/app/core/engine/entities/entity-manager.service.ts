
import { Injectable } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from './game.entity';

@Injectable({ providedIn: 'root' })
export class EntityManagerService {
  private entitiesByUid = new Map<string, GameEntity>();
  private entitiesByMesh = new Map<AbstractMesh, GameEntity>();

  public addEntity(entity: GameEntity): void {
    this.entitiesByUid.set(entity.uid, entity);
    if (entity.view) {
      this.entitiesByMesh.set(entity.view, entity);
    }
  }

  public removeEntity(uid: string): void {
    const entity = this.entitiesByUid.get(uid);
    if (entity) {
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
    return this.entitiesByMesh.get(mesh);
  }

  public getAllEntities(): GameEntity[] {
    return Array.from(this.entitiesByUid.values());
  }

  public clear(): void {
    this.entitiesByUid.forEach(entity => entity.destroyView());
    this.entitiesByUid.clear();
    this.entitiesByMesh.clear();
  }
}
