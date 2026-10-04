// file: src/app/core/engine/runtime/systems/lighting/light-reference.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity } from '../../../entities/game.entity';

export interface ClosestActorResult {
  actor: GameEntity | null;
  distance: number;
  actorPosition: Vector3;
}

@Injectable({ providedIn: 'root' })
export class LightReferenceService {
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private entityManager = inject(EntityManagerService);

  private static readonly _fallbackPos = Vector3.Zero();

  public getValidActorEntities(): GameEntity[] {
    const activePlayer = this.context.activePlayerEntity();
    if (activePlayer && activePlayer.view && !activePlayer.view.isDisposed()) {
      return [activePlayer];
    }

    const all = this.entityManager.getAllEntities();
    const actors: GameEntity[] = [];

    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.isManuallyHidden) continue;

      if (
        e.rol === 'player' ||
        e.hasComponent('characterConfig') ||
        e.rol === 'npc' ||
        e.rol === 'politico' ||
        e.rol === 'militar'
      ) {
        actors.push(e);
      }
    }

    if (actors.length === 0) {
      for (let i = 0; i < all.length; i++) {
        if (!all[i].isManuallyHidden && all[i].rol === 'spawn_point') {
          actors.push(all[i]);
        }
      }
    }

    return actors;
  }

  public getActorWorldPosition(entity: GameEntity, out: Vector3): Vector3 {
    if (entity.view && !entity.view.isDisposed()) {
      entity.getVisualCenterAbsoluteToRef(out);
      return out;
    }
    out.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
    return out;
  }

  public getClosestActorForLight(lightWorldPos: Vector3): ClosestActorResult {
    const actors = this.getValidActorEntities();

    if (actors.length === 0) {
      return {
        actor: null,
        distance: Number.MAX_VALUE,
        actorPosition: LightReferenceService._fallbackPos
      };
    }

    let closestActor: GameEntity = actors[0];
    let minDistance = Number.MAX_VALUE;
    const closestPos = new Vector3();
    const tempPos = new Vector3();

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      this.getActorWorldPosition(actor, tempPos);
      const d = Vector3.Distance(lightWorldPos, tempPos);

      if (d < minDistance) {
        minDistance = d;
        closestActor = actor;
        closestPos.copyFrom(tempPos);
      }
    }

    return {
      actor: closestActor,
      distance: minDistance,
      actorPosition: closestPos
    };
  }

  /**
   * Resuelve la posición del jugador en coordenadas mundiales reales.
   * En Editor Libre y Test Live, evalúa consistentemente contra el Player Runtime.
   */
  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
    const playerEntity = this.context.activePlayerEntity();
    if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
      const pos = new Vector3();
      this.getActorWorldPosition(playerEntity, pos);
      return pos;
    }

    const actors = this.getValidActorEntities();
    if (actors.length > 0) {
      const pos = new Vector3();
      this.getActorWorldPosition(actors[0], pos);
      return pos;
    }

    if (customMode === 'CAMERA') {
      const camera = this.ownership.getCamera();
      if (camera) {
        camera.computeWorldMatrix();
        return camera.globalPosition.clone();
      }
    }

    return LightReferenceService._fallbackPos.clone();
  }
}