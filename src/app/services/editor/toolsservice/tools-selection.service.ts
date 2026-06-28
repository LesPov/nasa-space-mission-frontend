
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Ray, Vector3, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { AuthService } from '../../../core/services/auth';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';

@Injectable({ providedIn: 'root' })
export class ToolsSelectionService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private authSvc = inject(AuthService);
  private ownership = inject(CameraOwnershipService);

  public normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  public esTriggerMesh(mesh: AbstractMesh | null | undefined): boolean {
    if (!mesh) return false;
    const entity = this.entityManager.getEntityByMesh(mesh);
    return entity?.type === 'trigger' || entity?.type === 'trigger_compuesto';
  }

  public getSelectionRangeConfig(): { fpsAdminMax: number; fpsUserMax: number } {
    const fallback = { fpsAdminMax: 10000, fpsUserMax: 3 };
    const candidates: Array<any> = [];
    
    const jugadorActivo = this.state.jugadorActivo as AbstractMesh | null;
    const entJugador = this.entityManager.getEntityByMesh(jugadorActivo);
    if (entJugador) candidates.push(entJugador);

    const seleccionado = this.state.objetoSeleccionado() as AbstractMesh | null;
    const entSeleccionado = this.entityManager.getEntityByMesh(seleccionado);
    if (entSeleccionado) candidates.push(entSeleccionado);

    const scenePlayer = this.motor3d.getScene()?.meshes.find(m => !!this.entityManager.getEntityByMesh(m)?.characterConfig);
    const entScenePlayer = this.entityManager.getEntityByMesh(scenePlayer);
    if (entScenePlayer) candidates.push(entScenePlayer);

    for (const entity of candidates) {
      if (!entity.selectionRange) continue;
      return {
        fpsAdminMax: this.normalizarNumero(entity.selectionRange.fpsAdminMax, fallback.fpsAdminMax),
        fpsUserMax: this.normalizarNumero(entity.selectionRange.fpsUserMax, fallback.fpsUserMax)
      };
    }
    return fallback;
  }

  public getSelectionMaxDistance(): number {
    const isAdmin = this.authSvc.isAdmin();
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

  private canSelectByDistance(ray: Ray, target: AbstractMesh, hit: any): boolean {
    const playSt = this.state.playState();
    if (playSt !== 'PLAYING' && playSt !== 'EDITING_IN_GAME') return true;
    if (this.state.modoVistaPrueba !== 'FPS') return true;

    const maxDistance = this.getSelectionMaxDistance();
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) return true;

    const distanceFromPick = typeof hit?.distance === 'number' ? hit.distance : NaN;
    if (Number.isFinite(distanceFromPick)) return distanceFromPick <= maxDistance;

    const origin = ray?.origin ?? this.ownership.getCamera()?.globalPosition;
    if (!origin) return true;
    return Vector3.Distance(origin, this.getMeshSelectionPoint(target)) <= maxDistance;
  }

  private puedeTomarseParaSeleccion(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.state.esMeshIgnorable(mesh)) return false;

    if (Tags.MatchesQuery(mesh, "cinematic_proxy")) return true;

    const root = this.state.encontrarRaiz(mesh) as AbstractMesh | null;
    const base = root ?? mesh;
    const entity = this.entityManager.getEntityByMesh(base);
    const selectable = entity?.visual?.isSelectable ?? true;
    return selectable !== false;
  }

  public resolverRootDesdeRay(ray: Ray, centerDragMesh: AbstractMesh): AbstractMesh | null {
    const scene = this.motor3d.getScene();
    const playSt = this.state.playState();
    const jugador = this.state.jugadorActivo;
    const entityPlayer = jugador ? this.entityManager.getEntityByMesh(jugador) : null;
    const isAdmin = this.authSvc.isAdmin();

    const hit = scene.pickWithRay(ray, (m) => {
      if (!m.isVisible && !Tags.MatchesQuery(m, "cinematic_proxy")) return false;
      if (!m.isPickable) return false;
      
      if (this.state.modoVistaPrueba === 'FPS' && entityPlayer) {
          const entityHit = this.entityManager.getEntityByMesh(m);
          if (entityHit && entityHit.uid === entityPlayer.uid) {
              return false;
          }
      }

      if (Tags.MatchesQuery(m, "cinematic_proxy")) return true;
      if (Tags.MatchesQuery(m, "system_element || fog_element || ignore_raycast || editor_only || invisible_floor")) return false;
      if (m === centerDragMesh) return false;
      
      const entity = this.entityManager.getEntityByMesh(m);
      if (entity?.type === 'trigger' || entity?.type === 'trigger_compuesto') {
          if (playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') return false;
      }
      return true;
    });

    if (!hit || !hit.hit || !hit.pickedMesh) return null;

    const picked = hit.pickedMesh as AbstractMesh;

    if (Tags.MatchesQuery(picked, "cinematic_proxy")) {
        return (picked.parent as AbstractMesh) || picked;
    }

    if (this.state.esMeshIgnorable(picked)) return null;

    const rootNode = this.state.encontrarRaiz(picked);
    if (!(rootNode instanceof AbstractMesh)) return null;
    if (this.esTriggerMesh(rootNode) && !isAdmin) return null;

    if (playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') {
      if (!isAdmin) return null;
      if (!this.canSelectByDistance(ray, rootNode, hit)) return null;
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