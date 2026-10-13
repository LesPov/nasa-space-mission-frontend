// file: src/app/core/engine/runtime/systems/lighting/light-reference.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh } from '@babylonjs/core';
import { GameContextService } from '../../../session/game-context.service';
import { CameraOwnershipService } from '../../cameras/camera-ownership.service';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity } from '../../../entities/game.entity';
import { EditorStateService } from '../../../../../services/editor/editor-state.service';
import { GameMode } from '../../../session/game-mode.model';

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
  private stateSvc = inject(EditorStateService);

  private static readonly _fallbackPos = Vector3.Zero();

  public getValidActorEntities(): GameEntity[] {
    const isEditor = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;

    // 1. En modo Editor: si el creador tiene seleccionado al jugador o un spawn marker, es la referencia prioritaria
    if (isEditor) {
      const selected = this.stateSvc.objetoSeleccionado() as AbstractMesh | null;
      if (selected) {
        const selEntity = this.entityManager.getEntityByMesh(selected);
        if (selEntity && (selEntity.rol === 'player' || selEntity.hasComponent('characterConfig') || selEntity.rol === 'spawn_point')) {
          return [selEntity];
        }
      }
    }

    // 2. Jugador activo en el contexto
    const activePlayer = this.context.activePlayerEntity();
    if (activePlayer && activePlayer.view && !activePlayer.view.isDisposed()) {
      return [activePlayer];
    }

    // 3. Búsqueda explícita de la entidad con rol 'player' o 'characterConfig' en la escena
    const all = this.entityManager.getAllEntities();
    const primaryActor = all.find(e => !e.isManuallyHidden && (e.rol === 'player' || e.hasComponent('characterConfig')));
    if (primaryActor && primaryActor.view && !primaryActor.view.isDisposed()) {
      return [primaryActor];
    }

    // 4. Actores secundarios / NPCs
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

    if (actors.length > 0) {
      return actors;
    }

    // 5. Spawn points como fallback de posición inicial
    for (let i = 0; i < all.length; i++) {
      if (!all[i].isManuallyHidden && all[i].rol === 'spawn_point') {
        actors.push(all[i]);
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

  public getReferencePosition(customMode?: 'AUTO' | 'CAMERA' | 'PLAYER'): Vector3 {
    const isEditor = this.context.mode() === GameMode.EDITOR || this.context.mode() === GameMode.EDITING_IN_GAME;

    // A. Si se solicita explícitamente la cámara
    if (customMode === 'CAMERA') {
      const camera = this.ownership.getCamera();
      if (camera) {
        camera.computeWorldMatrix();
        return camera.globalPosition.clone();
      }
    }

    // B. En modo Editor: prioridad máxima al Player existente en la escena para inicializar Frame 0
    if (isEditor) {
      // 1. Objeto seleccionado si es player o actor
      const selected = this.stateSvc.objetoSeleccionado() as AbstractMesh | null;
      if (selected) {
        const selEntity = this.entityManager.getEntityByMesh(selected);
        if (selEntity && (selEntity.rol === 'player' || selEntity.hasComponent('characterConfig') || selEntity.rol === 'spawn_point')) {
          const pos = new Vector3();
          this.getActorWorldPosition(selEntity, pos);
          return pos;
        }
      }

      // 2. Jugador autoral en la escena (independientemente de si está seleccionado o no)
      const all = this.entityManager.getAllEntities();
      const playerEntity = all.find(e => !e.isManuallyHidden && (e.rol === 'player' || e.hasComponent('characterConfig')));
      if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
        const pos = new Vector3();
        this.getActorWorldPosition(playerEntity, pos);
        return pos;
      }

      // 3. Spawn point como posición inicial esperada del jugador
      const spawnEntity = all.find(e => !e.isManuallyHidden && e.rol === 'spawn_point');
      if (spawnEntity && spawnEntity.view && !spawnEntity.view.isDisposed()) {
        const pos = new Vector3();
        this.getActorWorldPosition(spawnEntity, pos);
        return pos;
      }
    }

    // C. Jugador activo en runtime / gameplay
    const playerEntity = this.context.activePlayerEntity();
    if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
      const pos = new Vector3();
      this.getActorWorldPosition(playerEntity, pos);
      return pos;
    }

    // D. Actores disponibles
    const actors = this.getValidActorEntities();
    if (actors.length > 0) {
      const pos = new Vector3();
      this.getActorWorldPosition(actors[0], pos);
      return pos;
    }

    // E. Fallback final a la cámara si no existe ningún actor en el mapa
    const camera = this.ownership.getCamera();
    if (camera) {
      if (camera.getScene() && !camera.getScene().isDisposed) {
        camera.computeWorldMatrix();
      }
      return camera.globalPosition.clone();
    }

    return LightReferenceService._fallbackPos.clone();
  }
}