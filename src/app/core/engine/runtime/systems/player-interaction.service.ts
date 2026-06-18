
import { Injectable, inject, Injector } from '@angular/core';
import { AbstractMesh, Mesh, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { GameSession } from '../game-session';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';

@Injectable({ providedIn: 'root' })
export class PlayerInteractionService {
  private motor3d = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private injector = inject(Injector);
 
  private get session(): GameSession { 
    return this.injector.get(GameSession); 
  }

  public currentTarget: GameEntity | null = null;
  public canInteract: boolean = false;
  public canInspect: boolean = false;
  public currentHoveredMesh: AbstractMesh | null = null;

  public lastInteractDistance: number | null = null;
  public lastInteractionProbePoint: Vector3 | null = null;

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getRootProxyCollider(rootMesh: AbstractMesh): AbstractMesh | null {
    return this.session.proxyColliders.find(p => p.parent === rootMesh || p.name === `proxyCol_${rootMesh.name}`) ?? null;
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
    const playerEntity = this.session.activePlayerEntity();
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

    const isAdmin = this.session.isAdminSession();

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

    this.entityManager.getAllEntities().forEach(e => {
        e.isHovered = (e.view === hoverSelectable);
    });

    let showE = false;
    let showI = false;

    if (hitInteractuable) {
      const canInteractNow = this.canActivateInteraction(hitInteractuable, this.session.cameraView());

      const seqIdForView = this.session.cameraView() === 'FPS'
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

    // 🔥 Emitir eventos limpios en caso de cambio de estado interactivo
    if (this.currentTarget !== hitInteractuable || this.canInteract !== showE || this.canInspect !== showI || this.currentHoveredMesh !== hoverSelectable) {
      this.currentTarget = hitInteractuable;
      this.canInteract = showE;
      this.canInspect = showI;
      this.currentHoveredMesh = hoverSelectable;
      this.eventBus.emit({ 
        type: 'ObjectFocused', 
        payload: { entity: hitInteractuable, mesh: hoverSelectable, canInteract: showE, canInspect: showI } 
      });
    }
  }

  public abrirMensajeInteractivo(entity: GameEntity, resetMovementCallback: () => void): void {
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: true });
    this.session.pointerLocked.set(false);

    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {}

    resetMovementCallback();
  }

  public cerrarMensajeInteractivo(): void {
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      canvas.focus();
      try { canvas.requestPointerLock(); } catch {}
    }
  }
}