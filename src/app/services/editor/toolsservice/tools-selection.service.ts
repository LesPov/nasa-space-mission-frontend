import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Ray, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';

@Injectable({ providedIn: 'root' })
export class ToolsSelectionService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  public normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  public esTriggerMesh(mesh: AbstractMesh | null | undefined): boolean {
    return !!mesh && (mesh.metadata?.type === 'trigger' || mesh.name?.toLowerCase().includes('trigger'));
  }

  public getSelectionRangeConfig(): { fpsAdminMax: number; fpsUserMax: number } {
    const fallback = { fpsAdminMax: 10000, fpsUserMax: 3 };
    const candidates: Array<any> = [];
    const jugadorActivo = this.state.jugadorActivo as AbstractMesh | null;
    if (jugadorActivo?.metadata) candidates.push(jugadorActivo.metadata);

    const seleccionado = this.state.objetoSeleccionado() as AbstractMesh | null;
    if (seleccionado?.metadata) candidates.push(seleccionado.metadata);

    const scenePlayer = this.motor3d.scene?.meshes.find(
      m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc'
    );
    if (scenePlayer?.metadata) candidates.push(scenePlayer.metadata);

    for (const meta of candidates) {
      const source = meta?.playerConfig?.selectionRange || meta?.selectionRange;
      if (!source) continue;
      return {
        fpsAdminMax: this.normalizarNumero(source.fpsAdminMax, fallback.fpsAdminMax),
        fpsUserMax: this.normalizarNumero(source.fpsUserMax, fallback.fpsUserMax)
      };
    }
    return fallback;
  }

  public getSelectionMaxDistance(isAdmin: boolean): number {
    const range = this.getSelectionRangeConfig();
    return isAdmin ? range.fpsAdminMax : range.fpsUserMax;
  }

  private getMeshSelectionPoint(mesh: AbstractMesh): Vector3 {
    try {
      mesh.computeWorldMatrix(true);
      const bi = mesh.getBoundingInfo?.();
      const center = bi?.boundingBox?.centerWorld;
      if (center) return center.clone();
    } catch {}
    return mesh.getAbsolutePosition().clone();
  }

  private canSelectByDistance(ray: Ray, target: AbstractMesh, hit: any, isAdmin: boolean): boolean {
    const playSt = this.state.playState();
    if (playSt !== 'PLAYING' && playSt !== 'EDITING_IN_GAME') return true;
    if (this.state.modoVistaPrueba !== 'FPS') return true;

    const maxDistance = this.getSelectionMaxDistance(isAdmin);
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) return true;

    const distanceFromPick = typeof hit?.distance === 'number' ? hit.distance : NaN;
    if (Number.isFinite(distanceFromPick)) return distanceFromPick <= maxDistance;

    const origin = ray?.origin ?? this.motor3d.scene.activeCamera?.globalPosition;
    if (!origin) return true;
    return Vector3.Distance(origin, this.getMeshSelectionPoint(target)) <= maxDistance;
  }

  private puedeTomarseParaSeleccion(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.state.esMeshIgnorable(mesh)) return false;

    const root = this.state.encontrarRaiz(mesh) as AbstractMesh | null;
    const base = root ?? mesh;
    const selectable = base.metadata?.isSelectable ?? mesh.metadata?.isSelectable ?? true;
    return selectable !== false;
  }

  public resolverRootDesdeRay(ray: Ray, isAdmin: boolean, centerDragMesh: AbstractMesh): AbstractMesh | null {
    const scene = this.motor3d.scene;
    const playSt = this.state.playState();

    const hit = scene.pickWithRay(ray, (m) => {
      if (!m.isVisible || !m.isPickable) return false;
      const nameStr = m.name.toLowerCase();
      if (nameStr.includes('highlight') || nameStr.includes('gizmo')) return false;
      if (nameStr.includes('proxycol') || nameStr.includes('suelo') || nameStr.includes('skybox') || nameStr.includes('debug')) return false;
      if (m === centerDragMesh) return false;
      if (m.metadata?.type === 'trigger' || nameStr.includes('trigger')) {
          if (playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') return false;
      }
      return true;
    });

    if (!hit || !hit.hit || !hit.pickedMesh) return null;

    const picked = hit.pickedMesh as AbstractMesh;
    if (this.state.esMeshIgnorable(picked)) return null;

    const rootNode = this.state.encontrarRaiz(picked);
    if (!(rootNode instanceof AbstractMesh)) return null;
    if (this.esTriggerMesh(rootNode) && !isAdmin) return null;

    if (playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') {
      if (!isAdmin) return null;
      if (!this.canSelectByDistance(ray, rootNode, hit, true)) return null;
      return rootNode;
    }

    if (playSt === 'EDITOR') {
      if (!isAdmin) return null;
      if (!this.puedeTomarseParaSeleccion(rootNode)) return null;
      return rootNode;
    }
    return null;
  }
}