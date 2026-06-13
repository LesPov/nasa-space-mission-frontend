
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Matrix } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { PlayerBubbleService } from './player-bubble';
 
@Injectable({ providedIn: 'root' })
export class PlayerInteractionService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private bubbleSvc = inject(PlayerBubbleService);

  public lastInteractDistance: number | null = null;
  public lastInteractionProbePoint: Vector3 | null = null;

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getRootProxyCollider(root: AbstractMesh): AbstractMesh | null {
    return this.state.proxyColliders.find(p => p.parent === root || p.name === `proxyCol_${root.name}`) ?? null;
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

  private getInteractionProbePoint(view: 'FPS' | 'TPS', jugador: Mesh, activeCamera: any, colMeta: any): Vector3 {
    if (view === 'FPS') {
      return activeCamera?.position ? activeCamera.position.clone() : jugador.getAbsolutePosition().clone();
    }
    jugador.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(
      new Vector3(colMeta?.offsetX ?? 0, colMeta?.offsetY ?? 0, colMeta?.offsetZ ?? 0),
      jugador.getWorldMatrix()
    );
  }

  private getInteractionDistanceToTarget(target: AbstractMesh, probePoint: Vector3 | null): number {
    if (!probePoint) return Number.POSITIVE_INFINITY;
    const shapeMesh = this.getRootProxyCollider(target) ?? target;
    const closest = this.getClosestPointOnMeshBounds(shapeMesh, probePoint);
    return closest ? Vector3.Distance(probePoint, closest) : Vector3.Distance(probePoint, target.getAbsolutePosition());
  }

  private getSelectionRange(): { fpsAdminMax: number; fpsUserMax: number } {
    const fallback = { fpsAdminMax: 10000, fpsUserMax: 3 };

    const candidates: any[] = [];
    if (this.state.jugadorActivo?.metadata) candidates.push(this.state.jugadorActivo.metadata);
    const selected = this.state.objetoSeleccionado() as AbstractMesh | null;
    if (selected?.metadata) candidates.push(selected.metadata);

    for (const meta of candidates) {
      const src = meta?.playerConfig?.selectionRange || meta?.selectionRange;
      if (!src) continue;

      const admin = Number(src.fpsAdminMax);
      const user = Number(src.fpsUserMax);

      return {
        fpsAdminMax: Number.isFinite(admin) && admin >= 0 ? admin : fallback.fpsAdminMax,
        fpsUserMax: Number.isFinite(user) && user >= 0 ? user : fallback.fpsUserMax
      };
    }

    return fallback;
  }

  private getSelectionMaxDistance(isAdmin: boolean): number {
    const range = this.getSelectionRange();
    return isAdmin ? range.fpsAdminMax : range.fpsUserMax;
  }

  public canActivateInteraction(target: AbstractMesh, view: 'FPS' | 'TPS' | null): boolean {
    if (!target || this.lastInteractDistance === null || !Number.isFinite(this.lastInteractDistance)) return false;
    const meta = target.metadata || {};
    const maxDist = view === 'FPS' ? (meta.interactDistanceFPS ?? 3.0) : (meta.interactDistanceTPS ?? 5.0);
    return this.lastInteractDistance <= maxDist;
  }

  public comprobarInteracciones(jugador: Mesh, activeCamera: any, colMeta: any, viewMode: 'FPS' | 'TPS'): void {
    const scene = this.motor3d.scene;

    let hitInteractuable: AbstractMesh | null = null;
    let hoverSelectable: AbstractMesh | null = null;

    this.lastInteractDistance = null;
    this.lastInteractionProbePoint = this.getInteractionProbePoint(viewMode, jugador, activeCamera, colMeta);

    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';
    const canShowInteraction = (root: AbstractMesh) => this.state.esObjetoInteractuable(root);

    if (viewMode === 'FPS') {
      const centerRay = activeCamera.getForwardRay(10000);

      const hitCross = scene.pickWithRay(centerRay, (m) => {
        if (!m.isPickable) return false;
        if (!m.isVisible) return false;

        // 🔥 FIX: Permitir al Admin hacer hover visual al trigger con el puntero FPS
        if (m.metadata?.type === 'trigger' && !isAdmin) return false;
        if (m === jugador || m.isDescendantOf(jugador)) return false;

        const nameStr = m.name.toLowerCase();
        if (
          nameStr.includes('proxycol') ||
          nameStr.includes('suelo') ||
          nameStr.includes('skybox') ||
          nameStr.includes('highlight') ||
          nameStr.includes('gizmo') ||
          nameStr.includes('debug')
        ) return false;

        return true;
      });

      if (hitCross && hitCross.hit && hitCross.pickedMesh) {
        const picked = hitCross.pickedMesh as AbstractMesh;
        if (!this.state.esMeshIgnorable(picked)) {
          const rootNode = this.state.encontrarRaiz(picked) as AbstractMesh;
          
          if (rootNode) {
            const selectionDistance = this.getInteractionDistanceToTarget(rootNode, this.lastInteractionProbePoint);
            this.lastInteractDistance = selectionDistance;

            const selectionMax = this.getSelectionMaxDistance(isAdmin);
            const interactMax = rootNode.metadata?.interactDistanceFPS ?? 3.0;
            const isInteractable = canShowInteraction(rootNode);

            if (isAdmin) {
              if (selectionDistance <= selectionMax) {
                hoverSelectable = rootNode;
              }
              if (isInteractable && selectionDistance <= interactMax) {
                hitInteractuable = rootNode;
              }
            } else {
              if (isInteractable && selectionDistance <= interactMax) {
                hoverSelectable = rootNode;
                hitInteractuable = rootNode;
              }
            }
          }
        }
      }
    } else {
      let closestRoot: AbstractMesh | null = null;
      let closestDist = Number.POSITIVE_INFINITY;
      const playerProbe = this.lastInteractionProbePoint;

      scene.meshes.forEach(mesh => {
        if (mesh === jugador || mesh.name.includes('proxyCol') || mesh.name.toLowerCase().includes('suelo') || !mesh.isPickable) return;
        
        // 🔥 FIX: Permitir al Admin evaluar el trigger en TPS
        if (mesh.metadata?.type === 'trigger' && !isAdmin) return; 
        if (!mesh.isVisible) return;

        const root = this.state.encontrarRaiz(mesh as AbstractMesh) as AbstractMesh;
        if (!root || (root.metadata?.type === 'trigger' && !isAdmin)) return;

        const selectionDistance = this.getInteractionDistanceToTarget(root, playerProbe);
        const selectionMax = this.getSelectionMaxDistance(isAdmin);
        const isInteractable = canShowInteraction(root);

        if (isInteractable) {
          if (root.metadata?.type !== 'bubble') {
            const interactMax = root.metadata?.interactDistanceTPS ?? 5.0;
            if (selectionDistance <= interactMax && selectionDistance < closestDist) {
              closestDist = selectionDistance;
              closestRoot = root;
            }
          }
        } else if (isAdmin && selectionDistance <= selectionMax && selectionDistance < closestDist) {
          closestDist = selectionDistance;
          closestRoot = root;
        }
      });

      if (closestRoot) {
        hoverSelectable = closestRoot;
        this.lastInteractDistance = closestDist;
        if (canShowInteraction(closestRoot)) {
          hitInteractuable = closestRoot;
        }
      }
    }

    let showE = false;
    let showI = false;

    if (hitInteractuable) {
      const meta = hitInteractuable.metadata || {};
      const safeView = this.state.modoVistaPrueba;
      const canInteractNow = this.canActivateInteraction(hitInteractuable, safeView);

      const seqIdForView = safeView === 'FPS'
        ? (meta.interactSequenceIdFPS || meta.interactSequenceId)
        : (meta.interactSequenceIdTPS || meta.interactSequenceId);

      const mensajeParaMostrar = meta.mensaje || '';

      if (meta.type === 'bubble') {
        showE = canInteractNow; 
      } else if (meta.type === 'video_plane') {
        if (!meta.isPoweredOn) {
            showE = false; 
        } else {
            showE = canInteractNow; 
        }
      } else {
        showE = !!seqIdForView && seqIdForView.trim() !== '' && canInteractNow;
      }
      
      showI = !!mensajeParaMostrar && mensajeParaMostrar.trim() !== '' && canInteractNow && meta.type !== 'bubble';
    }

    if (this.state.targetInteractuable() !== hitInteractuable) {
      this.state.targetInteractuable.set(hitInteractuable);
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

  public abrirMensajeInteractivo(obj: AbstractMesh, resetMovementCallback: () => void): void {
    this.state.playState.set('INTERACTING');
    this.state.objetoInteractuado.set(obj);
    this.state.objetoSeleccionado.set(obj);
    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.ratonBloqueado.set(false);

    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {}

    resetMovementCallback();
  }
}
