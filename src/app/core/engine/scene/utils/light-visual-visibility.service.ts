import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Tags, Node } from '@babylonjs/core';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';

@Injectable({ providedIn: 'root' })
export class LightVisualVisibilityService {
  private entityManager = inject(EntityManagerService);
  private gameContext = inject(GameContextService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  /**
   * Colección de mallas visuales actualmente visibles.
   */
  private activeVisualMeshes = new Set<AbstractMesh>();

  /**
   * Determina si el contexto actual permite mostrar representaciones visuales de edición.
   */
  public canShowLightVisuals(): boolean {
    const mode = this.gameContext.mode();
    return mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
  }

  /**
   * Resuelve el UID de la entidad a partir del mesh seleccionado o de sus metadatos.
   */
  public resolveSelectedEntityUid(selectedNode: Node | null): string | null {
    if (!selectedNode) return null;

    if (selectedNode instanceof AbstractMesh) {
      if ((selectedNode as any).metadata?.entityUid) {
        return (selectedNode as any).metadata.entityUid;
      }
      const entity = this.entityManager.getEntityByMesh(selectedNode);
      if (entity) return entity.uid;
    }

    return null;
  }

  /**
   * Sincroniza la visibilidad de todos los cuerpos visuales de luz de la escena.
   * Regla de Oro: Solo la luz directamente seleccionada muestra su cuerpo visual en modo Editor.
   */
  public syncAllLightVisuals(selectedNode: Node | null): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    const allowVisuals = this.canShowLightVisuals();
    const selectedEntityUid = allowVisuals ? this.resolveSelectedEntityUid(selectedNode) : null;

    // Verificar si la entidad seleccionada es realmente una luz
    let targetLightUid: string | null = null;
    if (selectedEntityUid) {
      const entity = this.entityManager.getEntityByUid(selectedEntityUid);
      if (entity && entity.type.startsWith('light_')) {
        targetLightUid = entity.uid;
      }
    }

    const nextVisibleMeshes = new Set<AbstractMesh>();

    scene.meshes.forEach((mesh) => {
      const isLightVisual =
        Tags.MatchesQuery(mesh, 'light_visual') || (mesh as any).metadata?.isLightVisual;

      if (!isLightVisual) return;

      const entityUid = (mesh as any).metadata?.entityUid || mesh.parent?.metadata?.entityUid;
      const isThisLightSelected = !!targetLightUid && entityUid === targetLightUid;

      if (isThisLightSelected) {
        nextVisibleMeshes.add(mesh);
        this.setMeshVisualState(mesh, true);
      } else {
        this.setMeshVisualState(mesh, false);
      }
    });

    this.activeVisualMeshes = nextVisibleMeshes;
  }

  /**
   * Modifica atómicamente la visibilidad y pickabilidad de una malla visual y de sus hijos (conos, flechas, etc.).
   */
  private setMeshVisualState(mesh: AbstractMesh, visible: boolean): void {
    if (!mesh || mesh.isDisposed()) return;

    mesh.isVisible = visible;
    mesh.isPickable = visible;

    if (visible && mesh.parent) {
      (mesh.parent as AbstractMesh).computeWorldMatrix?.(true);
      mesh.computeWorldMatrix(true);
    }

    const children = mesh.getChildMeshes(false);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (Tags.MatchesQuery(child, 'light_visual') || (child as any).metadata?.isLightVisual) {
        child.isVisible = visible;
        child.isPickable = visible;
      }
    }
  }

  /**
   * Oculta inmediatamente todos los cuerpos visuales de luces (usado al entrar a Test Live).
   */
  public hideAll(): void {
    this.syncAllLightVisuals(null);
  }
}