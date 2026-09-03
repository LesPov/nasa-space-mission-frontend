// src/app/core/engine/runtime/systems/player-interaction.service.ts

import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Ray } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { InputOrchestratorService } from './input-orchestrator.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { InteractableRulesService } from '../rules/interactable-rules.service';
import { PlayerSequenceService } from './player-sequence.service';
import { PlayerInputService } from './player-input.service';
import { PlayerBubbleService } from './player-bubble.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';

@Injectable({ providedIn: 'root' })
export class PlayerInteractionService implements IUpdatable {
  public id = 'PlayerInteractionSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private interactRules = inject(InteractableRulesService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);

  private sequenceSvc = inject(PlayerSequenceService);
  private inputSvc = inject(PlayerInputService);
  private bubbleSvc = inject(PlayerBubbleService);

  public currentTarget: GameEntity | null = null;
  public canInteract: boolean = false;
  public canInspect: boolean = false;
  public currentHoveredMesh: AbstractMesh | null = null;

  public lastInteractDistance: number | null = null;
  
  private isEnabled: boolean = false;

  private _centerRay = new Ray(Vector3.Zero(), new Vector3(0, 0, 1), 10000);
  private _probePoint = Vector3.Zero();
  private _forwardDir = new Vector3(0, 0, 1);
  private _interactTimer = 0;

  public enable(): void { this.isEnabled = true; }
  
  public disable(): void { 
    this.isEnabled = false; 
    // 🔥 FIX: Limpiar siempre si hay un target interactivo O una malla hovoreada (como una pared en modo Admin)
    if (this.currentTarget !== null || this.currentHoveredMesh !== null) {
      this.currentTarget = null;
      this.canInteract = false;
      this.canInspect = false;
      this.currentHoveredMesh = null;
      this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
      this.eventBus.emit({ type: 'MessageRequested', payload: null });
    }
  }

  public update(dtMs: number): void {
    const playerEntity = this.context.activePlayerEntity();
    const activeCamera = this.ownership.getCamera();
    if (!playerEntity || !activeCamera) {
      return;
    }

    this._interactTimer += dtMs;
    if (this._interactTimer >= 100) {
      this.comprobarInteracciones(playerEntity, activeCamera, this.context.cameraView());
      this._interactTimer = 0;
    }

    if (this.inputSvc.actionPressedThisFrame) {
      this.handleAction();
    }
    if (this.inputSvc.inspectPressedThisFrame) {
      this.handleInspect();
    }
  }
  
  private handleAction(): void {
    if (this.currentTarget && this.canInteract) {
      const target = this.currentTarget;
      const view = this.context.cameraView();

      if (target.type === 'bubble') {
        this.bubbleSvc.ejecutarBurbuja(target);
      }

      const seqId = view === 'FPS' ? target.interaction.interactSequenceIdFPS : target.interaction.interactSequenceIdTPS;
      const seqReal = seqId || target.interaction.interactSequenceId;
      
      if (seqReal) {
        const rawIds = seqReal.split(',').map(id => id.trim()).filter(Boolean);
        const idsToTrigger = [...new Set(rawIds)];

        idsToTrigger.forEach(sequenceId => {
           this.eventBus.emit({ type: 'SequenceTriggered', payload: { sequenceId } });
        });
      }
    }
  }

  private handleInspect(): void {
    if (this.currentTarget && this.canInspect) {
      this.abrirMensajeInteractivo(this.currentTarget, () => {
        const playerEntity = this.context.activePlayerEntity();
        if(playerEntity) {
          const state = playerEntity.playerRuntime.physicsState;
          state.isMoving = false;
          state.isRunning = false;
        }
      });
    }
  }
  
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getRootProxyCollider(rootMesh: AbstractMesh): AbstractMesh | null {
    const scene = this.motor3d.getScene();
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

  private updateInteractionProbePoint(view: 'FPS' | 'TPS', jugador: Mesh, activeCamera: any, entity: GameEntity): void {
    if (view === 'FPS') {
      if (activeCamera?.position) {
          this._probePoint.copyFrom(activeCamera.position);
      } else {
          this._probePoint.copyFrom(jugador.getAbsolutePosition());
      }
    } else {
      jugador.computeWorldMatrix(true);
      Vector3.TransformCoordinatesFromFloatsToRef(
        entity.collider?.offsetX ?? 0, entity.collider?.offsetY ?? 0, entity.collider?.offsetZ ?? 0,
        jugador.getWorldMatrix(),
        this._probePoint
      );
    }
  }

  private getInteractionDistanceToTarget(targetMesh: AbstractMesh, probePoint: Vector3): number {
    if (!targetMesh) return Number.POSITIVE_INFINITY;
    const shapeMesh = this.getRootProxyCollider(targetMesh) ?? targetMesh;
    const closest = this.getClosestPointOnMeshBounds(shapeMesh, probePoint);
    return closest ? Vector3.Distance(probePoint, closest) : Vector3.Distance(probePoint, targetMesh.getAbsolutePosition());
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
    const scene = this.motor3d.getScene();

    let hitInteractuable: GameEntity | null = null;
    let hoverSelectable: AbstractMesh | null = null;

    this.lastInteractDistance = null;
    this.updateInteractionProbePoint(viewMode, jugador, activeCamera, entity);

    if (viewMode === 'FPS') {
      const origin = activeCamera.globalPosition;
      
      if (activeCamera.getDirectionToRef) {
          activeCamera.getDirectionToRef(this._forwardDir, this._centerRay.direction);
      } else {
          this._centerRay.direction.copyFrom(activeCamera.getDirection(this._forwardDir));
      }
      
      this._centerRay.origin.copyFrom(origin);
      this._centerRay.length = 10000;

      const hitCross = scene.pickWithRay(this._centerRay, (m) => {
        if (!m.isPickable || (!m.isVisible && m.visibility === 0)) return false;
        if (this.interactRules.isMeshIgnorable(m, jugador)) return false;
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
            // 🔥 SOLUCIÓN DEL BUG: Se elimina el early return que dejaba atascado el estado
            if (rootEntity.type === 'trigger' || rootEntity.type === 'trigger_compuesto') {
                // Ignoramos triggers silenciosamente para que la limpieza final de la función se ejecute correctamente.
            } else {
                const selectionDistance = this.getInteractionDistanceToTarget(rootEntity.view, this._probePoint);
                this.lastInteractDistance = selectionDistance;

                const interactMax = rootEntity.interaction.interactDistanceFPS ?? 3.0;
                const isInteractable = this.interactRules.isInteractable(rootEntity);
                
                const profile = this.context.authorityProfile();
                let canAdminSelect = false;
                
                if (profile.canSelect && rootEntity.visual?.isSelectable !== false) {
                    const rangeCfg = entity.selectionRange?.fpsAdminMax ?? 10000;
                    if (selectionDistance <= rangeCfg) {
                        canAdminSelect = true;
                    }
                }

                if ((isInteractable && selectionDistance <= interactMax) || canAdminSelect) {
                  hoverSelectable = rootEntity.view;
                  if (isInteractable && selectionDistance <= interactMax) {
                      hitInteractuable = rootEntity;
                  }
                }
            }
        }
      }
    } else {
      let closestEntity: GameEntity | null = null;
      let closestDist = Number.POSITIVE_INFINITY;
      
      const entities = this.entityManager.getAllEntities();
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.uid === entity.uid) continue;
        
        const isInteractable = this.interactRules.isInteractable(e);
        if (!isInteractable) continue;
        
        const mesh = e.view as AbstractMesh;
        if (this.interactRules.isMeshIgnorable(mesh, jugador)) continue;

        const selectionDistance = this.getInteractionDistanceToTarget(mesh, this._probePoint);

        if (e.type !== 'bubble') {
            const interactMax = e.interaction.interactDistanceTPS ?? 5.0;
            if (selectionDistance <= interactMax && selectionDistance < closestDist) {
              closestDist = selectionDistance;
              closestEntity = e;
            }
        }
      }

      if (closestEntity && (closestEntity as GameEntity).view) {
        hoverSelectable = (closestEntity as GameEntity).view;
        this.lastInteractDistance = closestDist;
        if (this.interactRules.isInteractable(closestEntity)) {
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
      
      const entities = this.entityManager.getAllEntities();
      for (let i = 0; i < entities.length; i++) {
        if(entities[i].interactionRuntime) entities[i].interactionRuntime.isHoveredByPlayer = false;
      }

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