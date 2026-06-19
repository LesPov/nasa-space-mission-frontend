import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Tags } from '@babylonjs/core';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { InputOrchestratorService } from './input-orchestrator.service';

@Injectable({ providedIn: 'root' })
export class PlayerInteractionService {
  private motor3d = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private inputOrchestrator = inject(InputOrchestratorService);

  public currentTarget: GameEntity | null = null;
  public canInteract: boolean = false;
  public canInspect: boolean = false;
  public currentHoveredMesh: AbstractMesh | null = null;

  public lastInteractDistance: number | null = null;
  public lastInteractionProbePoint: Vector3 | null = null;
  
  private isEnabled: boolean = false;

  public enable(): void { this.isEnabled = true; }
  public disable(): void { this.isEnabled = false; }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getRootProxyCollider(rootMesh: AbstractMesh): AbstractMesh | null {
    // 🔥 Uso directo de queries de Babylon, sin GameSession
    const scene = this.motor3d.scene;
    const proxies = scene.getMeshesByTags("proxy_collider");
    return proxies.find(p => p.parent === rootMesh) ?? null;
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

  private esObjetoInteractuable(entity: GameEntity): boolean {
    if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') return false; 
    if (entity.type === 'bubble') return true; 

    const mensaje = entity.interaction.mensaje?.trim() || '';
    const seqFPS = entity.interaction.interactSequenceIdFPS?.trim() || '';
    const seqTPS = entity.interaction.interactSequenceIdTPS?.trim() || '';
    const seqLeg = entity.interaction.interactSequenceId?.trim() || '';

    return (mensaje.length > 0 || seqFPS.length > 0 || seqTPS.length > 0 || seqLeg.length > 0);
  }

  public canActivateInteraction(targetEntity: GameEntity, view: 'FPS' | 'TPS'): boolean {
    if (!targetEntity || this.lastInteractDistance === null || !Number.isFinite(this.lastInteractDistance)) return false;
    const maxDist = view === 'FPS' ? (targetEntity.interaction.interactDistanceFPS ?? 3.0) : (targetEntity.interaction.interactDistanceTPS ?? 5.0);
    return this.lastInteractDistance <= maxDist;
  }

  public comprobarInteracciones(entity: GameEntity, activeCamera: any, viewMode: 'FPS' | 'TPS'): void {
    if (!this.isEnabled) {
      this.currentTarget = null;
      this.canInteract = false;
      this.canInspect = false;
      this.currentHoveredMesh = null;
      return;
    }

    const jugador = entity.view as Mesh;
    const scene = this.motor3d.scene;

    let hitInteractuable: GameEntity | null = null;
    let hoverSelectable: AbstractMesh | null = null;

    this.lastInteractDistance = null;
    this.lastInteractionProbePoint = this.getInteractionProbePoint(viewMode, jugador, activeCamera, entity);

    if (viewMode === 'FPS') {
      const centerRay = activeCamera.getForwardRay(10000);

      const hitCross = scene.pickWithRay(centerRay, (m) => {
        if (!m.isPickable || !m.isVisible) return false;
        
        const targetEntity = this.entityManager.getEntityByMesh(m);
        if (targetEntity && (targetEntity.type === 'trigger' || targetEntity.type === 'trigger_compuesto')) return false; 
        
        if (m === jugador || m.isDescendantOf(jugador)) return false;

        if (Tags.MatchesQuery(m, "system_element || fog_element || ignore_raycast || editor_only || invisible_floor")) return false;

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

            const interactMax = rootEntity.interaction.interactDistanceFPS ?? 3.0;
            const isInteractable = this.esObjetoInteractuable(rootEntity);

            if (isInteractable && selectionDistance <= interactMax) {
              hoverSelectable = rootEntity.view;
              hitInteractuable = rootEntity;
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
        const isInteractable = this.esObjetoInteractuable(e);

        if (isInteractable && e.type !== 'bubble') {
            const interactMax = e.interaction.interactDistanceTPS ?? 5.0;
            if (selectionDistance <= interactMax && selectionDistance < closestDist) {
              closestDist = selectionDistance;
              closestEntity = e;
            }
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

    let showE = false;
    let showI = false;

    if (hitInteractuable) {
      const canInteractNow = this.canActivateInteraction(hitInteractuable, viewMode);

      const seqIdForView = viewMode === 'FPS'
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

    if (this.currentTarget !== hitInteractuable || this.canInteract !== showE || this.canInspect !== showI || this.currentHoveredMesh !== hoverSelectable) {
      this.currentTarget = hitInteractuable;
      this.canInteract = showE;
      this.canInspect = showI;
      this.currentHoveredMesh = hoverSelectable;
      
      // 🔥 Actualizamos el InteractionRuntimeComponent
      if (hitInteractuable && hitInteractuable.interactionRuntime) {
         hitInteractuable.interactionRuntime.isHoveredByPlayer = true;
      }

      this.eventBus.emit({ 
        type: 'ObjectFocused', 
        payload: { entity: hitInteractuable, mesh: hoverSelectable, canInteract: showE, canInspect: showI } 
      });
    }
  }

  public abrirMensajeInteractivo(entity: GameEntity, resetMovementCallback: () => void): void {
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: true });
    this.inputOrchestrator.unlockPointer();
    resetMovementCallback();
  }

  public cerrarMensajeInteractivo(): void {
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.inputOrchestrator.lockPointer();
  }
}