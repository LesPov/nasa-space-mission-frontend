
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

  /**
   * Obtiene la entidad lógica a partir de la malla de Babylon.
   * Resuelve el puente vital del ECS.
   */
  public getEntityByMesh(mesh: AbstractMesh | null | undefined): GameEntity | undefined {
    if (!mesh) return undefined;
    // Búsqueda en O(1) real.
    let entity = this.entitiesByMesh.get(mesh);
    // Fallback por si la malla fue clonada o re-bundeada de forma atípica
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

  public clear(): void {
    this.entitiesByUid.forEach(entity => entity.destroyView());
    this.entitiesByUid.clear();
    this.entitiesByMesh.clear();
  }
}