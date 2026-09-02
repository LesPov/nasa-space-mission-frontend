// src/app/core/engine/runtime/rules/interactable-rules.service.ts

import { Injectable, inject } from '@angular/core';
import { GameEntity } from '../../entities/game.entity';
import { GameContextService } from '../../session/game-context.service';
import { AbstractMesh, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class InteractableRulesService {
  private context = inject(GameContextService);
  private entityManager = inject(EntityManagerService);

  public isInteractable(entity: GameEntity | undefined | null): boolean {
    if (!entity) return false;
    if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') return false;
    if (entity.type === 'bubble') return true;

    const mensaje = typeof entity.interaction?.mensaje === 'string' ? entity.interaction.mensaje.trim() : '';
    const seqFPS = typeof entity.interaction?.interactSequenceIdFPS === 'string' ? entity.interaction.interactSequenceIdFPS.trim() : '';
    const seqTPS = typeof entity.interaction?.interactSequenceIdTPS === 'string' ? entity.interaction.interactSequenceIdTPS.trim() : '';
    const seqLeg = typeof entity.interaction?.interactSequenceId === 'string' ? entity.interaction.interactSequenceId.trim() : '';

    return (mensaje.length > 0 || seqFPS.length > 0 || seqTPS.length > 0 || seqLeg.length > 0);
  }

  public isMeshIgnorable(mesh: AbstractMesh | null | undefined, activePlayerMesh?: AbstractMesh | null): boolean {
    if (!mesh) return true;
    if (Tags.MatchesQuery(mesh, "system_element || editor_only || fog_element || debug_element || proxy_collider || invisible_floor")) {
        return true;
    }

    if (activePlayerMesh && (mesh === activePlayerMesh || mesh.isDescendantOf(activePlayerMesh))) {
      return true;
    }

    const entity = this.entityManager.getEntityByMesh(mesh);
    const profile = this.context.authorityProfile();

    if (entity && (entity.type === 'trigger' || entity.type === 'trigger_compuesto')) {
        return !profile.canSeeTriggers; 
    }

    if (entity) {
        if (!profile.canSelectHidden && entity.visual?.isSelectable === false && !this.isInteractable(entity)) {
            return true;
        }
    }
    return false;
  }

  public canSelectInEditor(mesh: AbstractMesh | null): boolean {
    if (!mesh) return false;
    if (this.isMeshIgnorable(mesh)) return false;

    const entity = this.entityManager.getEntityByMesh(mesh);
    const selectable = entity?.visual?.isSelectable ?? true;
    const profile = this.context.authorityProfile();

    if (profile.canSelectHidden) return !!selectable;
    return false;
  }
}