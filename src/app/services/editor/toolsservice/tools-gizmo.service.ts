
import { Injectable, inject } from '@angular/core';
import { Color3, GizmoManager, Mesh, MeshBuilder, PointerDragBehavior, Quaternion, StandardMaterial, Vector3, PointerEventTypes, Tags, AbstractMesh } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { ToolsDebugService } from './tools-debug.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { CoreSceneProjectionService } from '../../../core/engine/scene/utils/core-scene-projection.service';
import { AuthService } from '../../../core/services/auth';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';
import { EditorLiveSyncService } from '../editor-live-sync.service';
import { EditorCinematicService } from '../editor-cinematic.service';
import { EditorMapaService } from '../../editor-mapa.service';
import { GizmoAdapterRegistryService } from './adapters/gizmo-adapter-registry.service';

@Injectable({ providedIn: 'root' })
export class ToolsGizmoService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private debugSvc = inject(ToolsDebugService);
  private entityManager = inject(EntityManagerService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private authSvc = inject(AuthService);
  private ownership = inject(CameraOwnershipService);
  private liveSync = inject(EditorLiveSyncService);
  private cinematicSvc = inject(EditorCinematicService);
  private registry = inject(GizmoAdapterRegistryService);

  public gizmoManager: GizmoManager | null = null;
  public centerDragMesh: Mesh | null = null;
  public gizmoPivotNode: AbstractMesh | null = null;
  
  public isDraggingGizmo = false;
  private estadoAntesDeArrastrar: any = null;

  public initGizmos(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    this.dispose();

    this.gizmoManager = new GizmoManager(scene);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = true;

    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = true;
    this.gizmoManager.scaleGizmoEnabled = true;

    if (this.gizmoManager.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.snapDistance = 0;
      this.gizmoManager.gizmos.positionGizmo.planarGizmoEnabled = false;
      this.gizmoManager.gizmos.positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.snapDistance = 0;
      this.gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    if (this.gizmoManager.gizmos.scaleGizmo) {
      this.gizmoManager.gizmos.scaleGizmo.snapDistance = 0;
    }

    const utilityLayer = this.gizmoManager.utilityLayer;

    this.centerDragMesh = MeshBuilder.CreatePolyhedron('centerDragPos', { type: 1, size: 0.6 }, utilityLayer.utilityLayerScene);
    const centerDragMat = new StandardMaterial('centerDragPosMat', utilityLayer.utilityLayerScene);
    centerDragMat.emissiveColor = new Color3(1, 1, 1);
    centerDragMat.alpha = 0.65;
    centerDragMat.disableLighting = true;
    this.centerDragMesh.material = centerDragMat;
    this.centerDragMesh.isVisible = false;
    Tags.AddTagsTo(this.centerDragMesh, "system_element editor_only gizmo ignore_raycast");

    this.gizmoPivotNode = new Mesh('gizmoPivotNode', utilityLayer.utilityLayerScene);

    const centerDragBehavior = new PointerDragBehavior();
    centerDragBehavior.moveAttached = false;
    this.centerDragMesh.addBehavior(centerDragBehavior);

    this.setupDragEvents(centerDragBehavior);
  }

  public dispose(): void {
    if (this.gizmoManager) {
        this.gizmoManager.attachToMesh(null);
        this.gizmoManager.dispose();
        this.gizmoManager = null;
    }
    if (this.centerDragMesh) {
        this.centerDragMesh.dispose();
        this.centerDragMesh = null;
    }
    if (this.gizmoPivotNode) {
        this.gizmoPivotNode.dispose();
        this.gizmoPivotNode = null;
    }
  }

  private broadcastLiveTransform(mesh: AbstractMesh): void {
    if (Tags.MatchesQuery(mesh, "cinematic_proxy")) {
        const clipId = mesh.name.replace('proxy_cam_', '');
        const euler = mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles() : mesh.rotation;
        this.cinematicSvc.onProxyMoved.next({
            clipId,
            position: mesh.position,
            rotation: new Vector3(euler.x * 180/Math.PI, euler.y * 180/Math.PI, euler.z * 180/Math.PI)
        });
        return;
    }

    const entity = this.entityManager.getEntityByMesh(mesh);
    if (entity) {
      this.liveSync.broadcastLiveTransform(entity, mesh);
    }
  }

  private setupDragEvents(centerDragBehavior: PointerDragBehavior): void {
    const onDragStart = () => {
      this.isDraggingGizmo = true;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      if (mesh && !Tags.MatchesQuery(mesh, "cinematic_proxy")) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(mesh);
      }
    };

    const onDraggingCenter = (event: any) => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();
      const entity = mesh ? this.entityManager.getEntityByMesh(mesh) : null;

      if (mesh && this.centerDragMesh && entity) {
        const adapter = this.registry.getAdapter(subSelected, entity);
        if (adapter) {
            adapter.applyDragDelta(event.delta, this.debugSvc, mesh);
            
            const dragTarget = adapter.getCenterDragTarget(this.debugSvc, mesh);
            if (dragTarget) {
               this.centerDragMesh.position.copyFrom(dragTarget.getAbsolutePosition());
            }

            // 🔥 FIX DEL RETRASO VISUAL (LAG) EN LOS EJES DEL GIZMO
            // Forzamos la actualización posicional del Attach Target (Pivot) en tiempo real
            // durante el evento de drag del centro.
            if (!subSelected && this.gizmoPivotNode) {
               this.gizmoPivotNode.position.copyFrom(mesh.getAbsolutePosition());
            }

            if (!subSelected) {
               this.updateCenterDragMeshRenderState(mesh, subSelected);
               this.broadcastLiveTransform(mesh); 
            }
        }
        this.mapaSvc.onGizmoDrag.next();
      }
    };

    const onDraggingGizmo = () => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();
      const entity = mesh ? this.entityManager.getEntityByMesh(mesh) : null;
      if (!mesh || !this.gizmoPivotNode || !entity) return;

      const adapter = this.registry.getAdapter(subSelected, entity);
      if (adapter) {
          adapter.onGizmoDragged(mesh, this.gizmoPivotNode);
          
          if (!subSelected) {
              this.updateCenterDragMeshRenderState(mesh, subSelected);
              this.broadcastLiveTransform(mesh); 
          }
      }
      this.mapaSvc.onGizmoDrag.next();
    };

    const onDragEnd = () => {
      this.isDraggingGizmo = false;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();
      
      if (!mesh) return;

      if (!subSelected && this.estadoAntesDeArrastrar && !Tags.MatchesQuery(mesh, "cinematic_proxy")) {
        this.historialSvc.registrarAccionTransform(mesh, this.estadoAntesDeArrastrar);
        this.estadoAntesDeArrastrar = null;
        
        const entity = this.entityManager.getEntityByMesh(mesh);
        if (entity && entity.type === 'image_plane') {
            this.projectionSvc.actualizarProyeccion(mesh);
        }
      }

      queueMicrotask(() => { 
        this.mapaSvc.onGizmoDrag.next(); 
        this.mapaSvc.onMapChanged.next(); 
      });
    };

    centerDragBehavior.onDragStartObservable.add(onDragStart);
    centerDragBehavior.onDragObservable.add(onDraggingCenter);
    centerDragBehavior.onDragEndObservable.add(onDragEnd);

    if (this.gizmoManager?.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.positionGizmo.onDragObservable.add(onDraggingGizmo);
      this.gizmoManager.gizmos.positionGizmo.onDragEndObservable.add(onDragEnd);
    }
    if (this.gizmoManager?.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.rotationGizmo.onDragObservable.add(onDraggingGizmo);
      this.gizmoManager.gizmos.rotationGizmo.onDragEndObservable.add(onDragEnd);
    }
    if (this.gizmoManager?.gizmos.scaleGizmo) {
      this.gizmoManager.gizmos.scaleGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.scaleGizmo.onDragObservable.add(onDraggingGizmo);
      this.gizmoManager.gizmos.scaleGizmo.onDragEndObservable.add(onDragEnd);
    }
  }

  public actualizarGizmosActivos(): void {
    if (!this.gizmoManager) return;

    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;

    const modo = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    if (!isAdmin || modo === 'PLAYING' || modo === 'INTERACTING' || modo === 'TRANSITIONING') {
      this.gizmoManager.attachToMesh(null);
      this.updateCenterDragMeshRenderState(null, null);
      return;
    }

    if (this.state.objetoSeleccionado() || this.state.subObjetoSeleccionado()) {
      switch (this.state.currentTool()) {
        case 'select': break;
        case 'translate': this.gizmoManager.positionGizmoEnabled = true; break;
        case 'rotate': 
          if (!this.state.subObjetoSeleccionado()) this.gizmoManager.rotationGizmoEnabled = true;
          break;
        case 'scale': this.gizmoManager.scaleGizmoEnabled = true; break;
      }
    }
    
    const obj = this.state.objetoSeleccionado() as Mesh;
    this.updateCenterDragMeshRenderState(obj, this.state.subObjetoSeleccionado());
  }

  public attachGizmoToCurrentSelection(selected: Mesh | null, subSelected: string | null): void {
    if (!this.gizmoManager) return;

    const modoJuego = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    if (modoJuego === 'PLAYING' || modoJuego === 'TRANSITIONING' || modoJuego === 'INTERACTING' || !isAdmin) {
      this.gizmoManager.attachToMesh(null);
      this.gizmoManager.positionGizmoEnabled = false;
      this.gizmoManager.rotationGizmoEnabled = false;
      this.gizmoManager.scaleGizmoEnabled = false;
      return;
    }

    if (selected) {
        const entity = this.entityManager.getEntityByMesh(selected);
        if (entity && (entity.type === 'trigger' || entity.type === 'trigger_compuesto')) {
            if (modoJuego === 'EDITING_IN_GAME') {
                this.gizmoManager.attachToMesh(null);
                this.gizmoManager.positionGizmoEnabled = false;
                this.gizmoManager.rotationGizmoEnabled = false;
                this.gizmoManager.scaleGizmoEnabled = false;
                return;
            }
        }
    }

    if (selected && Tags.MatchesQuery(selected, "cinematic_proxy")) {
      this.gizmoManager.attachToMesh(selected);
      this.actualizarGizmosActivos();
      return;
    }

    if (!this.gizmoPivotNode || !this.centerDragMesh) return;

    let targetMesh: AbstractMesh | null = null;
    const entity = selected ? this.entityManager.getEntityByMesh(selected) : null;
    
    if (selected && entity) {
      const adapter = this.registry.getAdapter(subSelected, entity);
      if (adapter) {
        targetMesh = adapter.getAttachTarget(this.debugSvc, this.gizmoPivotNode, selected);
      }
    }

    if (targetMesh) {
      if (targetMesh !== this.gizmoPivotNode) {
         this.gizmoPivotNode.parent = null;
      }
      this.gizmoManager.attachToMesh(targetMesh);
    } else {
      this.gizmoManager.attachToMesh(null);
      this.gizmoPivotNode.parent = null;
    }

    this.actualizarGizmosActivos();
  }

  public syncCenterDragMeshVisuals(pi: any): void {
      if (!this.centerDragMesh || !this.centerDragMesh.material) return;
      if (pi.type === PointerEventTypes.POINTERMOVE) {
        const mat = this.centerDragMesh.material as StandardMaterial;
        if (pi.pickInfo?.pickedMesh === this.centerDragMesh) {
          mat.emissiveColor = new Color3(1, 0.9, 0);
          mat.alpha = 0.85;
        } else {
          mat.emissiveColor = new Color3(1, 1, 1);
          mat.alpha = 0.65;
        }
      }
  }

  public updateCenterDragMeshRenderState(obj: Mesh | null, subSelected: string | null): void {
      if (!this.centerDragMesh || !this.gizmoManager || !this.gizmoPivotNode) return;

      if (obj && !this.isDraggingGizmo && !Tags.MatchesQuery(obj, "cinematic_proxy")) {
        const entity = this.entityManager.getEntityByMesh(obj);
        const adapter = entity ? this.registry.getAdapter(subSelected, entity) : null;
        if (adapter) {
            const dragTarget = adapter.getCenterDragTarget(this.debugSvc, obj);
            if (dragTarget) {
                this.centerDragMesh.position.copyFrom(dragTarget.getAbsolutePosition());
            }
        }
      }

      const isSelectMode = this.state.currentTool() === 'select';
      const isProxy = obj && Tags.MatchesQuery(obj, "cinematic_proxy");

      if (this.gizmoManager.attachedMesh && !this.gizmoManager.attachedMesh.isDisposed() && !isSelectMode && !isProxy) {
        this.centerDragMesh.isVisible = true;
        const cam = this.gizmoManager.utilityLayer.utilityLayerScene.activeCamera || this.ownership.getCamera();
        if (cam) {
          const distance = Vector3.Distance(cam.globalPosition, this.centerDragMesh.position);
          const scale = Math.max(0.2, Math.min(distance * 0.035, 1.2));
          this.centerDragMesh.scaling.setAll(scale);
        }
      } else {
        this.centerDragMesh.isVisible = false;
      }
  }
}