import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Matrix } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { Motor3dService } from '../../motor-3d.service';

@Injectable({ providedIn: 'root' })
export class PlayerInteractionService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

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
    } catch { return null; }
  }

  private getInteractionProbePoint(view: 'FPS' | 'TPS', jugador: Mesh, activeCamera: any, colMeta: any): Vector3 {
    if (view === 'FPS') return activeCamera?.position ? activeCamera.position.clone() : jugador.getAbsolutePosition().clone();
    jugador.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(new Vector3(colMeta?.offsetX ?? 0, colMeta?.offsetY ?? 0, colMeta?.offsetZ ?? 0), jugador.getWorldMatrix());
  }

  private getInteractionDistanceToTarget(target: AbstractMesh, probePoint: Vector3 | null): number {
    if (!probePoint) return Number.POSITIVE_INFINITY;
    const shapeMesh = this.getRootProxyCollider(target) ?? target;
    const closest = this.getClosestPointOnMeshBounds(shapeMesh, probePoint);
    return closest ? Vector3.Distance(probePoint, closest) : Vector3.Distance(probePoint, target.getAbsolutePosition());
  }

  public canActivateInteraction(target: AbstractMesh, view: 'FPS' | 'TPS' | null): boolean {
    if (!target || this.lastInteractDistance === null || !Number.isFinite(this.lastInteractDistance)) return false;
    const maxDist = view === 'FPS' ? (target.metadata?.interactDistanceFPS ?? 3.0) : (target.metadata?.interactDistanceTPS ?? 5.0);
    return this.lastInteractDistance <= maxDist;
  }

  public comprobarInteracciones(jugador: Mesh, activeCamera: any, colMeta: any, viewMode: 'FPS' | 'TPS'): void {
    const scene = this.motor3d.scene;
    let hitInteractuable: AbstractMesh | null = null;
    let hoverInteractable = false;
    this.lastInteractDistance = null;
    this.lastInteractionProbePoint = this.getInteractionProbePoint(viewMode, jugador, activeCamera, colMeta);

    const isAdmin = this.state.rolSimulado() === 'admin';
    const canShowInteraction = (root: AbstractMesh) => this.state.esObjetoInteractuable(root);

    let hitAnyRootAdmin: AbstractMesh | null = null;

    if (viewMode === 'FPS') {
      const centerRay = scene.createPickingRay(
        this.motor3d.engine.getRenderWidth() / 2, 
        this.motor3d.engine.getRenderHeight() / 2, 
        Matrix.Identity(), 
        activeCamera
      );
      centerRay.length = 10000;
      
      const hitCross = scene.pickWithRay(centerRay, (m) => {
        // CORRECCIÓN: Usar && en lugar de || para que solo seleccione mallas visibles Y pickables.
        if (!m.isVisible || !m.isPickable) return false;
        if (m === jugador || m.isDescendantOf(jugador)) return false;
        const nameStr = m.name.toLowerCase();
        // IGNORAR GIZMOS Y DEBUG PARA EVITAR LAG Y CAMBIOS RÁPIDOS
        if (nameStr.includes('proxycol') || nameStr.includes('suelo') || nameStr.includes('skybox') || nameStr.includes('highlight') || nameStr.includes('gizmo') || nameStr.includes('debug')) return false;
        return true;
      });

      let hoveredDistance: number | null = null;

      if (hitCross && hitCross.hit && hitCross.pickedMesh) {
        const picked = hitCross.pickedMesh as AbstractMesh;
        if (!this.state.esMeshIgnorable(picked)) {
          const rootNode = this.state.encontrarRaiz(picked) as AbstractMesh;
          if (rootNode) {
            
            if (isAdmin && this.state.puedeSeleccionarse(rootNode)) {
              hitAnyRootAdmin = rootNode;
            }

            if (canShowInteraction(rootNode)) {
              hitInteractuable = rootNode;
              hoveredDistance = this.getInteractionDistanceToTarget(rootNode, this.lastInteractionProbePoint);
              hoverInteractable = true; 
            }
          }
        }
      }

      this.lastInteractDistance = hoveredDistance;

    } else {
      let closestRoot: AbstractMesh | null = null; 
      let closestDist = Number.POSITIVE_INFINITY;
      const playerProbe = this.lastInteractionProbePoint;

      scene.meshes.forEach(mesh => {
        if (mesh === jugador || mesh.name.includes('proxyCol') || mesh.name.toLowerCase().includes('suelo') || !mesh.isVisible || !mesh.isPickable) return;
        const root = this.state.encontrarRaiz(mesh as AbstractMesh) as AbstractMesh;
        if (!root || !canShowInteraction(root)) return;
        
        const dist = this.getInteractionDistanceToTarget(root, playerProbe);
        if (dist <= (root.metadata?.interactDistanceTPS ?? 5.0) && dist < closestDist) {
          closestDist = dist; 
          closestRoot = root;
        }
      });
      
      hitInteractuable = closestRoot;
      this.lastInteractDistance = closestRoot ? closestDist : null;
      if (hitInteractuable) hoverInteractable = true;
    }

    let showE = false;
    let showI = false;

    if (hitInteractuable) {
      const meta = hitInteractuable.metadata || {};
      const safeView = this.state.modoVistaPrueba;
      const canInteractNow = this.canActivateInteraction(hitInteractuable, safeView);
      const seqIdForView = safeView === 'FPS' ? (meta.interactSequenceIdFPS || meta.interactSequenceId) : (meta.interactSequenceIdTPS || meta.interactSequenceId);

      showE = !!seqIdForView && seqIdForView.trim() !== '' && canInteractNow;
      showI = !!meta.mensaje && meta.mensaje.trim() !== '' && canInteractNow;
    }

    // CORRECCIÓN: EVITAR EL ERROR NG0100 (ExpressionChangedAfterItHasBeenCheckedError)
    // Actualizamos las señales de forma asíncrona y solo si realmente han cambiado de valor.
    setTimeout(() => {
      if (this.state.targetInteractuable() !== hitInteractuable) {
        this.state.targetInteractuable.set(hitInteractuable);
      }
      if (this.state.mirandoObjetoInteractuable() !== hoverInteractable) {
        this.state.mirandoObjetoInteractuable.set(hoverInteractable);
      }

      const adminHover = (viewMode === 'FPS' && isAdmin) ? hitAnyRootAdmin : null;
      if (this.state.objetoHovereado() !== adminHover) {
        this.state.objetoHovereado.set(adminHover);
      }

      if (this.state.showToastE() !== showE) {
        this.state.showToastE.set(showE);
      }
      if (this.state.showToastI() !== showI) {
        this.state.showToastI.set(showI);
      }
    }, 0);
  }

  public abrirMensajeInteractivo(obj: AbstractMesh, resetMovementCallback: () => void): void {
    this.state.playState.set('INTERACTING');
    this.state.objetoInteractuado.set(obj);
    this.state.objetoSeleccionado.set(obj);
    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.ratonBloqueado.set(false);
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    resetMovementCallback();
  }
}