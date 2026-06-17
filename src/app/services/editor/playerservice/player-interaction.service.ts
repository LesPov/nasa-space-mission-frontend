import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class PlayerInteractionService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);

  public lastInteractDistance: number | null = null;
  public lastInteractionProbePoint: Vector3 | null = null;

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getRootProxyCollider(rootMesh: AbstractMesh): AbstractMesh | null {
    return this.state.proxyColliders.find(p => p.parent === rootMesh || p.name === `proxyCol_${rootMesh.name}`) ?? null;
  }

  private getClosestPointOnMeshBounds(mesh: AbstractMesh, point: Vector3): Vector3 | null {
    try {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      return new Vector3(
        this.clamp(point.x, bounds.minimumWorld.x, bounds.maximumWorld.x),
        this.clamp(point.y, bounds.minimumWorld.y, bounds.maximumWorld.y),
        this.clamp(point.z, bounds.minimumWorld.z, bounds.maximumWorld.z)
      );
    } catch {
      return null;
    }
  }

  private getInteractionProbePoint(view: 'FPS' | 'TPS', jugador: Mesh, activeCamera: any, entity: GameEntity): Vector3 {
    if (view === 'FPS') {
      return activeCamera?.position ? activeCamera.position.clone() : jugador.getAbsolutePosition().clone();
    }
    jugador.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(
      new Vector3(entity.collider?.offsetX ?? 0, entity.collider?.offsetY ?? 0, entity.collider?.offsetZ ?? 0),
      jugador.getWorldMatrix()
    );
  }

  private getInteractionDistanceToTarget(targetMesh: AbstractMesh, probePoint: Vector3 | null): number {
    if (!probePoint || !targetMesh) return Number.POSITIVE_INFINITY;
    const shapeMesh = this.getRootProxyCollider(targetMesh) ?? targetMesh;
    const closest = this.getClosestPointOnMeshBounds(shapeMesh, probePoint);
    return closest ? Vector3.Distance(probePoint, closest) : Vector3.Distance(probePoint, targetMesh.getAbsolutePosition());
  }

  private getSelectionMaxDistance(isAdmin: boolean): number {
    let maxAdmin = 10000;
    let maxUser = 3;
    const playerEntity = this.state.jugadorActivo ? this.entityManager.getEntityByMesh(this.state.jugadorActivo) : null;
    if (playerEntity && playerEntity.selectionRange) {
        maxAdmin = playerEntity.selectionRange.fpsAdminMax;
        maxUser = playerEntity.selectionRange.fpsUserMax;
    }
    return isAdmin ? maxAdmin : maxUser;
  }

  private esObjetoInteractuable(entity: GameEntity): boolean {
    if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') return false; 
    if (entity.type === 'bubble') return true; 

    const mensaje = entity.interaction.mensaje?.trim() || '';
    const seqFPS = entity.interaction.interactSequenceIdFPS?.trim() || '';
    const seqTPS = entity.interaction.interactSequenceIdTPS?.trim() || '';
    const seqLeg = entity.interaction.interactSequenceId?.trim() || '';

    return (mensaje.length > 0 || seqFPS.length > 0 || seqTPS.length > 0 || seqLeg.length > 0);
  }

  public canActivateInteraction(targetEntity: GameEntity, view: 'FPS' | 'TPS' | null): boolean {
    if (!targetEntity || this.lastInteractDistance === null || !Number.isFinite(this.lastInteractDistance)) return false;
    const maxDist = view === 'FPS' ? (targetEntity.interaction.interactDistanceFPS ?? 3.0) : (targetEntity.interaction.interactDistanceTPS ?? 5.0);
    return this.lastInteractDistance <= maxDist;
  }

  public comprobarInteracciones(entity: GameEntity, activeCamera: any, viewMode: 'FPS' | 'TPS'): void {
    const jugador = entity.view as Mesh;
    const scene = this.motor3d.scene;

    let hitInteractuable: GameEntity | null = null;
    let hoverSelectable: AbstractMesh | null = null;

    this.lastInteractDistance = null;
    this.lastInteractionProbePoint = this.getInteractionProbePoint(viewMode, jugador, activeCamera, entity);

    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (viewMode === 'FPS') {
      const centerRay = activeCamera.getForwardRay(10000);

      const hitCross = scene.pickWithRay(centerRay, (m) => {
        if (!m.isPickable || !m.isVisible) return false;
        
        const targetEntity = this.entityManager.getEntityByMesh(m);
        if (targetEntity && (targetEntity.type === 'trigger' || targetEntity.type === 'trigger_compuesto')) return false; 
        
        if (m === jugador || m.isDescendantOf(jugador)) return false;

        const nameStr = m.name.toLowerCase();
        if (
          nameStr.includes('proxycol') || nameStr.includes('suelo') || nameStr.includes('skybox') ||
          nameStr.includes('highlight') || nameStr.includes('gizmo') || nameStr.includes('debug') ||
          nameStr.includes('fogshell') || nameStr.includes('fogwall')
        ) return false;

        return true;
      });

      if (hitCross && hitCross.hit && hitCross.pickedMesh) {
        let current: any = hitCross.pickedMesh;
        let rootEntity: GameEntity | undefined = undefined;
        
        // 🔥 LÓGICA DE RESOLUCIÓN ESC: Buscamos la primera entidad lógica en el árbol
        while (current && current.name !== '__root__') {
            rootEntity = this.entityManager.getEntityByMesh(current);
            if (rootEntity) break;
            current = current.parent;
        }
        
        if (rootEntity && rootEntity.view) {
            const selectionDistance = this.getInteractionDistanceToTarget(rootEntity.view, this.lastInteractionProbePoint);
            this.lastInteractDistance = selectionDistance;

            const selectionMax = this.getSelectionMaxDistance(isAdmin);
            const interactMax = rootEntity.interaction.interactDistanceFPS ?? 3.0;
            const isInteractable = this.esObjetoInteractuable(rootEntity);

            if (isAdmin) {
              if (selectionDistance <= selectionMax) hoverSelectable = rootEntity.view;
              if (isInteractable && selectionDistance <= interactMax) hitInteractuable = rootEntity;
            } else {
              if (isInteractable && selectionDistance <= interactMax) {
                hoverSelectable = rootEntity.view;
                hitInteractuable = rootEntity;
              }
            }
        }
      }
    } else {
      let closestEntity: GameEntity | null = null;
      let closestDist = Number.POSITIVE_INFINITY;
      const playerProbe = this.lastInteractionProbePoint;

      this.entityManager.getAllEntities().forEach(e => {
        if (e.uid === entity.uid) return;
        if (e.type === 'trigger' || e.type === 'trigger_compuesto') return;
        
        const mesh = e.view as AbstractMesh;
        if (!mesh || !mesh.isVisible || !mesh.isPickable) return;

        const selectionDistance = this.getInteractionDistanceToTarget(mesh, playerProbe);
        const selectionMax = this.getSelectionMaxDistance(isAdmin);
        const isInteractable = this.esObjetoInteractuable(e);

        if (isInteractable) {
          if (e.type !== 'bubble') {
            const interactMax = e.interaction.interactDistanceTPS ?? 5.0;
            if (selectionDistance <= interactMax && selectionDistance < closestDist) {
              closestDist = selectionDistance;
              closestEntity = e;
            }
          }
        } else if (isAdmin && selectionDistance <= selectionMax && selectionDistance < closestDist) {
          closestDist = selectionDistance;
          closestEntity = e;
        }
      });

      if (closestEntity && (closestEntity as GameEntity).view) {
        hoverSelectable = (closestEntity as GameEntity).view;
        this.lastInteractDistance = closestDist;
        if (this.esObjetoInteractuable(closestEntity)) {
          hitInteractuable = closestEntity;
        }
      }
    }

    // Le avisamos a TODOS los modelos si están siendo "Hovereados"
    this.entityManager.getAllEntities().forEach(e => {
        e.isHovered = (e.view === hoverSelectable);
    });

    let showE = false;
    let showI = false;

    if (hitInteractuable) {
      const canInteractNow = this.canActivateInteraction(hitInteractuable, this.state.modoVistaPrueba);

      const seqIdForView = this.state.modoVistaPrueba === 'FPS'
        ? (hitInteractuable.interaction.interactSequenceIdFPS || hitInteractuable.interaction.interactSequenceId)
        : (hitInteractuable.interaction.interactSequenceIdTPS || hitInteractuable.interaction.interactSequenceId);

      const mensajeParaMostrar = hitInteractuable.interaction.mensaje || '';

      if (hitInteractuable.type === 'bubble') {
        showE = canInteractNow; 
      } else if (hitInteractuable.type === 'video_plane') {
        showE = canInteractNow; 
      } else {
        showE = !!seqIdForView && seqIdForView.trim() !== '' && canInteractNow;
      }
      
      showI = !!mensajeParaMostrar && mensajeParaMostrar.trim() !== '' && canInteractNow && hitInteractuable.type !== 'bubble';
    }

    if (this.state.targetInteractuable() !== hitInteractuable) {
      this.state.targetInteractuable.set(hitInteractuable as any);
    }

    if (this.state.mirandoObjetoInteractuable() !== !!hoverSelectable) {
      this.state.mirandoObjetoInteractuable.set(!!hoverSelectable);
    }

    if (this.state.objetoHovereado() !== hoverSelectable) {
      this.state.objetoHovereado.set(hoverSelectable);
    }

    if (this.state.showToastE() !== showE) {
      this.state.showToastE.set(showE);
    }

    if (this.state.showToastI() !== showI) {
      this.state.showToastI.set(showI);
    }
  }

  public abrirMensajeInteractivo(entity: GameEntity, resetMovementCallback: () => void): void {
    this.state.playState.set('INTERACTING');
    this.state.objetoInteractuado.set(entity);
    this.state.objetoSeleccionado.set(entity.view);
    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.ratonBloqueado.set(false);

    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {}

    resetMovementCallback();
  }
}