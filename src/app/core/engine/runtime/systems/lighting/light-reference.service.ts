import { Injectable, inject } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';
import { GameMode } from '../../../session/game-mode.model';
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
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);

  private static readonly _fallbackPos = Vector3.Zero();
  private static readonly _tempActorPos = Vector3.Zero();

  // Caché de posiciones mundiales de los actores para detectar movimiento
  private lastActorPositions = new Map<string, Vector3>();
  private lastActorCount = 0;

  /**
   * Resuelve todas las entidades de la escena que actúan como Actores válidos de referencia:
   * Player, Spawn Points, NPCs, Políticos, Militares o cualquier Character configurado.
   */
  public getValidActorEntities(): GameEntity[] {
    const all = this.entityManager.getAllEntities();
    const actors: GameEntity[] = [];

    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.isManuallyHidden) continue;

      if (
        e.rol === 'player' ||
        e.rol === 'spawn_point' ||
        e.rol === 'npc' ||
        e.rol === 'politico' ||
        e.rol === 'militar' ||
        e.hasComponent('characterConfig')
      ) {
        actors.push(e);
      }
    }

    // Ordenar priorizando Player principal primero, luego Spawn Point, luego NPCs
    return actors.sort((a, b) => {
      const score = (ent: GameEntity) => {
        if (ent.rol === 'player') return 0;
        if (ent.rol === 'spawn_point') return 1;
        if (ent.hasComponent('characterConfig')) return 2;
        return 3;
      };
      return score(a) - score(b);
    });
  }

  /**
   * Obtiene la posición mundial real de un actor, considerando su jerarquía o centro visual.
   */
  public getActorWorldPosition(entity: GameEntity, out: Vector3): Vector3 {
    if (entity.view && !entity.view.isDisposed()) {
      entity.getVisualCenterAbsoluteToRef(out);
      return out;
    }
    out.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
    return out;
  }

  /**
   * Determina si algún actor se ha movido más allá del umbral espacial (epsilon),
   * o si se han creado / eliminado actores en la escena.
   */
  public hasActorsMoved(threshold: number = 0.05): boolean {
    const actors = this.getValidActorEntities();
    if (actors.length !== this.lastActorCount) {
      this.updateActorPositionsCache(actors);
      return true;
    }

    const thresholdSq = threshold * threshold;
    let moved = false;

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      this.getActorWorldPosition(actor, LightReferenceService._tempActorPos);
      const cached = this.lastActorPositions.get(actor.uid);

      if (!cached || Vector3.DistanceSquared(cached, LightReferenceService._tempActorPos) > thresholdSq) {
        moved = true;
        break;
      }
    }

    if (moved) {
      this.updateActorPositionsCache(actors);
    }

    return moved;
  }

  private updateActorPositionsCache(actors: GameEntity[]): void {
    this.lastActorPositions.clear();
    this.lastActorCount = actors.length;

    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      const pos = new Vector3();
      this.getActorWorldPosition(a, pos);
      this.lastActorPositions.set(a.uid, pos);
    }
  }

  /**
   * Encuentra el Actor más cercano a una posición de luz dada y calcula su distancia euclidiana exacta.
   */
  public getClosestActorForLight(lightWorldPos: Vector3): ClosestActorResult {
    const actors = this.getValidActorEntities();

    // 🔥 FIX BUG 1: Si no hay actores, retornar una distancia infinita para que 
    // las luces de proximidad aborten su activación instantáneamente.
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
   * Resuelve la posición de referencia global principal.
   * En MODO EDITOR: Resuelve SIEMPRE la posición del Actor principal (Player/Spawn/NPC), NUNCA la cámara.
   * En MODO RUNTIME: Respeta el modo configurado ('PLAYER', 'CAMERA' o 'AUTO').
   */
  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
    const mode = this.context.mode();
    const isEditorPure = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    // REGLA FUNDAMENTAL: En el Editor la referencia son los Actores (Player/Spawn/NPC), JAMÁS la cámara de navegación.
    if (isEditorPure) {
      const actors = this.getValidActorEntities();
      if (actors.length > 0) {
        return this.getActorWorldPosition(actors[0], LightReferenceService._tempActorPos);
      }
      return LightReferenceService._fallbackPos;
    }

    // Modo Runtime (Test Live / Final User)
    const refMode = customMode || 'AUTO';

    if (refMode === 'CAMERA') {
      const camera = this.ownership.getCamera();
      if (camera) {
        camera.computeWorldMatrix();
        return camera.globalPosition;
      }
      return LightReferenceService._fallbackPos;
    }

    const playerEntity = this.context.activePlayerEntity();
    if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
      return playerEntity.view.getAbsolutePosition();
    }

    const camera = this.ownership.getCamera();
    if (camera) {
      camera.computeWorldMatrix();
      return camera.globalPosition;
    }

    return LightReferenceService._fallbackPos;
  }
}